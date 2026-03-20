import { getUploadUrl } from '../api';
import type { SessionState, EmitFn } from './types';

export async function handleScreenshot(
  state: SessionState,
  emit: EmitFn,
): Promise<void> {
  const fail = (message: string) => {
    emit('screenshot-completed', {
      url: '',
      width: 0,
      height: 0,
      duration: 0,
      error: message,
    });
  };

  if (!state.proxy) {
    fail('No active proxy');
    return;
  }
  if (!state.proxy.isBrowserConnected()) {
    fail('No browser connected, please refresh the MindStudio preview');
    return;
  }
  if (!state.runner?.getSession() || !state.appConfig?.appId) {
    fail('No active session');
    return;
  }

  try {
    const startTime = Date.now();

    // 1. Dispatch screenshot command to browser
    const result = await state.proxy.dispatchBrowserCommand([{ command: 'screenshot' }]);
    const stepResult = (result.steps as Array<Record<string, unknown>>)?.[0]
      ?.result as { image: string; width: number; height: number };

    if (!stepResult?.image) {
      fail('Screenshot capture returned no image data');
      return;
    }

    // 2. Get presigned upload URL
    const session = state.runner.getSession()!;
    const { uploadUrl, uploadFields, publicUrl } = await getUploadUrl(
      state.appConfig.appId,
      session.sessionId,
      'png',
      'image/png',
    );

    // 3. Upload to S3
    const imageBuffer = Buffer.from(stepResult.image, 'base64');
    const form = new FormData();
    for (const [key, value] of Object.entries(uploadFields)) {
      form.append(key, value);
    }
    form.append('file', new Blob([imageBuffer], { type: 'image/png' }), 'screenshot.png');
    const uploadResult = await fetch(uploadUrl, { method: 'POST', body: form });

    if (!uploadResult.ok) {
      fail(`S3 upload failed: ${uploadResult.status}`);
      return;
    }

    // 4. Emit result
    emit('screenshot-completed', {
      url: publicUrl,
      width: stepResult.width,
      height: stepResult.height,
      duration: Date.now() - startTime,
    });
  } catch (err) {
    fail(err instanceof Error ? err.message : 'Screenshot failed');
  }
}
