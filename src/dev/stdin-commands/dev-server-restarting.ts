import { CommandError } from './types';
import type { CommandContext } from './types';

export async function handleDevServerRestarting(
  ctx: CommandContext,
): Promise<Record<string, unknown>> {
  if (!ctx.state.proxy) throw new CommandError('No active proxy', 'NO_BROWSER');

  ctx.state.proxy.markUpstreamDown();
  return { success: true };
}
