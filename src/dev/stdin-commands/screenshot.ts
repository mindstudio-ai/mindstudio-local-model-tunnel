import { getUploadUrl } from '../api';
import type { CommandContext } from './types';

export async function handleScreenshot(
  ctx: CommandContext,
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

  // 2. Dispatch screenshot command with upload details — browser uploads directly to S3
  const result = await ctx.state.proxy.dispatchBrowserCommand(
    [{ command: 'screenshot', fullPage: true, uploadUrl, uploadFields }],
    120_000,
  );

  const stepResult = (result.steps as Array<Record<string, unknown>>)?.[0]
    ?.result as { width: number; height: number; uploaded?: boolean } | undefined;

  if (!stepResult?.uploaded) {
    throw new Error('Screenshot capture or upload failed');
  }

  return {
    url: publicUrl,
    width: stepResult.width,
    height: stepResult.height,
    duration: Date.now() - startTime,
  };
}
