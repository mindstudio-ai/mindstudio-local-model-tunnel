import type { CommandContext } from './types';

export async function handleBrowserStatus(
  ctx: CommandContext,
): Promise<Record<string, unknown>> {
  return { connected: ctx.state.proxy?.isBrowserConnected() ?? false };
}
