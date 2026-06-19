import { getUploadUrl } from '../api';
import { captureViaCdp } from '../browser';
import { log } from '../logging/logger';
import { CommandError } from './types';
import type { CommandContext } from './types';
import type { Page } from 'puppeteer-core';

/**
 * Metadata attached to each uploaded recording chunk. The agent emits one
 * continuous recording per document run: the seq-0 chunk carries the rrweb
 * Meta + FullSnapshot, later chunks are incremental-only continuations of the
 * same node-ID namespace. Consumers group by `sessionId`, order by `seq`, and
 * concatenate into a single player — the only DOM rebuild is at a chunk where
 * `containsSnapshot` is true (a new `runId` = a real page load).
 */
interface RecordingMeta {
  url: string;
  sessionId: string;
  runId: string | null;
  seq: number;
  containsSnapshot: boolean;
  startTs: number;
  endTs: number;
}

// Monotonic chunk sequence per dev session. A counter only advances when a
// chunk is actually uploaded, so the frontend never sees a gap. Keyed by
// sessionId so a session restart (new sessionId) starts fresh at 0.
const recordingSeqBySession = new Map<string, number>();

function nextRecordingSeq(sessionId: string): number {
  const cur = recordingSeqBySession.get(sessionId) ?? 0;
  recordingSeqBySession.set(sessionId, cur + 1);
  return cur;
}

export async function handleBrowser(
  ctx: CommandContext,
  cmd: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!ctx.state.proxy) throw new CommandError('No active proxy', 'NO_BROWSER');

  const steps = cmd.steps as Array<Record<string, unknown>>;
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new CommandError('browser action requires a non-empty "steps" array', 'INVALID_INPUT');
  }

  const page = ctx.state.browser?.getActivePage();
  if (!page) {
    throw new CommandError(
      'Sandbox browser unavailable — headless Chrome is required for automation',
      'NO_BROWSER',
    );
  }

  const resultsByIndex = new Array<Record<string, unknown> | undefined>(
    steps.length,
  );
  let lastSnapshot = '';
  let lastLogs: unknown[] = [];
  let totalDuration = 0;
  const allEvents: unknown[] = [];
  let lastRunId: string | undefined;

  let buffer: Array<{ idx: number; step: Record<string, unknown> }> = [];

  const flushBuffer = async () => {
    if (buffer.length === 0) return;
    const batch = buffer.map((b) => b.step);
    const out = await ctx.state.proxy!.dispatchBrowserCommand(batch);
    const outSteps = (out.steps as Array<Record<string, unknown>>) ?? [];
    for (let i = 0; i < buffer.length; i++) {
      const returned = outSteps[i] ?? {};
      resultsByIndex[buffer[i].idx] = {
        ...returned,
        index: buffer[i].idx,
        command: buffer[i].step.command,
      };
    }
    if (typeof out.snapshot === 'string' && out.snapshot.length > 0) {
      lastSnapshot = out.snapshot;
    }
    if (Array.isArray(out.logs)) lastLogs = out.logs as unknown[];
    if (typeof out.duration === 'number') totalDuration += out.duration;
    if (Array.isArray(out.events)) allEvents.push(...(out.events as unknown[]));
    if (typeof out.runId === 'string') lastRunId = out.runId;
    buffer = [];
  };

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const command = step.command;
    if (command === 'screenshotFullPage' || command === 'screenshotViewport') {
      await flushBuffer();
      const captured = await captureScreenshotStep(ctx, page, step as Record<string, unknown>, command);
      resultsByIndex[i] = { index: i, command, result: captured };
      totalDuration += captured._durationMs ?? 0;
      delete captured._durationMs;
    } else {
      buffer.push({ idx: i, step });
    }
  }
  await flushBuffer();

  const densified = resultsByIndex.map((r, idx) =>
    r ?? { index: idx, command: steps[idx].command, error: 'no result' },
  );
  const hasStepError = densified.some((s) => s?.error);
  const recording = await uploadRecording(ctx, allEvents, lastRunId);

  return {
    success: !hasStepError,
    ...(hasStepError ? { errorCode: 'BROWSER_ERROR' } : {}),
    steps: densified,
    snapshot: lastSnapshot,
    logs: lastLogs,
    duration: totalDuration,
    ...(recording ? { recording } : {}),
  };
}

