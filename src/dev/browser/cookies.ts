/**
 * Auth-cookie helpers for the sandbox-owned Chrome.
 *
 * `setup-browser` and `reset-browser` both operate on the `__ms_auth` cookie
 * via CDP now — no more WS round-trip through browser-agent. These wrappers
 * keep the cookie shape + lifetime in one place.
 */

import type { Page } from 'puppeteer-core';

const AUTH_COOKIE_NAME = '__ms_auth';

// The sandbox-owned Chrome always loads the app from http://127.0.0.1:<proxyPort>
// (see browser/launcher.ts), and cookie domains are host-only (port-independent),
// so the auth cookie's domain is always 127.0.0.1. Deriving it from page.url()
// was a latent bug: `setAuthCookie` runs before the post-auth navigation, so if
// the page is transiently on chrome-error:// or a cross-origin sign-in page the
// cookie would land on the wrong domain (or fail to clear) and auth wouldn't apply.
const SANDBOX_COOKIE_HOST = '127.0.0.1';

export async function clearAuthCookies(page: Page): Promise<void> {
  const domain = SANDBOX_COOKIE_HOST;
  try {
    await page.deleteCookie({ name: AUTH_COOKIE_NAME, domain });
  } catch {
    // Cookie may not exist — fine.
  }
  // `deleteCookie` is scoped by domain; make sure any `/`-path variants go too.
  try {
    await page.deleteCookie({ name: AUTH_COOKIE_NAME });
  } catch {
    // Best effort.
  }
}

export async function setAuthCookie(page: Page, value: string): Promise<void> {
  const domain = SANDBOX_COOKIE_HOST;
  await page.setCookie({
    name: AUTH_COOKIE_NAME,
    value,
    domain,
    path: '/',
    sameSite: 'None',
    secure: true,
  });
}
