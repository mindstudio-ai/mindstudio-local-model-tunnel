import { detectAppConfig } from '../config/app-config';
import { CommandError } from './types';
import type { CommandContext } from './types';

export async function handleRunMethod(
  ctx: CommandContext,
  cmd: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!ctx.state.runner) throw new CommandError('No active session', 'NO_SESSION');

  const methodName = cmd.method as string;
  if (!methodName) throw new CommandError('run-method requires "method" (export name or ID)', 'INVALID_INPUT');

  const freshConfig = detectAppConfig(ctx.cwd) ?? ctx.state.appConfig;
  const method =
    freshConfig?.methods.find((m) => m.export === methodName) ??
    freshConfig?.methods.find((m) => m.id === methodName);
  if (!method) throw new CommandError(`Unknown method: ${methodName}`, 'INVALID_INPUT');

  ctx.started({ method: method.export });

  const result = await ctx.state.runner.runMethod({
    methodExport: method.export,
    methodPath: method.path,
    input: cmd.input ?? {},
    roles: Array.isArray(cmd.roles) ? cmd.roles as string[] : undefined,
    userId: typeof cmd.userId === 'string' ? cmd.userId : undefined,
  });

  return {
    success: result.success,
    method: method.export,
    output: result.output ?? null,
    error: result.error?.message ?? null,
    errorCode: result.success ? undefined : 'EXECUTION_ERROR',
    errorDetail: result.error ?? null,
    stdout: result.stdout ?? [],
    duration: result.duration,
  };
}