/**
 * Capture a screenshot step via CDP. Returns a result that matches the
 * shape today's stdin callers expect: `{ url, width, height, styleMap? }`.
 * Navigation before the capture is handled inside `captureViaCdp`.
 */
async function captureScreenshotStep(
  ctx: CommandContext,
  page: Page,
  step: Record<string, unknown>,
  command: string,
): Promise<Record<string, unknown> & { _durationMs?: number }> {
  const session = ctx.state.runner?.getSession();
  const appId = ctx.state.appConfig?.appId;
  if (!session || !appId) {
    throw new CommandError('No active session', 'NO_SESSION');
  }
  const { uploadUrl, uploadFields, publicUrl } = await getUploadUrl(
    appId,
    session.sessionId,
    'jpg',
    'image/jpeg',
  );
  const start = Date.now();
  const r = await captureViaCdp(page, {
    fullPage: command === 'screenshotFullPage',
    path: typeof step.path === 'string' ? step.path : undefined,
    scrollToSelector:
      typeof step.scrollToSelector === 'string'
        ? step.scrollToSelector
        : undefined,
    scrollY: typeof step.scrollY === 'number' ? step.scrollY : undefined,
    uploadUrl,
    uploadFields,
  });
  return {
    url: publicUrl,
    width: r.width,
    height: r.height,
    ...(r.styleMap ? { styleMap: r.styleMap } : {}),
    _durationMs: Date.now() - start,
  };
}

/**
 * Upload one continuous-recording chunk to S3 using the same presigned-URL
 * flow screenshots use, and return its playback metadata (RecordingMeta).
 * Returns null when there's nothing to upload or the upload fails.
 */
async function uploadRecording(
  ctx: CommandContext,
  events: unknown[],
  runId: string | undefined,
): Promise<RecordingMeta | null> {
  // Never drop a non-empty chunk: continuation chunks are incremental-only
  // and may be small, but skipping one punches a hole in the continuous
  // stream and desyncs playback. (The old size floor was for self-contained
  // per-command recordings, which no longer exist.)
  if (events.length === 0) return null;
  const session = ctx.state.runner?.getSession();
  const appId = ctx.state.appConfig?.appId;
  if (!session || !appId) return null;

  const body = JSON.stringify(events);

  try {
    const { uploadUrl, uploadFields, publicUrl } = await getUploadUrl(
      appId,
      session.sessionId,
      'json',
      'application/json',
    );
    const form = new FormData();
    for (const [k, v] of Object.entries(uploadFields)) form.append(k, v);
    form.append(
      'file',
      new Blob([body], { type: 'application/json' }),
      'recording.json',
    );
    const res = await fetch(uploadUrl, { method: 'POST', body: form });
    if (!res.ok) {
      log.warn('browser', 'Recording upload failed', {
        status: res.status,
        bytes: body.length,
      });
      return null;
    }

    const { containsSnapshot, startTs, endTs } = summarizeEvents(events);
    const seq = nextRecordingSeq(session.sessionId);
    log.info('browser', 'Recording chunk uploaded', {
      bytes: body.length,
      events: events.length,
      seq,
      containsSnapshot,
    });
    return {
      url: publicUrl,
      sessionId: session.sessionId,
      runId: runId ?? null,
      seq,
      containsSnapshot,
      startTs,
      endTs,
    };
  } catch (err) {
    log.warn('browser', 'Recording upload errored', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Derive playback metadata from a chunk's rrweb events. `containsSnapshot`
 * (any type-2 FullSnapshot) marks a rebuild seam; startTs/endTs (absolute
 * event timestamps, passed through unchanged from the agent) give the
 * per-chunk window the frontend seeks to for per-tool replay.
 */
function summarizeEvents(events: unknown[]): {
  containsSnapshot: boolean;
  startTs: number;
  endTs: number;
} {
  let containsSnapshot = false;
  let startTs = Infinity;
  let endTs = -Infinity;
  for (const e of events) {
    const ev = e as { type?: number; timestamp?: number };
    if (ev.type === 2) containsSnapshot = true;
    if (typeof ev.timestamp === 'number') {
      if (ev.timestamp < startTs) startTs = ev.timestamp;
      if (ev.timestamp > endTs) endTs = ev.timestamp;
    }
  }
  return {
    containsSnapshot,
    startTs: Number.isFinite(startTs) ? startTs : 0,
    endTs: Number.isFinite(endTs) ? endTs : 0,
  };
}
