import type { SessionState, EmitFn } from './types';

export function handleBrowserStatus(
  state: SessionState,
  emit: EmitFn,
): void {
  emit('browser-status', {
    connected: state.proxy?.isBrowserConnected() ?? false,
  });
}
