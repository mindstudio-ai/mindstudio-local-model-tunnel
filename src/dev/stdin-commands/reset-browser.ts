import { clearAuthCookies } from '../browser';
import { CommandError } from './types';
import type { CommandContext } from './types';

export async function handleResetBrowser(
  ctx: CommandContext,
): Promise<Record<string, unknown>> {
  if (!ctx.state.proxy) throw new CommandError('No active proxy', 'NO_BROWSER');

  const page = ctx.state.browser?.getActivePage();
  if (!page) {
    throw new CommandError(
      'Sandbox browser unavailable — headless Chrome is required for reset-browser',
      'NO_BROWSER',
    );
  }

  await clearAuthCookies(page);
  const rootUrl = new URL('/', page.url()).toString();
  try {
    await page.goto(rootUrl, { waitUntil: 'networkidle0', timeout: 15_000 });
  } catch (err) {
    throw new CommandError(
      `Reset navigation failed: ${err instanceof Error ? err.message : String(err)}`,
      'BROWSER_ERROR',
    );
  }

  // Reload live-preview iframes so anyone watching sees the clean state.
  // Headless is automatically skipped by broadcastToClients.
  ctx.state.proxy.broadcastToClients('reload');

  return { success: true };
}
