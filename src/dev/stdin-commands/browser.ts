import { randomBytes } from 'node:crypto';
import { getUploadUrl } from '../api';
import {
  captureViaCdp,
  navigateTunnelSide,
  viewportFor,
  viewportToString,
} from '../browser';
import type { PreviewMode } from '../browser';
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
  /**
   * Private-bucket storage ref (`s3://bucket/key`). Replays can contain
   * whatever the previewed app rendered, so chunks are stored privately and
   * the editor resolves this to a presigned URL via the app's
   * `attachment-url` endpoint before fetching.
   */
  path?: string;
  /** Legacy public CDN URL — only set when the API predates private chunks. */
  url?: string;
  sessionId: string;
  runId: string | null;
  seq: number;
  containsSnapshot: boolean;
  startTs: number;
  endTs: number;
}

// Recording-session id for this tunnel process. The frontend groups recording
// chunks by `sessionId` and concatenates them by `seq` into one player, so the
// grouping key MUST share the seq counter's lifetime. The *dev* session's id is
// durable — reused across process restarts, can span days — while the seq
// counter below lives only in this process's memory. Keying chunks on the
// dev-session id paired a stable id with a counter that resets to 0 on every
// restart, so one `sessionId` accumulated many `seq:0` chunks; the stitcher
// then merged unrelated recordings (different node-ID namespaces, timestamps
// days apart) into one stream and rrweb rendered nothing. Minting the id here
// binds it to the counter's lifetime: a restart yields a fresh id AND a fresh
// seq together, so seqs never collide within a session. (No need to rotate on
// browser relaunch — every recorder (re)injection emits a FullSnapshot, which
// the player already treats as a rebuild seam via `containsSnapshot`.)
const RECORDING_SESSION_ID = randomBytes(16).toString('hex');

// Budget for one whole `browser` command, however many steps it has. Must stay
// under the sandbox's `sendTunnelCommand('browser', …)` timeout so this layer —
// which knows which step was slow — is the one that reports the failure, rather
// than the caller giving up first and returning a bare "timeout (Ns)" with no
// error code and none of the step results.
const COMMAND_BUDGET_MS = 100_000;

// Monotonic chunk sequence within the recording session. Only advances when a
// chunk is actually uploaded, so the frontend never sees a gap.
let recordingSeq = 0;

function nextRecordingSeq(): number {
  return recordingSeq++;
}

