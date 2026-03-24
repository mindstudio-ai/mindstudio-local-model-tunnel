import { detectAppConfig } from '../app-config';
import type { CommandContext } from './types';

export async function handleRunScenario(
  ctx: CommandContext,
  cmd: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!ctx.state.runner) throw new Error('No active session');

  const freshConfig = detectAppConfig(ctx.cwd) ?? ctx.state.appConfig;
  const scenario = freshConfig?.scenarios.find((s) => s.id === cmd.scenarioId);
  if (!scenario) throw new Error(`Unknown scenario: ${cmd.scenarioId}`);

  const scenarioName = scenario.name ?? scenario.export;
  ctx.started({ scenarioId: scenario.id, name: scenarioName });

  const result = await ctx.state.runner.runScenario(scenario);

  return {
    success: result.success,
    scenarioId: scenario.id,
    name: scenarioName,
    ...(result.error ? { error: result.error } : {}),
  };
}
