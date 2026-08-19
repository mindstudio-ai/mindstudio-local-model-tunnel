/**
 * Tunnel-side navigation for automation `navigate` steps.
 *
 * Runs inside the tunnel (Node) against the puppeteer Page owned by the
 * BrowserSupervisor. Navigation used to execute in-page (browser-agent), where
 * a hard load tears down the executor mid-batch — the WS client and all state
 * die with the document, which is what the stash/resume protocol and the
 * proxy's disconnect-reconcile machinery existed to survive. Executing it here
 * means WS batches never span a page boundary we created: the proxy's dispatch
 * already waits for the browser-agent's reconnect before the next batch.
 *
 * It also reports the URL actually landed on. The in-page path returned a
 * blind 'ok', which hid app-side redirects from the caller — a QA agent
 * navigating to a public page and getting bounced by an auth wall saw 'ok'
 * and then a snapshot of the wrong page.
 */

import type { Page } from 'puppeteer-core';

const NAV_GOTO_TIMEOUT_MS = 15_000;
// Give the app's router a beat to apply a soft route change before reading
// back the landed URL. Matches the in-page executor's NAV_SETTLE_MS.
const SPA_SETTLE_MS = 300;

/**
 * Resolve an app path/URL to an absolute URL. Puppeteer's page.goto requires
 * an absolute URL — callers pass paths like "/welcome". Resolve against the
 * known proxy origin (http://127.0.0.1:<proxyPort>), NOT page.url(): if the
 * page is parked on chrome-error://chromewebdata/ (after an aborted nav),
 * resolving against it yields chrome-error://.../<path> → net::ERR_ABORTED,
 * permanently wedging every later navigation. Basing on the proxy origin
 * self-heals (the next goto lands on a real URL). Falls back to page.url()
 * only when the port is unknown.
 */
export function resolveAppUrl(
  page: Page,
  proxyPort: number | null | undefined,
  path: string,
): string {
  const base = proxyPort ? `http://127.0.0.1:${proxyPort}` : page.url();
  return new URL(path, base).toString();
}

export interface TunnelNavigateResult {
  /** The URL the page actually landed on — app-side redirects are visible. */
  url: string;
  /** 'spa' = soft route change (pushState, document kept); 'load' = full load. */
  mode: 'spa' | 'load';
}

/**
 * Execute one `navigate` step.
 *
 * Same-origin URLs default to a soft route change (pushState + synthetic
 * popstate — the same semantics the in-page executor used, including the
 * already-on-page no-op), so the document and the browser-agent's WS survive.
 * `fresh: true` or a cross-origin target forces a real `page.goto` — used by
 * QA to test what a visitor sees on a fresh document (entry pages, signed-out
 * landings), where reusing the SPA's in-memory state would test the wrong
 * thing.
 *
 * `waitUntil: 'load'`, never `networkidle0`: the SDK's /_/telemetry/presence
 * SSE pins the in-flight count above zero forever, so networkidle0 never
 * settles. Mirrors launcher.ts / supervisor.ts / screenshot.ts.
 */
export async function navigateTunnelSide(
  page: Page,
  opts: { url: string; fresh?: boolean; proxyPort: number | null },
  budgetMs: number,
): Promise<TunnelNavigateResult> {
  const deadline = Date.now() + budgetMs;
  const remaining = () => Math.max(1_000, deadline - Date.now());

  const absolute = resolveAppUrl(page, opts.proxyPort, opts.url);
  const target = new URL(absolute);

  let sameOrigin = false;
  try {
    // A page parked on chrome-error:// (or anywhere off-origin) never matches,
    // so it takes the goto path — which is also what self-heals it.
    sameOrigin = new URL(page.url()).origin === target.origin;
  } catch {
    sameOrigin = false;
  }

  if (!sameOrigin || opts.fresh) {
    await page.goto(absolute, {
      waitUntil: 'load',
      timeout: Math.min(NAV_GOTO_TIMEOUT_MS, remaining()),
    });
    return { url: page.url(), mode: 'load' };
  }

  try {
    await page.evaluate((href) => {
      const resolved = new URL(href, window.location.origin);
      const alreadyThere =
        resolved.pathname === window.location.pathname &&
        resolved.search === window.location.search &&
        resolved.hash === window.location.hash;
      if (!alreadyThere) {
        window.history.pushState(
          null,
          '',
          resolved.pathname + resolved.search + resolved.hash,
        );
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    }, absolute);
    await new Promise((r) =>
      setTimeout(r, Math.min(SPA_SETTLE_MS, remaining())),
    );
    const landed = await page.evaluate(() => window.location.href);
    return { url: landed, mode: 'spa' };
  } catch {
    // The app answered the route change with a hard navigation of its own —
    // e.g. an auth wall bouncing the visitor — and the execution context died
    // under the evaluate. Wait out the load (it may already have finished, so
    // swallow the timeout) and report where the page actually ended up.
    await page
      .waitForNavigation({
        waitUntil: 'load',
        timeout: Math.min(NAV_GOTO_TIMEOUT_MS, remaining()),
      })
      .catch(() => {});
    return { url: page.url(), mode: 'load' };
  }
}
