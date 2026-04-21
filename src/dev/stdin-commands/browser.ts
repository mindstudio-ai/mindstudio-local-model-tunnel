import { getUploadUrl } from '../api';
import { captureViaCdp } from '../browser';
import { log } from '../logging/logger';
import { CommandError } from './types';
import type { CommandContext } from './types';

export async function handleBrowser(
  ctx: CommandContext,
  cmd: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!ctx.state.proxy) throw new CommandError('No active proxy', 'NO_BROWSER');

  const steps = cmd.steps as Array<Record<string, unknown>>;
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new CommandError('browser action requires a non-empty "steps" array', 'INVALID_INPUT');
  }

  // Inject upload details into any screenshotViewport steps so the browser
  // uploads directly to S3 instead of sending base64 over the WS connection.
  const preparedSteps = await injectScreenshotUploads(ctx, steps);

  // If the sandbox headless browser is alive AND the batch contains a step
  // we can intercept (screenshot*), run a split-dispatch: non-screenshot
  // sub-batches flow through WS in order; screenshot steps are captured via
  // CDP inline. On any CDP-step failure, the step falls through into the
  // next WS sub-batch so we never harden existing behavior.
  const page = ctx.state.browser?.getActivePage();
  const hasInterceptable = preparedSteps.some(isInterceptableStep);
  log.debug('browser', 'handleBrowser dispatch decision', {
    hasActivePage: !!page,
    hasInterceptable,
    stepCommands: preparedSteps.map((s) => s.command),
  });
  if (page && hasInterceptable) {
    log.info('browser', 'handleBrowser using split-dispatch (CDP + WS)', {
      stepCount: preparedSteps.length,
    });
    const result = await dispatchSplit(ctx, preparedSteps, page);
    normalizeUploadedResults(result.steps);
    return result;
  }

  // Fast path: single dispatch, unchanged from before.
  const result = await ctx.state.proxy.dispatchBrowserCommand(preparedSteps);

  const resultSteps = (result.steps as Array<Record<string, unknown>>) ?? [];
  normalizeUploadedResults(resultSteps);

  const hasStepError = resultSteps.some((s) => s.error);

  return {
    success: !hasStepError,
    ...(hasStepError ? { errorCode: 'BROWSER_ERROR' } : {}),
    steps: resultSteps,
    snapshot: result.snapshot,
    logs: result.logs,
    duration: result.duration,
  };
}

function isInterceptableStep(step: Record<string, unknown>): boolean {
  const cmd = step.command;
  if (cmd !== 'screenshotViewport' && cmd !== 'screenshotFullPage') return false;
  return typeof step.uploadUrl === 'string';
}

/**
 * Run a batch where some steps go via WS and some (screenshots) via CDP.
 * Ordering is preserved by indexing results into a dense array. A failed
 * CDP capture falls through into the next WS sub-batch.
 */
async function dispatchSplit(
  ctx: CommandContext,
  preparedSteps: Array<Record<string, unknown>>,
  page: import('puppeteer-core').Page,
): Promise<{
  success: boolean;
  errorCode?: string;
  steps: Array<Record<string, unknown>>;
  snapshot: string;
  logs: unknown[];
  duration: number;
}> {
  if (!ctx.state.proxy) {
    throw new CommandError('No active proxy', 'NO_BROWSER');
  }
  const resultsByIndex = new Array<Record<string, unknown> | undefined>(
    preparedSteps.length,
  );
  let lastSnapshot = '';
  let lastLogs: unknown[] = [];
  let totalDuration = 0;

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
    buffer = [];
  };

  for (let i = 0; i < preparedSteps.length; i++) {
    const step = preparedSteps[i];
    if (isInterceptableStep(step)) {
      await flushBuffer();
      const cdpStart = Date.now();
      try {
        const r = await captureViaCdp(page, {
          fullPage: step.command === 'screenshotFullPage',
          uploadUrl: step.uploadUrl as string,
          uploadFields: step.uploadFields as Record<string, string>,
        });
        const stepResult: Record<string, unknown> = { ...r };
        if (typeof step._publicUrl === 'string') {
          stepResult._publicUrl = step._publicUrl;
        }
        resultsByIndex[i] = {
          index: i,
          command: step.command,
          result: stepResult,
        };
        totalDuration += Date.now() - cdpStart;
      } catch (err) {
        log.warn('browser', 'CDP step capture failed — deferring to WS', {
          error: err instanceof Error ? err.message : String(err),
          stepCommand: step.command,
        });
        buffer.push({ idx: i, step });
      }
    } else {
      buffer.push({ idx: i, step });
    }
  }
  await flushBuffer();

  const densified = resultsByIndex.map((r, idx) =>
    r ?? { index: idx, command: preparedSteps[idx].command, error: 'no result' },
  );
  const hasStepError = densified.some((s) => s.error);

  return {
    success: !hasStepError,
    ...(hasStepError ? { errorCode: 'BROWSER_ERROR' } : {}),
    steps: densified,
    snapshot: lastSnapshot,
    logs: lastLogs,
    duration: totalDuration,
  };
}

/**
 * Replace uploaded screenshot step results with the public URL, matching
 * the contract the stdin caller expects.
 */
function normalizeUploadedResults(resultSteps: Array<Record<string, unknown>>): void {
  for (const step of resultSteps) {
    const stepResult = step.result as Record<string, unknown> | undefined;
    if (stepResult?.uploaded && stepResult?._publicUrl) {
      stepResult.url = stepResult._publicUrl;
      delete stepResult.uploaded;
      delete stepResult._publicUrl;
      delete stepResult.image;
    }
  }
}

/**
 * For each screenshotViewport step, get a presigned upload URL and attach it.
 * Non-screenshot steps are passed through unchanged.
 */
async function injectScreenshotUploads(
  ctx: CommandContext,
  steps: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const session = ctx.state.runner?.getSession();
  const appId = ctx.state.appConfig?.appId;
  if (!session || !appId) return steps;

  const prepared: Array<Record<string, unknown>> = [];
  for (const step of steps) {
    if (step.command === 'screenshotViewport') {
      try {
        const { uploadUrl, uploadFields, publicUrl } = await getUploadUrl(
          appId,
          session.sessionId,
          'jpg',
          'image/jpeg',
        );
        prepared.push({ ...step, uploadUrl, uploadFields, _publicUrl: publicUrl });
      } catch {
        // If we can't get an upload URL, fall back to inline base64
        prepared.push(step);
      }
    } else {
      prepared.push(step);
    }
  }
  return prepared;
}
