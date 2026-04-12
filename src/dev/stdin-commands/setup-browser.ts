import { createAuthSession } from '../api';
import { CommandError } from './types';
import type { CommandContext } from './types';

export async function handleSetupBrowser(
  ctx: CommandContext,
  cmd: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!ctx.state.proxy) throw new CommandError('No active proxy', 'NO_BROWSER');
  if (!ctx.state.proxy.isBrowserConnected()) {
    throw new CommandError('No browser connected', 'NO_BROWSER');
  }
  if (!ctx.state.appConfig?.appId) throw new CommandError('No active session', 'NO_SESSION');

  const auth = cmd.auth as { email?: string; phone?: string; roles?: string[] } | undefined;
  const path = (cmd.path as string) || '/';

  const steps: Array<Record<string, unknown>> = [];

  // 1. Stash current browser state (cookie + URL) so reset-browser can restore it.
  //    The browser agent only writes the stash if it's currently empty, so
  //    multiple setup-browser calls preserve the user's original state.
  steps.push({ command: 'stashState' });

  // 2. Clear existing auth cookie (clean slate)
  steps.push({
    command: 'evaluate',
    script: `document.cookie = '__ms_auth=; Max-Age=0; Path=/; Secure; SameSite=None'`,
  });

  // 3. Mint and set automation auth cookie if requested
  if (auth) {
    const { cookie } = await createAuthSession(ctx.state.appConfig.appId, auth);
    steps.push({
      command: 'evaluate',
      script: `document.cookie = '__ms_auth=${cookie}; Path=/; Secure; SameSite=None'`,
    });
  }

  // 4. Reload so the proxy resolves the new (or cleared) cookie via /auth/me
  //    and injects the correct window.__MINDSTUDIO__
  steps.push({ command: 'reload' });

  // 5. Navigate to target path if not root
  if (path !== '/') {
    steps.push({ command: 'navigate', url: path });
  }

  // Trailing snapshot ensures the command completes through the
  // stash/resume path after reload (reload kills the page; remaining
  // steps are stashed in sessionStorage and resumed on reconnect).
  steps.push({ command: 'snapshot' });

  await ctx.state.proxy.dispatchBrowserCommand(steps);

  return { success: true, path, authenticated: !!auth };
}
