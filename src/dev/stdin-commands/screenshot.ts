import { fetchCallbackToken } from '../api';
import { getApiBaseUrl } from '../../config';
import type { SessionState, EmitFn } from './types';

export async function handleScreenshot(
  state: SessionState,
  emit: EmitFn,
): Promise<void> {
  if (!state.proxy) {
    emit('command-error', { message: 'No active proxy' });
    return;
  }
  if (!state.proxy.isBrowserConnected()) {
    emit('command-error', { message: 'No browser connected, please refresh the MindStudio preview' });
    return;
  }
  if (!state.runner?.getSession() || !state.appConfig?.appId) {
    emit('command-error', { message: 'No active session' });
    return;
  }

  try {
    const startTime = Date.now();

    // 1. Dispatch screenshot command to browser
    const result = await state.proxy.dispatchBrowserCommand([{ command: 'screenshot' }]);
    const stepResult = (result.steps as Array<Record<string, unknown>>)?.[0]
      ?.result as { image: string; width: number; height: number };

    if (!stepResult?.image) {
      emit('command-error', { message: 'Screenshot capture returned no image data' });
      return;
    }

    // 2. Fetch a callback token for S3 upload auth
    const session = state.runner.getSession()!;
    const token = await fetchCallbackToken(state.appConfig.appId, session.sessionId);

    // 3. Get presigned upload URL
    const uploadResponse = await fetch(
      `${getApiBaseUrl()}/_internal/v2/sandbox/upload`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ extension: 'png', contentType: 'image/png' }),
      },
    );

    if (!uploadResponse.ok) {
      const err = await uploadResponse.text();
      emit('command-error', { message: `Failed to get upload URL: ${uploadResponse.status} ${err}` });
      return;
    }

    const { uploadUrl, uploadFields, publicUrl } = (await uploadResponse.json()) as {
      uploadUrl: string;
      uploadFields: Record<string, string>;
      publicUrl: string;
    };

    // 4. Upload to S3
    const imageBuffer = Buffer.from(stepResult.image, 'base64');
    const form = new FormData();
    for (const [key, value] of Object.entries(uploadFields)) {
      form.append(key, value);
    }
    form.append('file', new Blob([imageBuffer], { type: 'image/png' }), 'screenshot.png');
    const uploadResult = await fetch(uploadUrl, { method: 'POST', body: form });

    if (!uploadResult.ok) {
      emit('command-error', { message: `S3 upload failed: ${uploadResult.status}` });
      return;
    }

    // 5. Emit result
    emit('screenshot-completed', {
      url: publicUrl,
      width: stepResult.width,
      height: stepResult.height,
      duration: Date.now() - startTime,
    });
  } catch (err) {
    emit('command-error', {
      message: err instanceof Error ? err.message : 'Screenshot failed',
    });
  }
}
