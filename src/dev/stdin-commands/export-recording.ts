/**
 * Export a browser-test replay (rrweb events) as an mp4, rendered on the box.
 *
 * The editor uploads the stitched, dead-air-compressed event stream — the same
 * artifact its Share button produces — and hands us the URL. We open a second
 * tab on the supervisor's Chrome, load a proxy-served replay page that plays
 * those events with the rrweb Replayer, capture DevTools screencast frames to
 * disk while it plays, and encode them once with the box's ffmpeg to H.264.
 * Frames carry Chrome's own timestamps, so timing is exact however fast the
 * box is: no intermediate video, no frames buffered in memory.
 *
 * Why not puppeteer's `page.screencast()`: it streams PNG frames into a
 * single-threaded real-time VP9 encode with no backpressure. On a two-core box
 * that is minutes of encode tail, hundreds of MB queued in Node, and a second
 * transcode pass to get a portable mp4.
 *
 * Concurrency: the export enqueues behind any in-flight browser command
 * (`enqueueBrowserWork`) and, once accepted, makes later browser/screenshot/
 * render commands fail fast with BUSY (`exportGate`, browser.ts). The sandbox
 * additionally refuses to start one while the agent is working.
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CDPSession, Page } from 'puppeteer-core';
import { getUploadUrl } from '../api';
import { resolveFfmpegPath } from '../browser';
import { emitEvent } from '../ipc/ipc';
import { log } from '../logging/logger';
import { assertNoExport, enqueueBrowserWork, exportGate } from './browser';
import { CommandError } from './types';
import type { CommandContext } from './types';

// Minted sandbox-side as 16 random bytes, hex. Doubles as the render page's
// token, so it must not be guessable (the proxy's internal routes may be
// reachable through the public preview host while the job is live).
const JOB_ID_RE = /^[a-f0-9]{32}$/;

const MAX_EVENTS_BYTES = 256 * 1024 * 1024;
// Stitched replays are dead-air compressed; a typical run is tens of seconds.
// Anything longer than this can't finish inside the sandbox's job timeout.
const MAX_REPLAY_MS = 6 * 60_000;
// Ready + encode + upload allowance on top of the replay's own length.
const RENDER_MARGIN_MS = 90_000;
const MAX_FRAMES_BYTES = 1.5 * 1024 * 1024 * 1024;
const READY_TIMEOUT_MS = 30_000;
const FIRST_FRAME_TIMEOUT_MS = 10_000;
// Let the final DOM state sit on screen briefly instead of cutting on the
// last mutation.
const TAIL_MS = 500;
const FPS = 30;
const JPEG_QUALITY = 90;
const X264_CRF = 20;

type Phase = 'loading' | 'rendering' | 'encoding' | 'uploading';

interface RenderPageState {
  ready: boolean;
  visible: boolean;
  total: number;
  width: number;
  height: number;
  finished: boolean;
  error: string | null;
}

const abortRequests = new Set<string>();

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function progress(jobId: string, phase: Phase, percent: number): void {
  emitEvent('recording-export-progress', {
    jobId,
    phase,
    percent: Math.max(0, Math.min(100, Math.round(percent))),
  });
}

/**
 * `cancel-export-recording {jobId}` — flag the running export to stop at its
 * next progress tick. Its `finally` cleans up; the result is CANCELLED.
 */
export async function handleCancelExportRecording(
  _ctx: CommandContext,
  cmd: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const jobId = typeof cmd.jobId === 'string' ? cmd.jobId : '';
  const active = exportGate.active;
  if (!active || active.jobId !== jobId) {
    return { success: true, cancelled: false };
  }
  abortRequests.add(jobId);
  return { success: true, cancelled: true };
}

