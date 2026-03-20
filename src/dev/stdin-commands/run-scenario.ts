import { detectAppConfig } from '../app-config';
import type { SessionState, EmitFn } from './types';

export async function handleRunScenario(
  state: SessionState,
  cwd: string,
  cmd: Record<string, unknown>,
  emit: EmitFn,
): Promise<void> {
  if (!state.runner) {
    emit('command-error', { message: 'No active session' });
    return;
  }
  const freshConfig = detectAppConfig(cwd) ?? state.appConfig;
  const scenario = freshConfig?.scenarios.find((s) => s.id === cmd.scenarioId);
  if (!scenario) {
    emit('command-error', { message: `Unknown scenario: ${cmd.scenarioId}` });
    return;
  }
  await state.runner.runScenario(scenario);
}
