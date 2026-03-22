import type { SessionState, EmitFn } from './types';

/**
 * Reset the browser to a clean state by reloading the page.
 * The agent sends this explicitly when done testing.
 * Fire-and-forget — the reload kills the page so no result comes back.
 */
export function handleResetBrowser(
  state: SessionState,
  emit: EmitFn,
): void {
  if (!state.proxy) {
    emit('command-error', { message: 'No active proxy' });
    return;
  }
  if (!state.proxy.isBrowserConnected()) {
    emit('command-error', { message: 'No browser connected' });
    return;
  }
  state.proxy.dispatchBrowserCommand([{ command: 'reload' }]).catch(() => {});
  emit('reset-browser-completed', {});
}