export async function handleExportRecording(
  ctx: CommandContext,
  cmd: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const jobId = typeof cmd.jobId === 'string' ? cmd.jobId : '';
  const eventsUrl = typeof cmd.eventsUrl === 'string' ? cmd.eventsUrl : '';
  if (!JOB_ID_RE.test(jobId)) {
    throw new CommandError(
      'export-recording requires a 32-hex "jobId"',
      'INVALID_INPUT',
    );
  }
  if (!eventsUrl.startsWith('https://')) {
    throw new CommandError(
      'export-recording requires an https "eventsUrl"',
      'INVALID_INPUT',
    );
  }
  if (!ctx.state.proxy || ctx.state.proxyPort === null) {
    throw new CommandError('No active proxy', 'NO_BROWSER');
  }
  const session = ctx.state.runner?.getSession();
  const appId = ctx.state.appConfig?.appId;
  if (!session || !appId) {
    throw new CommandError('No active session', 'NO_SESSION');
  }
  if (!ctx.state.browser?.getActivePage()) {
    throw new CommandError(
      'Sandbox browser unavailable — headless Chrome is required to render a replay',
      'NO_BROWSER',
    );
  }
  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg) {
    throw new CommandError(
      'ffmpeg is not installed on this sandbox — video export needs the current devbox image',
      'FFMPEG_UNAVAILABLE',
    );
  }
  // Single flight, and the gate that turns later browser commands away.
  assertNoExport();
  exportGate.active = {
    jobId,
    startedAt: Date.now(),
    etaMs: MAX_REPLAY_MS + RENDER_MARGIN_MS,
  };
  ctx.started({ jobId });

  try {
    return await enqueueBrowserWork(() =>
      runExport(ctx, {
        jobId,
        eventsUrl,
        appId,
        sessionId: session.sessionId,
        proxyPort: ctx.state.proxyPort!,
        ffmpeg,
      }),
    );
  } finally {
    exportGate.active = null;
    abortRequests.delete(jobId);
  }
}

interface ExportJob {
  jobId: string;
  eventsUrl: string;
  appId: string;
  sessionId: string;
  proxyPort: number;
  ffmpeg: string;
}

