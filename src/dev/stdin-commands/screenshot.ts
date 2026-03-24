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

  // 1. Dispatch screenshot command to browser
  const result = await ctx.state.proxy.dispatchBrowserCommand([{ command: 'screenshot' }], 120_000);
  const stepResult = (result.steps as Array<Record<string, unknown>>)?.[0]
    ?.result as { image: string; width: number; height: number };

  if (!stepResult?.image) throw new Error('Screenshot capture returned no image data');

  // 2. Get presigned upload URL
  const session = ctx.state.runner.getSession()!;
  const { uploadUrl, uploadFields, publicUrl } = await getUploadUrl(
    ctx.state.appConfig.appId,
    session.sessionId,
    'jpg',
    'image/jpeg',
  );

  // 3. Upload to S3
  const imageBuffer = Buffer.from(stepResult.image, 'base64');
  const form = new FormData();
  for (const [key, value] of Object.entries(uploadFields)) {
    form.append(key, value);
  }
  form.append('file', new Blob([imageBuffer], { type: 'image/jpeg' }), 'screenshot.jpg');
  const uploadResult = await fetch(uploadUrl, { method: 'POST', body: form });

  if (!uploadResult.ok) throw new Error(`S3 upload failed: ${uploadResult.status}`);

  return {
    url: publicUrl,
    width: stepResult.width,
    height: stepResult.height,
    duration: Date.now() - startTime,
  };
}