export async function handleBrowser(
  ctx: CommandContext,
  cmd: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!ctx.state.proxy) throw new CommandError('No active proxy', 'NO_BROWSER');

  const steps = cmd.steps as Array<Record<string, unknown>>;
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new CommandError(
      'browser action requires a non-empty "steps" array',
      'INVALID_INPUT',
    );
  }

  // One budget for the whole command, shared by every step. Each step used to
  // carry its own independent timeout — 120s per browser-agent batch plus 20s or
  // 90s per capture — so a four-step command could legitimately run for 350s
  // while the caller gave up at 120s and dropped the result. Now the steps draw
  // down a single envelope that fits inside the caller's.
  const deadline = Date.now() + COMMAND_BUDGET_MS;
  const remaining = () => Math.max(1_000, deadline - Date.now());

  // A CDP Page is only needed by steps that drive Chrome directly (captures,
  // setViewport); the rest run in the page over the browser-agent WS. Requiring
  // one up front failed the whole command the moment Chrome was between
  // launches, and did so *ahead of* `dispatchBrowserCommand`'s own wait for the
  // client to reconnect — so a snapshot gave up instantly on a browser that was
  // seconds from being back.
  const requirePage = (): Page => {
    const page = ctx.state.browser?.getActivePage();
    if (!page) {
      throw new CommandError(
        'Sandbox browser unavailable — headless Chrome is required for automation',
        'NO_BROWSER',
      );
    }
    return page;
  };

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
    const out = await ctx.state.proxy!.dispatchBrowserCommand(
      batch,
      remaining(),
    );
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
      // Record a capture failure as this step's error rather than throwing out
      // of the whole command. A capture is the step most likely to fail (a page
      // that renders continuously can miss its deadline while everything else
      // about it works), and throwing here discarded every result already
      // collected — a `[snapshot, screenshotViewport]` batch came back as
      // nothing but the timeout, so the caller re-ran the snapshot it had
      // already been given. Every other step type reports its own error and
      // lets the batch finish; the aggregation below marks the command failed.
      try {
        const captured = await captureScreenshotStep(
          ctx,
          requirePage(),
          step as Record<string, unknown>,
          command,
          remaining(),
        );
        resultsByIndex[i] = { index: i, command, result: captured };
        totalDuration += captured._durationMs ?? 0;
        delete captured._durationMs;
      } catch (err) {
        resultsByIndex[i] = {
          index: i,
          command,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    } else if (command === 'navigate') {
      // Navigation executes tunnel-side via CDP, never inside the in-page WS
      // batch: a hard load tears down the browser-agent mid-batch (the WS
      // client and all state die with the document), which is what the whole
      // stash/resume + disconnect-reconcile machinery existed to survive.
      // Splitting here means in-page batches never span a page boundary we
      // created — dispatch already waits for the agent's reconnect before the
      // next flush. The result carries the URL actually landed on, so
      // app-side redirects are visible to the caller (the in-page path's
      // blind 'ok' hid them). Same-origin stays a soft route change;
      // `fresh: true` or cross-origin forces a real load.
      await flushBuffer();
      try {
        if (typeof step.url !== 'string' || step.url.length === 0) {
          throw new CommandError(
            'navigate command requires a "url" field',
            'INVALID_INPUT',
          );
        }
        const page = requirePage();
        const start = Date.now();
        const nav = await navigateTunnelSide(
          page,
          {
            url: step.url,
            fresh: step.fresh === true,
            proxyPort: ctx.state.proxyPort,
          },
          remaining(),
        );
        resultsByIndex[i] = { index: i, command, result: nav };
        totalDuration += Date.now() - start;
      } catch (err) {
        resultsByIndex[i] = {
          index: i,
          command,
          error: err instanceof Error ? err.message : String(err),
        };
        // Later steps would run against whatever page we're stranded on —
        // stop, matching the in-page executor's stop-on-first-error.
        break;
      }
    } else if (command === 'setViewport') {
      // Hot-swap the headless browser's viewport (desktop ↔ mobile) via the
      // supervisor's tested resize+reload path. Handled inline like screenshots
      // — it acts on the puppeteer page / supervisor, not the browser-agent WS
      // dispatch. Flush first so buffered steps run before the reload; any steps
      // after this one flush post-reload (same as `navigate`'s page-load
      // behavior — the browser-agent WS reconnects and dispatch waits for it).
      await flushBuffer();
      const requested = step.mode;
      let mode: PreviewMode | null;
      if (requested === 'desktop' || requested === 'mobile') {
        mode = requested;
      } else if (requested === 'default' || requested === undefined) {
        // `default` (used by the per-run reset, not offered to the agent) maps
        // to the app's configured preview mode, falling back to desktop.
        mode = ctx.state.lastWebConfig?.defaultPreviewMode ?? 'desktop';
      } else {
        mode = null;
      }
      if (mode === null) {
        resultsByIndex[i] = {
          index: i,
          command,
          error: `Invalid viewport mode "${String(requested)}" — expected "desktop" or "mobile"`,
        };
      } else if (!ctx.state.browser) {
        resultsByIndex[i] = {
          index: i,
          command,
          error:
            'Sandbox browser unavailable — headless Chrome is required to set the viewport',
        };
      } else {
        const start = Date.now();
        // Explicit desktop/mobile: no-ops when the mode already matches
        // (no reload); reloads otherwise. The per-run reset (`default`,
        // sent at the start of every QA run, never by the agent) always
        // reloads even when the viewport matches: a fresh document is the
        // reset's real job. The headless page has no other guaranteed
        // refresh path — failed hot-updates leave it on a stale bundle
        // (still running deleted code), and the proxy's reload broadcasts
        // deliberately skip headless — so QA must never start on the
        // previous run's document. Only the literal 'default' counts as the
        // reset — the sidecar always sends it explicitly, while an agent
        // step that omitted `mode` (the schema doesn't require it) still
        // maps to the app default WITHOUT forcing a mid-run reload.
        const isRunReset = requested === 'default';
        try {
          await ctx.state.browser.setPreviewMode(mode, {
            forceReload: isRunReset,
          });
          const applied = ctx.state.browser.getPreviewMode();
          resultsByIndex[i] = {
            index: i,
            command,
            result: {
              previewMode: applied,
              viewport: viewportToString(viewportFor(applied)),
            },
          };
          totalDuration += Date.now() - start;
        } catch (err) {
          // The reload inside the viewport change failed — the page never got
          // the fresh document this step promises. Report it and stop: later
          // steps would run against whatever document we're stranded on
          // (matching `navigate`'s stop-on-first-error).
          resultsByIndex[i] = {
            index: i,
            command,
            error: `Viewport change failed: ${err instanceof Error ? err.message : String(err)}`,
          };
          totalDuration += Date.now() - start;
          break;
        }
      }
    } else {
      buffer.push({ idx: i, step });
    }
  }
  await flushBuffer();

  const densified = resultsByIndex.map(
    (r, idx) =>
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
  budgetMs: number,
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
    budgetMs,
    path: typeof step.path === 'string' ? step.path : undefined,
    proxyPort: ctx.state.proxyPort ?? undefined,
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
    const { uploadUrl, uploadFields, publicUrl, path } = await getUploadUrl(
      appId,
      session.sessionId,
      'json',
      'application/json',
      'private',
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
    const seq = nextRecordingSeq();
    log.info('browser', 'Recording chunk uploaded', {
      bytes: body.length,
      events: events.length,
      seq,
      containsSnapshot,
      private: Boolean(path),
    });
    return {
      // An API that predates private chunks ignores `access` and returns a
      // public URL — carry whichever locator it gave us.
      ...(path ? { path } : { url: publicUrl }),
      sessionId: RECORDING_SESSION_ID,
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
