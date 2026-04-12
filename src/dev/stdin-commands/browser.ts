import { getUploadUrl } from '../api';
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

  const result = await ctx.state.proxy.dispatchBrowserCommand(preparedSteps);

  // Replace uploaded screenshot results with the public URL
  const resultSteps = (result.steps as Array<Record<string, unknown>>) ?? [];
  for (const step of resultSteps) {
    const stepResult = step.result as Record<string, unknown> | undefined;
    if (stepResult?.uploaded && stepResult?._publicUrl) {
      stepResult.url = stepResult._publicUrl;
      delete stepResult.uploaded;
      delete stepResult._publicUrl;
      delete stepResult.image;
    }
  }

  // Check for step-level errors from the browser agent
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
