import { CommandError } from './types';
import type { CommandContext } from './types';

export async function handleResetBrowser(
  ctx: CommandContext,
): Promise<Record<string, unknown>> {
  if (!ctx.state.proxy) throw new CommandError('No active proxy', 'NO_BROWSER');
  if (!ctx.state.proxy.isBrowserConnected()) throw new CommandError('No browser connected', 'NO_BROWSER');

  // Try to restore stashed browser state (saved by setup-browser).
  // restoreState sets the cookie in the browser and clears the stash.
  const restoreResult = await ctx.state.proxy.dispatchBrowserCommand([
    { command: 'restoreState' },
  ]);

  const stepResult = (restoreResult.steps as Array<Record<string, unknown>>)?.[0];
  const restored = stepResult?.result as { restored: boolean; path?: string } | undefined;

  if (restored?.restored) {
    // Reload so the proxy resolves the restored cookie, then navigate back
    const steps: Array<Record<string, unknown>> = [{ command: 'reload' }];
    if (restored.path && restored.path !== '/') {
      steps.push({ command: 'navigate', url: restored.path });
    }
    steps.push({ command: 'snapshot' });
    await ctx.state.proxy.dispatchBrowserCommand(steps);
    return { success: true, restored: true, path: restored.path };
  }

  // No stash — fall back to broadcast reload (clears cookie, navigates to /)
  ctx.state.proxy.broadcastToClients('reload');
  return { success: true, restored: false };
}
