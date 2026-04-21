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

import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { resolveChromePath } from './chrome-path';
import { log } from '../logging/logger';

export interface LaunchedBrowser {
  browser: Browser;
  page: Page;
  executablePath: string;
}

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

const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

export async function launchSandboxBrowser(opts: {
  proxyPort: number;
}): Promise<LaunchedBrowser | null> {
  const executablePath = resolveChromePath();
  if (!executablePath) {
    log.warn(
      'browser',
      'No Chrome executable found — sandbox-browser mode disabled for this session',
    );
    return null;
  }

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: LAUNCH_ARGS,
    defaultViewport: DEFAULT_VIEWPORT,
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

  const target = `http://127.0.0.1:${opts.proxyPort}/?ms_sandbox=1`;
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 15_000 });

  log.info('browser', 'Sandbox browser launched', {
    executablePath,
    target,
    pid: proc?.pid ?? null,
  });

  return { browser, page, executablePath };
}
