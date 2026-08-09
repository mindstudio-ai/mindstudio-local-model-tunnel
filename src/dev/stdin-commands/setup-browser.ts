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
    // Remy-only apps ("Sign in with Remy") have no email/phone identity to
    // seed, so mint a delegated session (resolved to the developer's own
    // identity by the platform) instead. Code-verify methods win when present,
    // matching resolveTestUserId's precedence — so any email/phone passed for a
    // mixed app is still honored.
    const methods = ctx.state.appConfig.auth?.methods ?? [];
    const useDelegated =
      !methods.includes('email-code') &&
      !methods.includes('sms-code') &&
      methods.includes('remy');
    const sessionOpts = useDelegated
      ? { delegated: true, roles: auth.roles }
      : auth;
    const { cookie } = await createAuthSession(
      ctx.state.appConfig.appId,
      sessionOpts,
    );
    await setAuthCookie(page, cookie);
  }

  // Navigate to the target path so the proxy resolves the cookie and the
  // page injects the correct `window.__MINDSTUDIO__` context. puppeteer's
  // goto requires an absolute URL — resolve `path` against the current
  // origin (always the proxy when the sandbox browser is running).
  // `load`, not `networkidle0`: a plain path (no `?ms_sandbox=1`) reopens the
  // SDK's /_/telemetry/presence SSE and instrumented pages stream analytics
  // beacons, either of which pins the in-flight count so `networkidle0` never
  // settles and this navigation always hits the 15s timeout. `load` only needs
  // HTML + non-async assets. Mirrors launcher.ts / supervisor.ts / screenshot.ts.
  const absolute = new URL(path, page.url()).toString();
  try {
    await page.goto(absolute, { waitUntil: 'load', timeout: 15_000 });
  } catch (err) {
    throw new CommandError(
      `Navigation to ${path} failed: ${err instanceof Error ? err.message : String(err)}`,
      'BROWSER_ERROR',
    );
  }

  return { success: true, path, authenticated: !!auth };
}
