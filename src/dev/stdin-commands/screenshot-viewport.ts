import { getUploadUrl } from '../api';
import { captureViaCdp } from '../browser';
import { CommandError } from './types';
import type { CommandContext } from './types';

export async function handleScreenshotViewport(
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

  // Optional exact-size + format (e.g. a 1200×630 PNG Open Graph card). The S3
  // object key — and therefore the returned public URL — is keyed off the
  // extension, so it must match the captured format.
  const format: 'png' | 'jpeg' = cmd.format === 'png' ? 'png' : 'jpeg';
  const extension = format === 'png' ? 'png' : 'jpg';
  const contentType = format === 'png' ? 'image/png' : 'image/jpeg';

  const session = ctx.state.runner.getSession()!;
  const { uploadUrl, uploadFields, publicUrl } = await getUploadUrl(
    ctx.state.appConfig.appId,
    session.sessionId,
    extension,
    contentType,
  );

  const r = await captureViaCdp(page, {
    fullPage: false,
    path: typeof cmd.path === 'string' ? cmd.path : undefined,
    scrollToSelector:
      typeof cmd.scrollToSelector === 'string'
        ? cmd.scrollToSelector
        : undefined,
    scrollY: typeof cmd.scrollY === 'number' ? cmd.scrollY : undefined,
    width: typeof cmd.width === 'number' ? cmd.width : undefined,
    height: typeof cmd.height === 'number' ? cmd.height : undefined,
    format,
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
