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

  // 1. Mint auth cookie and inject it into the browser
  if (auth) {
    const { cookie } = await createAuthSession(ctx.state.appConfig.appId, auth);
    await ctx.state.proxy.dispatchBrowserCommand([{
      command: 'evaluate',
      script: `document.cookie = '__ms_auth=${cookie}; Path=/; Secure; SameSite=None'`,
    }]);
  }

  // 2. Reload the page so the proxy resolves the cookie via /auth/me
  //    and injects authenticated window.__MINDSTUDIO__. Uses broadcast
  //    (fire-and-forget) because a dispatched `reload` command kills the
  //    page and the result never comes back, causing a timeout.
  //    The broadcast also clears any stale cookie if auth wasn't provided,
  //    matching reset-browser behavior.
  ctx.state.proxy.broadcastToClients('reload');

  // 3. Wait for the browser to reconnect after reload, then navigate
  if (path !== '/') {
    await waitForReconnect(ctx, 10_000);
    await ctx.state.proxy.dispatchBrowserCommand([
      { command: 'navigate', url: path },
    ]);
  }

  return { success: true, path, authenticated: !!auth };
}

/** Poll until a browser client is connected (after a reload drops the connection). */
function waitForReconnect(ctx: CommandContext, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (ctx.state.proxy?.isBrowserConnected()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('Browser did not reconnect after reload'));
      setTimeout(check, 200);
    };
    // Small initial delay — the page needs time to unload
    setTimeout(check, 500);
  });
}
