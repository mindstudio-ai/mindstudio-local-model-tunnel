import type { CommandContext } from './types';

export async function handleResetBrowser(
  ctx: CommandContext,
): Promise<Record<string, unknown>> {
  if (!ctx.state.proxy) throw new Error('No active proxy');
  if (!ctx.state.proxy.isBrowserConnected()) throw new Error('No browser connected');

  ctx.state.proxy.broadcastToClients('reload');
  return {};
}
