import type { SessionState, EmitFn } from './types';

export async function handleImpersonate(
  state: SessionState,
  cmd: Record<string, unknown>,
  emit: EmitFn,
): Promise<void> {
  if (!state.runner) {
    emit('command-error', { message: 'No active session' });
    return;
  }
  const roles = cmd.roles as string[];
  if (!Array.isArray(roles)) {
    emit('command-error', { message: 'impersonate requires roles array' });
    return;
  }
  await state.runner.setImpersonation(roles);
}

export async function handleClearImpersonation(
  state: SessionState,
  emit: EmitFn,
): Promise<void> {
  if (!state.runner) {
    emit('command-error', { message: 'No active session' });
    return;
  }
  await state.runner.clearImpersonation();
}
