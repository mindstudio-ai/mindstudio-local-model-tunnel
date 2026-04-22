import { getUploadUrl } from '../api';
import { captureViaCdp } from '../browser';
import { log } from '../logging/logger';
import { CommandError } from './types';
import type { CommandContext } from './types';
import type { Page } from 'puppeteer-core';

// Recordings smaller than this (after JSON serialization) aren't worth
// the round trip — probably a FullSnapshot with no interesting deltas.
const MIN_RECORDING_BYTES = 5_000;

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
  const recordingUrl = await uploadRecording(ctx, allEvents);

  return {
    success: !hasStepError,
    ...(hasStepError ? { errorCode: 'BROWSER_ERROR' } : {}),
    steps: densified,
    snapshot: lastSnapshot,
    logs: lastLogs,
    duration: totalDuration,
    ...(recordingUrl ? { recordingUrl } : {}),
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
 * Upload an rrweb event array to S3 using the same presigned-URL flow
 * screenshots use. Returns the public URL on success, null on any failure
 * (including too-small recordings that aren't worth keeping).
 */
async function uploadRecording(
  ctx: CommandContext,
  events: unknown[],
): Promise<string | null> {
  if (events.length === 0) return null;
  const session = ctx.state.runner?.getSession();
  const appId = ctx.state.appConfig?.appId;
  if (!session || !appId) return null;

  const body = JSON.stringify(events);
  if (body.length < MIN_RECORDING_BYTES) return null;

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
    log.info('browser', 'Recording uploaded', {
      bytes: body.length,
      events: events.length,
    });
    return publicUrl;
  } catch (err) {
    log.warn('browser', 'Recording upload errored', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
