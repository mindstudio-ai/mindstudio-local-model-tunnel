/**
 * BrowserSupervisor — keeps a headless Chrome instance alive for the lifetime
 * of a dev session.
 *
 * Responsibilities:
 * - Launch Chrome once at session start.
 * - Watch for unexpected disconnect (Chrome crash, killed process).
 * - Restart with exponential backoff; enter degraded mode after repeated
 *   failures so automation falls through to user-browser clients.
 * - Clean teardown on session stop so no orphan Chrome processes linger.
 *
 * The supervisor does NOT dispatch commands. Chrome connects back over the
 * existing WS path and the proxy's client registry picks it up like any
 * other client.
 */

import type { Browser, Page } from 'puppeteer-core';
import { launchSandboxBrowser } from './launcher';
import { log } from '../logging/logger';

const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
const MAX_FAILURES = 5;
const CLOSE_TIMEOUT_MS = 5_000;

export class BrowserSupervisor {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private stopping = false;
  private degraded = false;
  private consecutiveFailures = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly proxyPort: number) {}

  async start(): Promise<void> {
    if (this.browser) return;
    await this.launchOnce();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const browser = this.browser;
    this.browser = null;
    this.page = null;
    if (!browser) return;

    await this.closeBrowser(browser);
  }

  isRunning(): boolean {
    return !!this.browser && !this.degraded;
  }

  isDegraded(): boolean {
    return this.degraded;
  }

  /**
   * Returns the active puppeteer Page when the sandbox browser is running
   * and not degraded; null otherwise. Callers use this to decide whether
   * a CDP-side fast path is available for a given command.
   */
  getActivePage(): Page | null {
    if (this.stopping || this.degraded) return null;
    if (!this.browser || !this.page) return null;
    return this.page;
  }

  private async launchOnce(): Promise<void> {
    if (this.stopping) return;

    try {
      const launched = await launchSandboxBrowser({ proxyPort: this.proxyPort });
      if (!launched) {
        // No Chrome executable — enter degraded mode permanently for this session.
        this.degraded = true;
        return;
      }
      this.browser = launched.browser;
      this.page = launched.page;
      this.consecutiveFailures = 0;
      this.degraded = false;

      launched.browser.on('disconnected', () => this.onDisconnect());
    } catch (err) {
      this.consecutiveFailures++;
      log.warn('browser', 'Failed to launch sandbox browser', {
        attempt: this.consecutiveFailures,
        error: err instanceof Error ? err.message : String(err),
      });
      this.scheduleRestart();
    }
  }

  private onDisconnect(): void {
    if (this.stopping) return;
    const hadBrowser = !!this.browser;
    this.browser = null;
    this.page = null;
    if (!hadBrowser) return;

    this.consecutiveFailures++;
    log.warn('browser', 'Sandbox browser disconnected', {
      attempt: this.consecutiveFailures,
    });
    this.scheduleRestart();
  }

  private scheduleRestart(): void {
    if (this.stopping) return;

    if (this.consecutiveFailures >= MAX_FAILURES) {
      this.degraded = true;
      log.warn(
        'browser',
        'Sandbox browser entering degraded mode after repeated failures — automation will fall back to user browsers',
        { failures: this.consecutiveFailures },
      );
      return;
    }

    const delay =
      BACKOFF_MS[Math.min(this.consecutiveFailures, BACKOFF_MS.length - 1)];
    log.info('browser', 'Scheduling sandbox browser restart', {
      delayMs: delay,
      attempt: this.consecutiveFailures,
    });
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.launchOnce();
    }, delay);
  }

  private async closeBrowser(browser: Browser): Promise<void> {
    let resolved = false;
    await new Promise<void>((resolve) => {
      const done = () => {
        if (resolved) return;
        resolved = true;
        resolve();
      };
      const timeout = setTimeout(() => {
        // Graceful close timed out — kill the underlying process.
        try {
          browser.process()?.kill('SIGKILL');
        } catch {
          // Best effort
        }
        done();
      }, CLOSE_TIMEOUT_MS);

      browser
        .close()
        .then(() => {
          clearTimeout(timeout);
          done();
        })
        .catch(() => {
          clearTimeout(timeout);
          try {
            browser.process()?.kill('SIGKILL');
          } catch {
            // Best effort
          }
          done();
        });
    });
  }
}
