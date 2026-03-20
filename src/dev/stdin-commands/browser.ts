import type { SessionState, EmitFn } from './types';

export async function handleBrowser(
  state: SessionState,
  cmd: Record<string, unknown>,
  emit: EmitFn,
): Promise<void> {
  if (!state.proxy) {
    emit('command-error', { message: 'No active proxy — browser commands require a web interface' });
    return;
  }
  const steps = cmd.steps as Array<Record<string, unknown>>;
  if (!Array.isArray(steps) || steps.length === 0) {
    emit('command-error', { message: 'browser action requires a non-empty "steps" array' });
    return;
  }
  try {
    const result = await state.proxy.dispatchBrowserCommand(steps);
    emit('browser-completed', {
      steps: result.steps,
      snapshot: result.snapshot,
      logs: result.logs,
      duration: result.duration,
    });
  } catch (err) {
    emit('command-error', {
      message: err instanceof Error ? err.message : 'Browser command failed',
    });
  }
}
