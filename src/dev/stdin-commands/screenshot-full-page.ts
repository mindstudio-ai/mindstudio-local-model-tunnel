import { getUploadUrl } from '../api';
import { captureViaCdp } from '../browser';
import { CommandError } from './types';
import type { CommandContext } from './types';

export async function handleScreenshotFullPage(
  ctx: CommandContext,
  cmd: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!ctx.state.runner?.getSession() || !ctx.state.appConfig?.appId) {
    throw new CommandError('No active session', 'NO_SESSION');
  }
  const page = ctx.state.browser?.getActivePage();
  if (!page) {
    throw new CommandError(
      'Sandbox browser unavailable — headless Chrome is required for screenshots',
      'NO_BROWSER',
    );
  }

  const startTime = Date.now();

  const session = ctx.state.runner.getSession()!;
  const { uploadUrl, uploadFields, publicUrl } = await getUploadUrl(
    ctx.state.appConfig.appId,
    session.sessionId,
    'jpg',
    'image/jpeg',
  );

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
}
