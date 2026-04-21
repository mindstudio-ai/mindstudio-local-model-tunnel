/**
 * Auth-cookie helpers for the sandbox-owned Chrome.
 *
 * `setup-browser` and `reset-browser` both operate on the `__ms_auth` cookie
 * via CDP now — no more WS round-trip through browser-agent. These wrappers
 * keep the cookie shape + lifetime in one place.
 */

import type { Page } from 'puppeteer-core';

const AUTH_COOKIE_NAME = '__ms_auth';

function cookieHost(page: Page): string {
  try {
    return new URL(page.url()).hostname || '127.0.0.1';
  } catch {
    return '127.0.0.1';
  }
}

export async function clearAuthCookies(page: Page): Promise<void> {
  const domain = cookieHost(page);
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
  const domain = cookieHost(page);
  await page.setCookie({
    name: AUTH_COOKIE_NAME,
    value,
    domain,
    path: '/',
    sameSite: 'None',
    secure: true,
  });
}
