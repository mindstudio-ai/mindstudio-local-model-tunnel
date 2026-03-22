import type { SessionState, EmitFn } from './types';

/**
 * Handle explicit signal that the upstream dev server is restarting.
 * Marks the upstream as down so the proxy's health check will detect
 * when it's back and auto-reload the browser.
 */
export async function handleDevServerRestarting(
  state: SessionState,
  emit: EmitFn,
): Promise<void> {
  if (!state.proxy) {
    emit('command-error', { message: 'No active proxy' });
    return;
  }
  state.proxy.markUpstreamDown();
  emit('dev-server-restarting-ack', {});
}
