import type { CommandContext } from './types';

export async function handleBrowser(
  ctx: CommandContext,
  cmd: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!ctx.state.proxy) throw new Error('No active proxy — browser commands require a web interface');

  const steps = cmd.steps as Array<Record<string, unknown>>;
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('browser action requires a non-empty "steps" array');
  }

  const result = await ctx.state.proxy.dispatchBrowserCommand(steps);
  return {
    steps: result.steps,
    snapshot: result.snapshot,
    logs: result.logs,
    duration: result.duration,
  };
}