async function runExport(
  ctx: CommandContext,
  job: ExportJob,
): Promise<Record<string, unknown>> {
  const { jobId } = job;
  const proxy = ctx.state.proxy!;
  // Re-resolve after waiting in the queue — Chrome may have restarted.
  const appPage = ctx.state.browser?.getActivePage();
  if (!appPage) {
    throw new CommandError(
      'Sandbox browser unavailable — headless Chrome is required to render a replay',
      'NO_BROWSER',
    );
  }
  const startedAt = Date.now();
  const dir = path.join(os.tmpdir(), 'mindstudio-render', jobId);
  await mkdir(dir, { recursive: true });
  let page: Page | null = null;
  let cdp: CDPSession | null = null;

  const checkAbort = () => {
    if (abortRequests.has(jobId)) {
      throw new CommandError('Export cancelled', 'CANCELLED');
    }
  };

  try {
    // 1. The events, held in memory for the render page to fetch locally.
    progress(jobId, 'loading', 0);
    const { eventsJson, width, height } = await fetchEvents(job.eventsUrl);
    proxy.setRenderJob(jobId, eventsJson);
    checkAbort();

    // 2. A fresh tab in the same browser. The app page, its viewport, its
    //    document and the supervisor's watchdogs are never touched
    //    (renderHtmlCapture precedent). Default context, so auth-gated app
    //    images the recording references resolve with the app page's cookies.
    page = await appPage.browser().newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(
      `http://127.0.0.1:${job.proxyPort}/__mindstudio_dev__/render?job=${jobId}`,
      { waitUntil: 'load', timeout: READY_TIMEOUT_MS },
    );
    const ready = await waitForReady(page);
    if (ready.total <= 0 || ready.total > MAX_REPLAY_MS) {
      throw new CommandError(
        ready.total <= 0
          ? 'Recording has no playable duration'
          : `Recording is ${Math.round(ready.total / 1000)}s long — exports are limited to ${MAX_REPLAY_MS / 60_000} minutes`,
        'INVALID_INPUT',
      );
    }
    // rrweb's timer is rAF-driven: a hidden tab never advances the replay.
    await page.bringToFront();
    if (!ready.visible) {
      const visible = await page
        .evaluate(() => document.visibilityState === 'visible')
        .catch(() => false);
      if (!visible) {
        throw new CommandError(
          'Render tab is not visible; the replay cannot advance',
          'RENDER_FAILED',
        );
      }
    }
    if (exportGate.active?.jobId === jobId) {
      exportGate.active.etaMs = ready.total + RENDER_MARGIN_MS;
    }
    checkAbort();

    // 3. Screencast to disk. Each frame is written before it is acked, so
    //    Chrome's in-flight window (3 frames) is the only buffer.
    cdp = await page.createCDPSession();
    const frames: Array<{ file: string; ts: number }> = [];
    let framesBytes = 0;
    let writeChain: Promise<void> = Promise.resolve();
    const session = cdp;
    cdp.on('Page.screencastFrame', (ev) => {
      writeChain = writeChain
        .then(async () => {
          const file = `${String(frames.length).padStart(6, '0')}.jpg`;
          const buf = Buffer.from(ev.data, 'base64');
          framesBytes += buf.length;
          await writeFile(path.join(dir, file), buf);
          frames.push({
            file,
            ts:
              typeof ev.metadata?.timestamp === 'number'
                ? ev.metadata.timestamp
                : Date.now() / 1000,
          });
          await session
            .send('Page.screencastFrameAck', { sessionId: ev.sessionId })
            .catch(() => {});
        })
        .catch(() => {});
    });
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: JPEG_QUALITY,
      maxWidth: width,
      maxHeight: height,
      everyNthFrame: 1,
    });
    // The paused frame 0 anchors t0 before playback starts.
    const firstFrameDeadline = Date.now() + FIRST_FRAME_TIMEOUT_MS;
    while (frames.length === 0) {
      if (Date.now() > firstFrameDeadline) {
        throw new CommandError(
          'Chrome produced no screencast frames',
          'RENDER_FAILED',
        );
      }
      await sleep(50);
    }
    await page.evaluate(() => (window as any).__render.play());

    // 4. Play out. Short evaluates only — one long waitForFunction would die
    //    at puppeteer's 95s protocolTimeout.
    const total = ready.total;
    const playDeadline = Date.now() + total + RENDER_MARGIN_MS;
    for (;;) {
      await sleep(1000);
      checkAbort();
      const st = await page.evaluate(() => {
        const r = (window as any).__render;
        return { time: r.time() as number, finished: r.finished as boolean };
      });
      progress(jobId, 'rendering', (st.time / total) * 100);
      if (st.finished || st.time >= total + TAIL_MS) break;
      if (Date.now() > playDeadline) {
        throw new CommandError(
          'Replay did not finish within its time budget',
          'RENDER_FAILED',
        );
      }
      if (framesBytes > MAX_FRAMES_BYTES) {
        throw new CommandError(
          'Replay produced too many frames to encode on this sandbox',
          'RENDER_FAILED',
        );
      }
    }
    await sleep(TAIL_MS);
    await cdp.send('Page.stopScreencast').catch(() => {});
    await writeChain;
    await cdp.detach().catch(() => {});
    cdp = null;
    await page.close().catch(() => {});
    page = null;
    proxy.clearRenderJob(jobId);
    if (frames.length === 0) {
      throw new CommandError('No frames were captured', 'RENDER_FAILED');
    }

    // 5. Per-frame durations from Chrome's timestamps; the concat demuxer
    //    needs the last file repeated for its duration to count.
    const lines: string[] = [];
    for (let i = 0; i < frames.length; i++) {
      const next = frames[i + 1];
      const dur = next
        ? Math.max(0.001, next.ts - frames[i].ts)
        : TAIL_MS / 1000;
      lines.push(`file '${frames[i].file}'`, `duration ${dur.toFixed(6)}`);
    }
    lines.push(`file '${frames[frames.length - 1].file}'`);
    await writeFile(path.join(dir, 'frames.txt'), lines.join('\n') + '\n');

    // 6. One encode, straight to the deliverable.
    checkAbort();
    progress(jobId, 'encoding', 0);
    const mp4 = path.join(dir, 'replay.mp4');
    await encode(job.ffmpeg, dir, mp4, total, (pct) =>
      progress(jobId, 'encoding', pct),
    );

    // 7. Upload through the same presigned flow screenshots use.
    checkAbort();
    progress(jobId, 'uploading', 0);
    const bytes = (await stat(mp4)).size;
    const { uploadUrl, uploadFields, publicUrl } = await getUploadUrl(
      job.appId,
      job.sessionId,
      'mp4',
      'video/mp4',
    );
    const form = new FormData();
    for (const [k, v] of Object.entries(uploadFields)) form.append(k, v);
    form.append(
      'file',
      new Blob([await readFile(mp4)], { type: 'video/mp4' }),
      'replay.mp4',
    );
    const res = await fetch(uploadUrl, { method: 'POST', body: form });
    if (!res.ok) {
      throw new CommandError(
        `Video upload failed (HTTP ${res.status})`,
        'UPLOAD_FAILED',
      );
    }
    progress(jobId, 'uploading', 100);

    const elapsedMs = Date.now() - startedAt;
    log.info('browser', 'Replay export complete', {
      jobId,
      width,
      height,
      durationMs: total,
      frames: frames.length,
      bytes,
      elapsedMs,
    });
    return {
      success: true,
      jobId,
      url: publicUrl,
      width,
      height,
      durationMs: total,
      bytes,
      elapsedMs,
    };
  } finally {
    if (cdp) await cdp.detach().catch(() => {});
    if (page) await page.close().catch(() => {});
    proxy.clearRenderJob(jobId);
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Fetch and sanity-check the events; the canvas is the largest Meta size. */
async function fetchEvents(
  url: string,
): Promise<{ eventsJson: string; width: number; height: number }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new CommandError(
      `Could not fetch the recording (HTTP ${res.status})`,
      'INVALID_INPUT',
    );
  }
  const eventsJson = await res.text();
  if (eventsJson.length > MAX_EVENTS_BYTES) {
    throw new CommandError('Recording is too large to render', 'INVALID_INPUT');
  }
  let events: unknown;
  try {
    events = JSON.parse(eventsJson);
  } catch {
    throw new CommandError('Recording is not valid JSON', 'INVALID_INPUT');
  }
  if (!Array.isArray(events) || events.length === 0) {
    throw new CommandError('Recording has no events', 'INVALID_INPUT');
  }
  let width = 0;
  let height = 0;
  for (const e of events as Array<{
    type?: number;
    data?: { width?: number; height?: number };
  }>) {
    if (e?.type === 4 && e.data) {
      width = Math.max(width, Math.floor(e.data.width ?? 0));
      height = Math.max(height, Math.floor(e.data.height ?? 0));
    }
  }
  if (width < 16 || height < 16) {
    throw new CommandError(
      'Recording has no viewport (missing Meta event)',
      'INVALID_INPUT',
    );
  }
  return { eventsJson, width, height };
}

