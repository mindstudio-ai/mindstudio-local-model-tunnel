import { createAuthSession } from '../api';
import { clearAuthCookies, setAuthCookie } from '../browser';
import { CommandError } from './types';
import type { CommandContext } from './types';

export async function handleSetupBrowser(
  ctx: CommandContext,
  cmd: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!ctx.state.appConfig?.appId) throw new CommandError('No active session', 'NO_SESSION');

  const page = ctx.state.browser?.getActivePage();
  if (!page) {
    throw new CommandError(
      'Sandbox browser unavailable — headless Chrome is required for setup-browser',
      'NO_BROWSER',
    );
  }

  const auth = cmd.auth as { email?: string; phone?: string; roles?: string[] } | undefined;
  const path = (cmd.path as string) || '/';

  // Fresh slate: clear any auth cookie the previous test left behind.
  await clearAuthCookies(page);

  // Mint + set the automation auth cookie if requested.
  if (auth) {
    const { cookie } = await createAuthSession(ctx.state.appConfig.appId, auth);
    await setAuthCookie(page, cookie);
  }

  // Navigate to the target path so the proxy resolves the cookie and the
  // page injects the correct `window.__MINDSTUDIO__` context. puppeteer's
  // goto requires an absolute URL — resolve `path` against the current
  // origin (always the proxy when the sandbox browser is running).
  const absolute = new URL(path, page.url()).toString();
  try {
    await page.goto(absolute, { waitUntil: 'networkidle0', timeout: 15_000 });
  } catch (err) {
    throw new CommandError(
      `Navigation to ${path} failed: ${err instanceof Error ? err.message : String(err)}`,
      'BROWSER_ERROR',
    );
  }

  return { success: true, path, authenticated: !!auth };
}
