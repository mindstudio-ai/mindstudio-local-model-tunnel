import { getUploadUrl } from '../api';
import { captureViaCdp } from '../browser';
import { log } from '../logging/logger';
import { CommandError } from './types';
import type { CommandContext } from './types';

export async function handleScreenshotFullPage(
  ctx: CommandContext,
  cmd: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!ctx.state.proxy) throw new CommandError('No active proxy', 'NO_BROWSER');
  if (!ctx.state.runner?.getSession() || !ctx.state.appConfig?.appId) {
    throw new CommandError('No active session', 'NO_SESSION');
  }

  const startTime = Date.now();

  // 1. Get presigned upload URL — used by both CDP and WS paths.
  const session = ctx.state.runner.getSession()!;
  const { uploadUrl, uploadFields, publicUrl } = await getUploadUrl(
    ctx.state.appConfig.appId,
    session.sessionId,
    'jpg',
    'image/jpeg',
  );

  // 2. CDP fast path: if the sandbox headless browser is alive, capture real
  //    pixels directly and skip the WS round-trip. On any failure fall
  //    through to the WS path so we never harden user-visible errors.
  const page = ctx.state.browser?.getActivePage();
  if (page) {
    try {
      const r = await captureViaCdp(page, {
        fullPage: true,
        path: typeof cmd.path === 'string' ? cmd.path : undefined,
        uploadUrl,
        uploadFields,
      });
      return {
        success: true,
        url: publicUrl,
        width: r.width,
        height: r.height,
        ...(r.styleMap ? { styleMap: r.styleMap } : {}),
        duration: Date.now() - startTime,
      };
    } catch (err) {
      log.warn('browser', 'CDP screenshot failed — falling back to WS path', {
        error: err instanceof Error ? err.message : String(err),
      });
      // Fall through.
    }
  }

  // 3. WS path: require a connected browser client.
  if (!ctx.state.proxy.isBrowserConnected()) {
    throw new CommandError('No browser connected', 'NO_BROWSER');
  }

  const steps: Array<Record<string, unknown>> = [];
  if (cmd.path) {
    steps.push({ command: 'navigate', url: cmd.path as string });
  }
  steps.push({ command: 'screenshotFullPage', uploadUrl, uploadFields });

  const result = await ctx.state.proxy.dispatchBrowserCommand(steps, 120_000);

  const resultSteps = result.steps as Array<Record<string, unknown>>;
  const stepResult = resultSteps?.[resultSteps.length - 1]
    ?.result as { width: number; height: number; uploaded?: boolean; styleMap?: string } | undefined;

  if (!stepResult?.uploaded) {
    throw new CommandError('Screenshot capture or upload failed', 'UPLOAD_FAILED');
  }

  return {
    success: true,
    url: publicUrl,
    width: stepResult.width,
    height: stepResult.height,
    ...(stepResult.styleMap ? { styleMap: stepResult.styleMap } : {}),
    duration: Date.now() - startTime,
  };
}
