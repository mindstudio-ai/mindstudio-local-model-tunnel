/**
 * Subscribe to DevRunner events and relay them as JSON to stdout.
 * Returns an array of unsubscribe functions for cleanup on teardown.
 */

import { devRequestEvents } from './events';

type EmitFn = (event: string, data?: Record<string, unknown>) => void;

export function subscribeDevEvents(
  emit: EmitFn,
  shutdown: () => Promise<void>,
): Array<() => void> {
  const unsubs: Array<() => void> = [];

  unsubs.push(
    devRequestEvents.onStart((event) => {
      emit('method-started', { id: event.id, method: event.method });
    }),
  );

  unsubs.push(
    devRequestEvents.onComplete((event) => {
      emit('method-completed', {
        id: event.id,
        success: event.success,
        duration: event.duration,
        ...(event.error ? { error: event.error } : {}),
      });
    }),
  );

  unsubs.push(
    devRequestEvents.onConnectionWarning((message) => {
      emit('connection-lost', { message });
    }),
  );

  unsubs.push(
    devRequestEvents.onConnectionRestored(() => {
      emit('connection-restored');
    }),
  );

  unsubs.push(
    devRequestEvents.onSessionExpired(() => {
      emit('session-expired');
      shutdown().then(() => process.exit(1));
    }),
  );

  unsubs.push(
    devRequestEvents.onAuthRefreshStart((url) => {
      emit('auth-refresh-start', { url });
    }),
  );

  unsubs.push(
    devRequestEvents.onAuthRefreshSuccess(() => {
      emit('auth-refresh-success');
    }),
  );

  unsubs.push(
    devRequestEvents.onAuthRefreshFailed(() => {
      emit('auth-refresh-failed');
    }),
  );

  unsubs.push(
    devRequestEvents.onImpersonate((event) => {
      emit('impersonation-changed', { roles: event.roles });
    }),
  );

  unsubs.push(
    devRequestEvents.onScenarioStart((event) => {
      emit('scenario-started', { id: event.id, name: event.name });
    }),
  );

  unsubs.push(
    devRequestEvents.onScenarioComplete((event) => {
      emit('scenario-completed', {
        id: event.id,
        success: event.success,
        duration: event.duration,
        roles: event.roles,
        ...(event.error ? { error: event.error } : {}),
      });
    }),
  );

  return unsubs;
}
