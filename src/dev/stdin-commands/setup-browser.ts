import { createAuthSession } from '../api';
import type { CommandContext } from './types';

export async function handleSetupBrowser(
  ctx: CommandContext,
  cmd: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!ctx.state.proxy) throw new Error('No active proxy');
  if (!ctx.state.proxy.isBrowserConnected()) {
    throw new Error('No browser connected, please refresh the MindStudio preview');
  }
  if (!ctx.state.appConfig?.appId) throw new Error('No active session');

  const auth = cmd.auth as { email?: string; phone?: string; roles?: string[] } | undefined;
  const path = (cmd.path as string) || '/';

  const steps: Array<Record<string, unknown>> = [];

  // 1. Mint auth cookie and inject it into the browser
  if (auth) {
    const { cookie } = await createAuthSession(ctx.state.appConfig.appId, auth);
    steps.push({
      command: 'evaluate',
      script: `document.cookie = '__ms_auth=${cookie}; Path=/; Secure; SameSite=None'`,
    });
    // Hard reload so the proxy resolves the cookie via /auth/me
    // and injects authenticated window.__MINDSTUDIO__
    steps.push({ command: 'reload' });
  }

  // 2. Navigate to target path (SPA nav — auth is already injected after reload)
  if (path !== '/') {
    steps.push({ command: 'navigate', url: path });
  }

  // Trailing snapshot ensures the command completes through the
  // stash/resume path after reload (reload kills the page; remaining
  // steps are stashed in sessionStorage and resumed on reconnect).
  if (steps.length > 0) {
    steps.push({ command: 'snapshot' });
    await ctx.state.proxy.dispatchBrowserCommand(steps);
  }

  return { success: true, path, authenticated: !!auth };
}
