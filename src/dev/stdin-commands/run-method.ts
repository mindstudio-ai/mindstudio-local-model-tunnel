import { detectAppConfig } from '../app-config';
import type { CommandContext } from './types';

export async function handleRunMethod(
  ctx: CommandContext,
  cmd: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!ctx.state.runner) throw new Error('No active session');

  const methodName = cmd.method as string;
  if (!methodName) throw new Error('run-method requires "method" (export name or ID)');

  const freshConfig = detectAppConfig(ctx.cwd) ?? ctx.state.appConfig;
  const method =
    freshConfig?.methods.find((m) => m.export === methodName) ??
    freshConfig?.methods.find((m) => m.id === methodName);
  if (!method) throw new Error(`Unknown method: ${methodName}`);

  ctx.started({ method: method.export });

  const result = await ctx.state.runner.runMethod({
    methodExport: method.export,
    methodPath: method.path,
    input: cmd.input ?? {},
  });

  return {
    success: result.success,
    method: method.export,
    output: result.output ?? null,
    error: result.error ?? null,
    stdout: result.stdout ?? [],
    duration: result.duration,
  };
}
