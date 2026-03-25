/**
 * Subscribe to DevRunner events and relay them as system events to stdout.
 * Only relays genuinely unsolicited events (poll-loop methods, connection, auth).
 * Command responses (scenarios, impersonation) are handled by stdin handlers directly.
 *
 * Returns an array of unsubscribe functions for cleanup on teardown.
 */

import { devRequestEvents } from './events';
import { emitEvent } from './ipc';

export function subscribeDevEvents(
  shutdown: () => Promise<void>,
): Array<() => void> {
  const unsubs: Array<() => void> = [];

  // Platform-triggered method execution (poll loop)
  unsubs.push(
    devRequestEvents.onStart((event) => {
      emitEvent('platform-method-started', { id: event.id, method: event.method });
    }),
  );

  unsubs.push(
    devRequestEvents.onComplete((event) => {
      emitEvent('platform-method-completed', {
        id: event.id,
        success: event.success,
        duration: event.duration,
        ...(event.error ? { error: event.error } : {}),
      });
    }),
  );

  // Connection health
  unsubs.push(
    devRequestEvents.onConnectionWarning((message) => {
      emitEvent('connection-lost', { message });
    }),
  );

  unsubs.push(
    devRequestEvents.onConnectionRestored(() => {
      emitEvent('connection-restored');
    }),
  );

  // Session expiry
  unsubs.push(
    devRequestEvents.onSessionExpired(() => {
      emitEvent('session-expired');
      shutdown().then(() => process.exit(1));
    }),
  );

  // Auth refresh
  unsubs.push(
    devRequestEvents.onAuthRefreshStart((url) => {
      emitEvent('auth-refresh-start', { url });
    }),
  );

  unsubs.push(
    devRequestEvents.onAuthRefreshSuccess(() => {
      emitEvent('auth-refresh-success');
    }),
  );

  unsubs.push(
    devRequestEvents.onAuthRefreshFailed(() => {
      emitEvent('auth-refresh-failed');
    }),
  );

  return unsubs;
}
