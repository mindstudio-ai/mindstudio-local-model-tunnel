/**
 * Launch a headless Chrome instance pointed at the local tunnel proxy.
 *
 * The launched browser loads `http://127.0.0.1:<proxyPort>/?ms_sandbox=1`.
 * The tunnel proxy injects the browser-agent script as usual, which opens
 * a WebSocket back to the tunnel and registers as a client. The proxy's
 * hello handler recognizes the `ms_sandbox=1` query from a loopback source
 * and forces the client mode to 'headless'.
 *
 * This module knows nothing about the client registry or the command
 * dispatch path — those stay untouched. It only spawns Chrome and navigates.
 */

import puppeteer, { type Browser, type Page, type Viewport } from 'puppeteer-core';
import { resolveChromePath } from './chrome-path';
import { log } from '../logging/logger';

export interface LaunchedBrowser {
  browser: Browser;
  page: Page;
  executablePath: string;
  pid: number | null;
  previewMode: PreviewMode;
  viewport: string;
}

export type PreviewMode = 'desktop' | 'mobile';

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-color-profile=srgb',
  '--font-render-hinting=none',
  '--disable-blink-features=AutomationControlled',
  '--lang=en-US',
];

// Modern laptop — fits most desktop-first app layouts without extra gutters.
const DESKTOP_VIEWPORT: Viewport = {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
};

// iPhone 15 Pro portrait. DPR 2 is the sweet spot — retina-ish fidelity
// without 3× screenshot bloat. `isMobile`/`hasTouch` engage Chrome's mobile
// emulation (viewport meta tag handling, touch events, orientation APIs).
const MOBILE_VIEWPORT: Viewport = {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};

export function viewportFor(mode: PreviewMode): Viewport {
  return mode === 'mobile' ? MOBILE_VIEWPORT : DESKTOP_VIEWPORT;
}

export function viewportToString(viewport: Viewport): string {
  return `${viewport.width}x${viewport.height}@${viewport.deviceScaleFactor}x`;
}

export async function launchSandboxBrowser(opts: {
  proxyPort: number;
  previewMode?: PreviewMode;
  /** Optional readiness gate awaited after `page.goto` resolves. Lets the
   *  supervisor block on the browser-agent WS hello instead of relying on
   *  `networkidle0`, which is defeated by long-lived SSE responses such as
   *  the telemetry-presence mock. */
  waitForBrowserAgent?: () => Promise<void>;
}): Promise<LaunchedBrowser | null> {
  const executablePath = resolveChromePath();
  if (!executablePath) {
    log.warn(
      'browser',
      'No Chrome executable found — sandbox-browser mode disabled for this session',
    );
    return null;
  }

  const previewMode: PreviewMode = opts.previewMode === 'mobile' ? 'mobile' : 'desktop';
  const viewport = viewportFor(previewMode);

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: LAUNCH_ARGS,
    defaultViewport: viewport,
  });

  // Pipe Chrome stderr through the debug logger. Chrome is chatty on startup
  // and we don't want that at info level.
  const proc = browser.process();
  proc?.stderr?.on('data', (buf: Buffer) => {
    const line = buf.toString().trim();
    if (line) log.debug('browser-chrome', line);
  });

  const pages = await browser.pages();
  const page = pages[0] ?? (await browser.newPage());

  // Stamp the sandbox marker on every new document, before any page script
  // runs. The browser-agent's `isSandboxBrowser()` reads this latch — keeping
  // it alive ensures the proxy classifies us as `mode=headless` on every
  // reconnect, even after nav cycles (cross-origin trips, new browsing
  // contexts, etc.) that would otherwise wipe per-tab sessionStorage and
  // demote us to `mode=standalone` (commands then queue with no eligible
  // target and time out at 120s).
  await page.evaluateOnNewDocument(() => {
    try { sessionStorage.setItem('__ms_sandbox', '1'); } catch {}
  });

  const target = `http://127.0.0.1:${opts.proxyPort}/?ms_sandbox=1`;
  // `load` fires once HTML + non-async assets are parsed/loaded — long-lived
  // requests (e.g. the telemetry-presence SSE the SDK opens on page load)
  // don't block it. We then wait separately on `waitForBrowserAgent` for the
  // browser-agent WS hello, so callers don't race the first command. That
  // pair replaces the old `networkidle0` approach, which the SSE defeats by
  // pinning the in-flight count at 1 forever.
  try {
    await page.goto(target, { waitUntil: 'load', timeout: 15_000 });
    if (opts.waitForBrowserAgent) {
      await opts.waitForBrowserAgent();
    }
  } catch (err) {
    // Leaked Chromium otherwise — if navigation fails, close the browser
    // so the supervisor's restart loop can start clean.
    await browser.close().catch(() => {});
    throw err;
  }

  const viewportStr = viewportToString(viewport);

  log.info('browser', 'Sandbox browser launched', {
    executablePath,
    target,
    previewMode,
    viewport: viewportStr,
    pid: proc?.pid ?? null,
  });

  return {
    browser,
    page,
    executablePath,
    pid: proc?.pid ?? null,
    previewMode,
    viewport: viewportStr,
  };
}
