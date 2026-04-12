import { detectAppConfig } from '../config/app-config';
import { CommandError } from './types';
import type { CommandContext } from './types';

export async function handleRunScenario(
  ctx: CommandContext,
  cmd: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!ctx.state.runner) throw new CommandError('No active session', 'NO_SESSION');

  const freshConfig = detectAppConfig(ctx.cwd) ?? ctx.state.appConfig;
  const scenario = freshConfig?.scenarios.find((s) => s.id === cmd.scenarioId);
  if (!scenario) throw new CommandError(`Unknown scenario: ${cmd.scenarioId}`, 'INVALID_INPUT');

  const scenarioName = scenario.name ?? scenario.export;
  ctx.started({ scenarioId: scenario.id, name: scenarioName });

  const skipTruncate = cmd.skipTruncate === true;
  const result = await ctx.state.runner.runScenario(scenario, { skipTruncate });

  // Reset the browser so it picks up the new data/roles from the scenario
  if (result.success && ctx.state.proxy?.isBrowserConnected()) {
    ctx.state.proxy.broadcastToClients('reload');
  }

  return {
    success: result.success,
    scenarioId: scenario.id,
    name: scenarioName,
    error: result.error ?? null,
    errorCode: result.success ? undefined : 'EXECUTION_ERROR',
  };
}
