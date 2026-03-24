import type { CommandContext } from './types';

export async function handleDevServerRestarting(
  ctx: CommandContext,
): Promise<Record<string, unknown>> {
  if (!ctx.state.proxy) throw new Error('No active proxy');

  ctx.state.proxy.markUpstreamDown();
  return {};
}
