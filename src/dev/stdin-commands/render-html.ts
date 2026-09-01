import { getUploadUrl } from '../api';
import {
  renderHtmlCapture,
  RENDER_MIN_DIMENSION as MIN_DIMENSION,
  RENDER_MAX_DIMENSION as MAX_DIMENSION,
} from '../browser';
import { CommandError } from './types';
import type { CommandContext } from './types';

/**
 * Render an agent-authored HTML document in a fresh browser tab and capture
 * it as a PNG. Used for deterministic brand graphics (share cards, wordmarks,
 * flat icon tiles) where the design agent composes HTML/CSS and needs real
 * pixels back — as opposed to the screenshot commands, which photograph the
 * served app.
 *
 * `width`/`height` are the exact canvas by default. With `autoHeight`, the
 * height is a starting viewport and the capture is fitted to whatever the
 * document turns out to need — for documents that declare no height of their
 * own, where an exact canvas either clips them or pads them out.
 */
export async function handleRenderHtml(
  ctx: CommandContext,
  cmd: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!ctx.state.runner?.getSession() || !ctx.state.appConfig?.appId) {
    throw new CommandError('No active session', 'NO_SESSION');
  }
  const page = ctx.state.browser?.getActivePage();
  if (!page) {
    throw new CommandError(
      'Sandbox browser unavailable — headless Chrome is required for HTML rendering',
      'NO_BROWSER',
    );
  }

  const html = typeof cmd.html === 'string' ? cmd.html : '';
  const width = typeof cmd.width === 'number' ? Math.round(cmd.width) : 0;
  const height = typeof cmd.height === 'number' ? Math.round(cmd.height) : 0;
  if (
    !html ||
    width < MIN_DIMENSION ||
    width > MAX_DIMENSION ||
    height < MIN_DIMENSION ||
    height > MAX_DIMENSION
  ) {
    throw new CommandError(
      `renderHtml requires a non-empty html string plus width/height between ${MIN_DIMENSION} and ${MAX_DIMENSION}`,
      'INVALID_INPUT',
    );
  }
  const scale =
    typeof cmd.scale === 'number'
      ? Math.min(Math.max(Math.round(cmd.scale), 1), 3)
      : 1;

  const startTime = Date.now();

  const session = ctx.state.runner.getSession()!;
  const { uploadUrl, uploadFields, publicUrl } = await getUploadUrl(
    ctx.state.appConfig.appId,
    session.sessionId,
    'png',
    'image/png',
  );

  const r = await renderHtmlCapture(page, {
    html,
    width,
    height,
    scale,
    autoHeight: cmd.autoHeight === true,
    transparent: cmd.transparent === true,
    uploadUrl,
    uploadFields,
  });

  return {
    success: true,
    url: publicUrl,
    width: r.width,
    height: r.height,
    duration: Date.now() - startTime,
  };
}
