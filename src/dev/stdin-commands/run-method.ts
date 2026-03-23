import { detectAppConfig } from '../app-config';
import type { SessionState, EmitFn } from './types';

export async function handleRunMethod(
  state: SessionState,
  cwd: string,
  cmd: Record<string, unknown>,
  emit: EmitFn,
): Promise<void> {
  if (!state.runner) {
    emit('command-error', { message: 'No active session' });
    return;
  }
  const methodName = cmd.method as string;
  if (!methodName) {
    emit('command-error', { message: 'run-method requires "method" (export name or ID)' });
    return;
  }
  const freshConfig = detectAppConfig(cwd) ?? state.appConfig;
  const method =
    freshConfig?.methods.find((m) => m.export === methodName) ??
    freshConfig?.methods.find((m) => m.id === methodName);
  if (!method) {
    emit('command-error', { message: `Unknown method: ${methodName}` });
    return;
  }
  emit('method-run-started', { method: method.export });
  const result = await state.runner.runMethod({
    methodExport: method.export,
    methodPath: method.path,
    input: cmd.input ?? {},
  });
  emit('method-run-completed', {
    method: method.export,
    success: result.success,
    output: result.output ?? null,
    error: result.error ?? null,
    stdout: result.stdout ?? [],
    duration: result.duration,
  });
}
