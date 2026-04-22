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
 * Emits structured `sandbox-browser-state` events on stdout at every state
 * transition so the sandbox manager can track Chrome in its /status surface
 * (resource metrics, debug bundles, degraded-mode alerts).
 *
 * The supervisor does NOT dispatch commands. Chrome connects back over the
 * existing WS path and the proxy's client registry picks it up like any
 * other client.
 */

import type { Browser, Page } from 'puppeteer-core';
import { launchSandboxBrowser, type PreviewMode } from './launcher';
import { log } from '../logging/logger';
import { emitEvent } from '../ipc/ipc';

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
  private runningSince: number | null = null;
  private lastExitInfo: {
    exitCode: number | null;
    signal: string | null;
  } | null = null;

  constructor(
    private readonly proxyPort: number,
    private readonly previewMode: PreviewMode = 'desktop',
  ) {}

  async start(): Promise<void> {
    if (this.browser) return;
    await this.launchOnce();
  }

  async stop(): Promise<void> {
    if (this.stopping) return; // idempotent — double SIGTERM shouldn't double-fire events
    this.stopping = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const browser = this.browser;
    this.browser = null;
    this.page = null;
    if (browser) {
      await this.closeBrowser(browser);
    }
    this.runningSince = null;
    this.lastExitInfo = null;
    emitEvent('sandbox-browser-state', { state: 'stopped' });
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

    const attempt = this.consecutiveFailures + 1;
    log.info('browser', 'Sandbox browser launch starting', {
      proxyPort: this.proxyPort,
      attempt,
    });
    emitEvent('sandbox-browser-state', {
      state: 'starting',
      attempt,
      previewMode: this.previewMode,
    });

    try {
      const launched = await launchSandboxBrowser({
        proxyPort: this.proxyPort,
        previewMode: this.previewMode,
      });
      if (!launched) {
        // No Chrome executable — enter degraded mode permanently for this session.
        this.degraded = true;
        emitEvent('sandbox-browser-state', {
          state: 'degraded',
          reason: 'no-executable',
        });
        return;
      }

      // If stop() landed while we were launching, the supervisor has already
      // emitted `stopped` and cleared its state. Don't register the browser
      // we just got — close it and bail, otherwise we'd leak Chromium.
      if (this.stopping) {
        await this.closeBrowser(launched.browser).catch(() => {});
        return;
      }

      this.browser = launched.browser;
      this.page = launched.page;
      this.consecutiveFailures = 0;
      this.degraded = false;
      this.runningSince = Date.now();
      this.lastExitInfo = null;

      // Capture exit info directly from the child process so `crashed` events
      // carry an accurate signal / exitCode alongside puppeteer's `disconnected`.
      const proc = launched.browser.process();
      proc?.once('exit', (code, signal) => {
        this.lastExitInfo = { exitCode: code, signal: signal ?? null };
      });

      launched.browser.on('disconnected', () => this.onDisconnect());

      emitEvent('sandbox-browser-state', {
        state: 'running',
        pid: launched.pid,
        previewMode: launched.previewMode,
        viewport: launched.viewport,
        executablePath: launched.executablePath,
      });
    } catch (err) {
      // Don't track failures or restart if we were torn down mid-launch.
      if (this.stopping) return;

      this.consecutiveFailures++;
      const message = err instanceof Error ? err.message : String(err);
      log.warn('browser', 'Failed to launch sandbox browser', {
        attempt: this.consecutiveFailures,
        error: message,
      });
      emitEvent('sandbox-browser-state', {
        state: 'crashed',
        exitCode: null,
        signal: null,
        durationMs: 0,
        consecutiveFailures: this.consecutiveFailures,
        error: message,
      });
      this.scheduleRestart();
    }
  }

  private async onDisconnect(): Promise<void> {
    if (this.stopping) return;
    const hadBrowser = !!this.browser;
    this.browser = null;
    this.page = null;
    if (!hadBrowser) return;

    this.consecutiveFailures++;
    const durationMs = this.runningSince ? Date.now() - this.runningSince : 0;
    this.runningSince = null;
    log.warn('browser', 'Sandbox browser disconnected', {
      attempt: this.consecutiveFailures,
    });

    // puppeteer's disconnect sometimes fires before the child's `exit` listener,
    // leaving exit info unpopulated. Give that listener a short window.
    await this.waitForExitInfo();

    emitEvent('sandbox-browser-state', {
      state: 'crashed',
      exitCode: this.lastExitInfo?.exitCode ?? null,
      signal: this.lastExitInfo?.signal ?? null,
      durationMs,
      consecutiveFailures: this.consecutiveFailures,
    });
    this.lastExitInfo = null;
    this.scheduleRestart();
  }

  private async waitForExitInfo(timeoutMs = 200): Promise<void> {
    if (this.lastExitInfo) return;
    const deadline = Date.now() + timeoutMs;
    while (!this.lastExitInfo && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
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
      emitEvent('sandbox-browser-state', {
        state: 'degraded',
        reason: 'repeated-crashes',
        consecutiveFailures: this.consecutiveFailures,
      });
      return;
    }

    const delay =
      BACKOFF_MS[Math.min(this.consecutiveFailures, BACKOFF_MS.length - 1)];
    log.info('browser', 'Scheduling sandbox browser restart', {
      delayMs: delay,
      attempt: this.consecutiveFailures,
    });
    emitEvent('sandbox-browser-state', {
      state: 'restarting',
      delayMs: delay,
      nextAttempt: this.consecutiveFailures + 1,
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
