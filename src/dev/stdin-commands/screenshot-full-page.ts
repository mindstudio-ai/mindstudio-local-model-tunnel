import { getUploadUrl } from '../api';
import type { CommandContext } from './types';

export async function handleScreenshotFullPage(
  ctx: CommandContext,
  cmd: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!ctx.state.proxy) throw new Error('No active proxy');
  if (!ctx.state.proxy.isBrowserConnected()) {
    throw new Error('No browser connected, please refresh the MindStudio preview');
  }
  if (!ctx.state.runner?.getSession() || !ctx.state.appConfig?.appId) {
    throw new Error('No active session');
  }

  const startTime = Date.now();

  // 1. Get presigned upload URL before dispatching to browser
  const session = ctx.state.runner.getSession()!;
  const { uploadUrl, uploadFields, publicUrl } = await getUploadUrl(
    ctx.state.appConfig.appId,
    session.sessionId,
    'jpg',
    'image/jpeg',
  );

  // 2. Dispatch to browser — optionally navigate first, then full-page screenshot
  const steps: Array<Record<string, unknown>> = [];
  if (cmd.path) {
    steps.push({ command: 'navigate', url: cmd.path as string });
  }
  steps.push({ command: 'screenshotFullPage', uploadUrl, uploadFields });

  const result = await ctx.state.proxy.dispatchBrowserCommand(steps, 120_000);

  // The screenshot result is the last step
  const resultSteps = result.steps as Array<Record<string, unknown>>;
  const stepResult = resultSteps?.[resultSteps.length - 1]
    ?.result as { width: number; height: number; uploaded?: boolean; styleMap?: string } | undefined;

  if (!stepResult?.uploaded) {
    throw new Error('Screenshot capture or upload failed');
  }

  return {
    url: publicUrl,
    width: stepResult.width,
    height: stepResult.height,
    ...(stepResult.styleMap ? { styleMap: stepResult.styleMap } : {}),
    duration: Date.now() - startTime,
  };
}