/** Poll the render page until it reports ready (or an error). */
async function waitForReady(page: Page): Promise<RenderPageState> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const st = (await page
      .evaluate(() => {
        const r = (window as any).__render;
        if (!r) return null;
        return {
          ready: r.ready,
          visible: r.visible,
          total: r.total,
          width: r.width,
          height: r.height,
          finished: r.finished,
          error: r.error,
        };
      })
      .catch(() => null)) as RenderPageState | null;
    if (st?.error) {
      throw new CommandError(
        `Replay page failed to load: ${st.error}`,
        'RENDER_FAILED',
      );
    }
    if (st?.ready) return st;
    if (Date.now() > deadline) {
      throw new CommandError(
        'Replay page did not become ready in time',
        'RENDER_FAILED',
      );
    }
    await sleep(200);
  }
}

/**
 * Encode the captured frames to H.264. libx264 veryfast handles UI content at
 * this size faster than real time on one core; the process is deprioritised so
 * it can't starve Chrome (whose app-page ping watchdog is a SIGKILL).
 */
function encode(
  ffmpeg: string,
  dir: string,
  outFile: string,
  totalMs: number,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-loglevel',
      'error',
      '-progress',
      'pipe:1',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      'frames.txt',
      '-vf',
      // JPEG frames are full-range; convert to limited range explicitly or the
      // stream is flagged yuvj420p and some players crush or wash out colors.
      `fps=${FPS},scale=trunc(iw/2)*2:trunc(ih/2)*2:in_range=pc:out_range=tv,format=yuv420p`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-threads',
      '1',
      '-crf',
      String(X264_CRF),
      '-movflags',
      '+faststart',
      '-an',
      outFile,
    ];
    const child = spawn(ffmpeg, args, {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (child.pid) {
      try {
        os.setPriority(child.pid, 10);
      } catch {
        // Not permitted on this platform — proceed at normal priority.
      }
    }
    let stderr = '';
    let stdoutBuf = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf-8');
      // `-progress` writes key=value blocks; out_time_us is microseconds.
      const matches = stdoutBuf.match(/out_time_us=(\d+)/g);
      if (matches) {
        const last = matches[matches.length - 1];
        const us = Number(last.slice('out_time_us='.length));
        if (Number.isFinite(us) && totalMs > 0) {
          onProgress((us / 1000 / totalMs) * 100);
        }
        stdoutBuf = stdoutBuf.slice(-256);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf-8')).slice(-2000);
    });
    child.on('error', (err) => {
      reject(
        new CommandError(
          `ffmpeg failed to start: ${err.message}`,
          'RENDER_FAILED',
        ),
      );
    });
    child.on('close', (code) => {
      if (code === 0) {
        onProgress(100);
        resolve();
      } else {
        reject(
          new CommandError(
            `ffmpeg exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`,
            'RENDER_FAILED',
          ),
        );
      }
    });
  });
}
