/**
 * BrowserSupervisor — keeps a headless Chrome instance alive for the lifetime
 * of a dev session.
 *
 * Responsibilities:
 * - Launch Chrome once at session start.
 * - Watch for unexpected disconnect (Chrome crash, killed process).
 * - Watch for a wedged page: Chrome can outlive its page's main thread (a
 *   dialog held open, a hot-update render loop), which `disconnected` never
 *   sees — a slow-cadence main-thread ping catches it and kills Chrome so the
 *   crash path below brings automation back.
 * - Restart with exponential backoff; after repeated failures report the browser
 *   as degraded and keep retrying on a slow cadence.
 * - Clean teardown on session stop so no orphan Chrome processes linger.
 *
 * Degraded means automation is unavailable, not that it goes somewhere else:
 * only the sandbox-owned headless client ever executes commands (see
 * `ClientRegistry.getCommandTarget`), so there is no user-browser fallback.
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
import {
  launchSandboxBrowser,
  viewportFor,
  viewportToString,
  type PreviewMode,
} from './launcher';
import { log } from '../logging/logger';
import { emitEvent } from '../ipc/ipc';

const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
const MAX_FAILURES = 5;
const CLOSE_TIMEOUT_MS = 5_000;
// Retry cadence once degraded. Long enough not to thrash on a genuinely broken
// environment, short enough that a session outliving a transient failure gets
// its browser back rather than losing automation for hours.
const DEGRADED_RETRY_MS = 60_000;
// Wedged-page watchdog cadence and grace. A ping is a trivial page.evaluate:
// any settle — including a rejection from a context torn down mid-navigation —
// proves the main thread is making progress; only a hang is a wedge. The grace
// must comfortably exceed the longest legitimate synchronous stall (heavy
// hot-update reflows, capture pre-roll), and a page that can't run a statement
// for 15 straight seconds is unusable for automation even if it would
// eventually wake up.
const PAGE_PING_INTERVAL_MS = 30_000;
const PAGE_PING_TIMEOUT_MS = 15_000;

export class BrowserSupervisor {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private stopping = false;
  private degraded = false;
  private consecutiveFailures = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setTimeout> | null = null;
  private runningSince: number | null = null;
  private lastExitInfo: {
    exitCode: number | null;
    signal: string | null;
  } | null = null;
  private executablePath: string | null = null;
  private previewMode: PreviewMode;
  private viewportChange: Promise<void> = Promise.resolve();

  constructor(
    private readonly proxyPort: number,
    initialPreviewMode: PreviewMode = 'desktop',
    /** Optional readiness gate passed through to `launchSandboxBrowser`.
     *  Wired by `headless.ts` to `DevProxy.waitForHeadlessClient(...)` so
     *  `running` is only emitted once the browser-agent WS hello arrives. */
    private readonly waitForBrowserAgent?: () => Promise<void>,
  ) {
    this.previewMode = initialPreviewMode;
  }

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
    this.clearPingTimer();
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

  getPreviewMode(): PreviewMode {
    return this.previewMode;
  }

  /**
   * Hot-apply a viewport change without restarting Chrome. Triggered by
   * web.json edits where only `defaultPreviewMode` flipped — we re-emulate
   * via CDP and reload so media queries and `window.matchMedia` listeners
   * pick up the new dimensions. Cookies and sessionStorage survive the
   * reload; rrweb / browser-agent reconnect normally.
   *
   * `forceReload` reloads the page even when the mode already matches —
   * the per-run QA reset uses it to guarantee a fresh document (a failed
   * hot-update can leave the page on a stale bundle with no other recovery
   * path; see the setViewport handler in stdin-commands/browser.ts).
   *
   * Calls are serialized so rapid back-to-back invocations apply in order
   * rather than racing.
   *
   * Rejects when the reload fails — a reset whose reload never happened must
   * not read as success (callers report the navigation error to the agent).
   */
  async setPreviewMode(
    mode: PreviewMode,
    opts: { forceReload?: boolean } = {},
  ): Promise<void> {
    if (this.stopping || this.degraded) return;
    const forceReload = opts.forceReload === true;
    if (mode === this.previewMode && !forceReload) return;
    const run = this.viewportChange.then(() =>
      this.applyPreviewMode(mode, forceReload),
    );
    // Keep the serialization chain settled on failure — a rejected link would
    // silently skip every later application.
    this.viewportChange = run.then(
      () => undefined,
      () => undefined,
    );
    await run;
  }

  private async applyPreviewMode(
    mode: PreviewMode,
    forceReload: boolean,
  ): Promise<void> {
    if (this.stopping || this.degraded) return;
    if (!this.browser || !this.page) return;
    const viewportChanging = mode !== this.previewMode;
    if (!viewportChanging && !forceReload) return;

    const viewport = viewportFor(mode);
    const viewportStr = viewportToString(viewport);
    log.info('browser', 'Sandbox browser viewport changing', {
      from: this.previewMode,
      to: mode,
      viewport: viewportStr,
      forceReload,
    });
    try {
      if (viewportChanging) {
        await this.page.setViewport(viewport);
      }
      // `load` not `networkidle0`: the SDK's /_/telemetry/presence SSE stays
      // open indefinitely (telemetry-mock keepalive), which would pin the
      // network-in-flight count at 1 forever and break this 15s timeout.
      // A viewport change only needs media queries / matchMedia to re-evaluate;
      // we don't need API calls to settle, and the browser-agent's WS
      // reconnects on its own after the page reload.
      await this.page.reload({ waitUntil: 'load', timeout: 15_000 });
    } catch (err) {
      log.warn('browser', 'Sandbox browser viewport change failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
    this.previewMode = mode;

    emitEvent('sandbox-browser-state', {
      state: 'running',
      pid: this.browser.process()?.pid ?? null,
      previewMode: mode,
      viewport: viewportStr,
      executablePath: this.executablePath,
    });
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
        waitForBrowserAgent: this.waitForBrowserAgent,
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
      this.executablePath = launched.executablePath;
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
      this.schedulePing();

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
    this.clearPingTimer();
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

  /**
   * Wedged-page watchdog. Chrome can outlive its page: a page whose main
   * thread never runs again — a native dialog held open, a hot-update render
   * loop — leaves the process healthy, so `disconnected` never fires and the
   * crash path can't see it; every navigation just times out, forever (a real
   * session lost automation for two hours this way). Ping the main thread on
   * a slow cadence and, when a ping hangs past its grace, kill Chrome so the
   * existing crash/restart machinery brings automation back.
   */
  private schedulePing(): void {
    this.clearPingTimer();
    this.pingTimer = setTimeout(() => {
      this.pingTimer = null;
      void this.pingPage();
    }, PAGE_PING_INTERVAL_MS);
  }

  private clearPingTimer(): void {
    if (this.pingTimer) {
      clearTimeout(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private async pingPage(): Promise<void> {
    const { browser, page } = this;
    if (this.stopping || !browser || !page) return;
    // Any settle counts as alive — a rejection (execution context destroyed
    // mid-navigation, say) still proves the renderer is making progress.
    // Only a hang is a wedge.
    const alive = await Promise.race([
      page.evaluate(() => true).then(
        () => true,
        () => true,
      ),
      new Promise<boolean>((resolve) =>
        setTimeout(() => resolve(false), PAGE_PING_TIMEOUT_MS),
      ),
    ]);
    // The browser may have been restarted or torn down under the ping.
    if (this.stopping || this.page !== page) return;
    if (alive) {
      this.schedulePing();
      return;
    }
    log.warn(
      'browser',
      'Sandbox browser page is unresponsive — killing Chrome to trigger a restart',
      { pingTimeoutMs: PAGE_PING_TIMEOUT_MS },
    );
    const proc = browser.process();
    if (!proc) {
      // Not our child (shouldn't happen for a launched browser) — nothing to
      // kill; keep watching.
      this.schedulePing();
      return;
    }
    try {
      proc.kill('SIGKILL');
      // The kill fires `disconnected` → onDisconnect → restart; pings resume
      // once the relaunch succeeds. Nothing to reschedule here.
    } catch {
      this.schedulePing();
    }
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

    // Past MAX_FAILURES we stop reporting the browser as usable, but we keep
    // trying on a slow cadence. This used to `return` here, which made degraded
    // terminal: no further launch was scheduled and `degraded` is only cleared
    // inside launchOnce, so a session that lost Chrome had no automation for the
    // rest of its life — sessions run for hours, and whatever killed Chrome
    // (an OOM spike, a wedged renderer) is usually long gone by the next
    // attempt.
    if (this.consecutiveFailures >= MAX_FAILURES) {
      const wasDegraded = this.degraded;
      this.degraded = true;
      if (!wasDegraded) {
        log.warn(
          'browser',
          'Sandbox browser entering degraded mode after repeated failures — automation is unavailable until a retry succeeds',
          { failures: this.consecutiveFailures },
        );
        emitEvent('sandbox-browser-state', {
          state: 'degraded',
          reason: 'repeated-crashes',
          consecutiveFailures: this.consecutiveFailures,
        });
      }
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        void this.launchOnce();
      }, DEGRADED_RETRY_MS);
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
