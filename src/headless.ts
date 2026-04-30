/**
 * Headless Dev Mode
 *
 * Runs the MindStudio dev tunnel without a TUI. Designed for programmatic
 * control by a parent process (e.g., a sandbox C&C server or CI pipeline).
 *
 * Outputs structured JSON events to stdout (one per line, newline-delimited).
 * The parent process reads these to track session state, method execution,
 * errors, and connection health.
 *
 * Does NOT start a dev server — the parent process manages that separately.
 * The tunnel just needs to know which port to proxy to.
 *
 * @module
 */

import { DevRunner } from './dev/execution/runner';
import { DevProxy } from './dev/proxy/proxy';
import { BrowserSupervisor } from './dev/browser';
import { syncSchema } from './dev/api';
import {
  detectAppConfig,
  getWebInterfaceConfig,
  readTableSources,
} from './dev/config/app-config';
import { initRequestLog, closeRequestLog } from './dev/logging/request-log';
import { initBrowserLog, closeBrowserLog } from './dev/logging/browser-log';
import { subscribeDevEvents } from './dev/ipc/session-events';
import { setupStdinCommands, type SessionState } from './dev/stdin-commands';
import { emitEvent } from './dev/ipc/ipc';
import {
  getApiKey,
  getApiBaseUrl,
  getUserId,
  getEnvironment,
  getConfigPath,
} from './config';
import { initLoggerHeadless, log, type LogLevel } from './dev/logging/logger';
import { stablePort, detectGitBranch } from './dev/utils';
import { watchTableFiles } from './dev/config/table-watcher';
import { watchManifestFiles } from './dev/config/config-watcher';
import { join } from 'node:path';

/**
 * Options for headless dev mode.
 */
export interface HeadlessOptions {
  /** Working directory containing mindstudio.json. Defaults to process.cwd(). */
  cwd?: string;
  /** Port the dev server is running on. If omitted, reads from web.json. If neither, proxy is skipped. */
  devPort?: number;
  /** Preferred port for the local proxy. Defaults to a stable port derived from the app ID. */
  proxyPort?: number;
  /** Bind address for the proxy server. Use '0.0.0.0' for hosted sandboxes. Defaults to '127.0.0.1'. */
  bindAddress?: string;
  /** Log level for stderr output. Defaults to 'info'. */
  logLevel?: LogLevel;
  /** URL for the browser agent script. Defaults to unpkg latest. Set to an ngrok URL for development. */
  browserAgentUrl?: string;
  /** Launch a sandbox-side headless Chrome that participates as a WS client. */
  sandboxBrowser?: boolean;
}


// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

async function startSession(
  cwd: string,
  opts: HeadlessOptions,
  state: SessionState,
  shutdown: () => Promise<void>,
): Promise<boolean> {
  const bindAddress = opts.bindAddress ?? '127.0.0.1';

  // Read fresh config
  const appConfig = detectAppConfig(cwd);
  if (!appConfig) {
    emitEvent('config-error', { message: 'No valid mindstudio.json found in ' + cwd });
    return false;
  }

  if (!appConfig.appId) {
    emitEvent('config-error', { message: 'Missing "appId" in mindstudio.json' });
    return false;
  }

  state.appConfig = appConfig;

  // Resolve dev port + cache the full web config snapshot for hot-apply diffing.
  const webConfig = getWebInterfaceConfig(appConfig, cwd);
  state.lastWebConfig = webConfig;
  let devPort = opts.devPort ?? null;
  if (devPort === null) {
    devPort = webConfig?.devPort ?? null;
  }

  emitEvent('session-starting', { appId: appConfig.appId, name: appConfig.name });

  try {
    // Start platform session
    const branch = detectGitBranch();
    const runner = new DevRunner(appConfig.appId, cwd, {
      branch,
      methods: appConfig.methods.map((m) => ({ id: m.id, export: m.export, path: m.path })),
    });
    runner.setAppConfig(appConfig);
    const session = await runner.start();
    state.runner = runner;

    // Initialize logs
    initRequestLog(cwd);
    initBrowserLog(cwd);

    // Sync schema
    if (appConfig.tables.length > 0) {
      try {
        const tableSources = readTableSources(appConfig, cwd);
        if (tableSources.length > 0) {
          const syncResult = await syncSchema(appConfig.appId, session.sessionId, tableSources);
          session.databases = syncResult.databases;
          emitEvent('schema-sync-completed', {
            created: syncResult.created,
            altered: syncResult.altered,
            errors: syncResult.errors,
          });
        } else {
          log.warn('session', 'No table source files found, skipping schema sync', {
            expected: appConfig.tables.map((t) => t.path),
          });
        }
      } catch (err) {
        emitEvent('schema-sync-completed', {
          created: [],
          altered: [],
          errors: [err instanceof Error ? err.message : 'Schema sync failed'],
        });
      }
    }

    // Start or reuse proxy
    if (devPort !== null && session.clientContext) {
      if (state.proxy) {
        // Proxy persists across restarts — just update the context
        state.proxy.updateClientContext(session.clientContext);
      } else {
        const proxy = new DevProxy(devPort, session.clientContext, appConfig.appId, bindAddress, opts.browserAgentUrl);
        const preferred = opts.proxyPort ?? stablePort(appConfig.appId);
        const proxyPort = await proxy.start(preferred);
        state.proxy = proxy;
        state.proxyPort = proxyPort;
      }

      runner.setProxyUrl(`http://${bindAddress === '0.0.0.0' ? 'localhost' : bindAddress}:${state.proxyPort}`);
      runner.setProxy(state.proxy);

      // Optional sandbox-side headless Chrome. Connects back to the proxy
      // as just another WS client; the proxy registers it with mode='headless'
      // and getCommandTarget() prefers it for automation. Viewport follows
      // the web interface's defaultPreviewMode so mobile-first apps render
      // at mobile dimensions in the sandbox Chrome too.
      if (opts.sandboxBrowser && state.proxyPort !== null && !state.browser) {
        const previewMode = state.lastWebConfig?.defaultPreviewMode ?? 'desktop';
        const supervisor = new BrowserSupervisor(state.proxyPort, previewMode);
        state.browser = supervisor;
        supervisor.start().catch((err) => {
          log.warn('browser', 'Sandbox browser failed to start', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    }

    emitEvent('session-started', {
      sessionId: session.sessionId,
      releaseId: session.releaseId,
      branch: session.branch,
      proxyPort: state.proxyPort,
      proxyUrl: state.proxyPort
        ? `http://${bindAddress === '0.0.0.0' ? 'localhost' : bindAddress}:${state.proxyPort}/`
        : null,
      webInterfaceUrl: session.webInterfaceUrl,
      roles: appConfig.roles.map((r) => ({ id: r.id, name: r.name ?? r.id, description: r.description })),
      scenarios: appConfig.scenarios.map((s) => ({
        id: s.id,
        name: s.name ?? s.export,
        description: s.description,
        path: s.path,
        roles: s.roles,
      })),
    });

    // Subscribe to runner events
    state.unsubscribers.push(...subscribeDevEvents(shutdown));

    // Watch table source files for changes — auto-sync without session restart
    setupTableWatchers(cwd, state);

    // Start polling for platform method requests now that schema sync,
    // proxy, and watchers are all set up. Starting earlier would risk
    // executing methods against stale session state (e.g. missing tables).
    runner.startPolling();

    return true;
  } catch (err) {
    emitEvent('config-error', {
      message: err instanceof Error ? err.message : 'Failed to start session',
    });
    return false;
  }
}

function setupTableWatchers(cwd: string, state: SessionState): void {
  if (!state.appConfig || state.appConfig.tables.length === 0) return;

  const cleanup = watchTableFiles(state.appConfig.tables, cwd, async () => {
    if (!state.runner || !state.appConfig?.appId) return;
    const session = state.runner.getSession();
    if (!session) return;

    emitEvent('schema-sync-started');
    log.info('session', 'Table source file changed, syncing schema');

    try {
      const tableSources = readTableSources(state.appConfig, cwd);
      if (tableSources.length > 0) {
        const result = await syncSchema(state.appConfig.appId, session.sessionId, tableSources);
        session.databases = result.databases;
        emitEvent('schema-sync-completed', {
          created: result.created,
          altered: result.altered,
          errors: result.errors,
        });
        log.info('session', 'Schema sync complete', { created: result.created, altered: result.altered });
      } else {
        log.warn('session', 'Table source file change detected but file(s) still missing', {
          expected: state.appConfig.tables.map((t) => t.path),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Schema sync failed';
      emitEvent('schema-sync-completed', { created: [], altered: [], errors: [message] });
      log.warn('session', 'Schema sync failed', { error: message });
    }
  });

  state.unsubscribers.push(cleanup);
}

/**
 * Hot-apply a web.json `defaultPreviewMode` change without a full session
 * restart. Returns true if the change was hot-applied (and the caller should
 * stop processing); false if the change requires a full restart and the
 * caller should fall through to the existing restart path.
 *
 * Conditions for hot-apply:
 *   - The changed file is the currently-active web.json (resolved via
 *     interfaces[].path).
 *   - A sandbox browser supervisor exists.
 *   - The only field that differs from the cached snapshot is
 *     `defaultPreviewMode`. devPort/devCommand changes still need a restart
 *     because they affect proxy upstream + sandbox-manager-spawned dev server.
 */
async function tryHotApplyWebConfigChange(
  state: SessionState,
  cwd: string,
  changedPath: string,
): Promise<boolean> {
  if (!state.appConfig || !state.browser || !state.lastWebConfig) return false;

  const webIface = state.appConfig.interfaces.find(
    (i) => i.type === 'web' && i.enabled !== false,
  );
  if (!webIface) return false;
  const webPath = join(cwd, webIface.path);
  if (changedPath !== webPath) return false;

  const newWeb = getWebInterfaceConfig(state.appConfig, cwd);
  if (!newWeb) return false;

  const onlyPreviewModeChanged =
    newWeb.devPort === state.lastWebConfig.devPort &&
    newWeb.devCommand === state.lastWebConfig.devCommand &&
    newWeb.defaultPreviewMode !== state.lastWebConfig.defaultPreviewMode;
  if (!onlyPreviewModeChanged) return false;

  const nextMode = newWeb.defaultPreviewMode ?? 'desktop';
  log.info('session', 'web.json change is preview-mode-only, hot-applying', {
    from: state.lastWebConfig.defaultPreviewMode,
    to: nextMode,
  });
  state.lastWebConfig = newWeb;
  await state.browser.setPreviewMode(nextMode);
  return true;
}

/** Tear down the runner, logs, and watchers. Proxy stays alive for reuse. */
async function teardownRunner(state: SessionState): Promise<void> {
  for (const unsub of state.unsubscribers) unsub();
  state.unsubscribers = [];

  if (state.runner) {
    await state.runner.stop().catch(() => {});
    state.runner = null;
  }

  closeRequestLog();
  closeBrowserLog();
}

/** Full teardown including proxy. Used on process shutdown. */
async function teardownAll(state: SessionState): Promise<void> {
  await teardownRunner(state);

  if (state.browser) {
    await state.browser.stop().catch(() => {});
    state.browser = null;
  }

  state.proxy?.stop();
  state.proxy = null;
  state.proxyPort = null;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Start the dev tunnel in headless mode.
 */
export async function startHeadless(opts: HeadlessOptions = {}): Promise<void> {
  initLoggerHeadless(opts.logLevel ?? 'info');

  const cwd = opts.cwd ?? process.cwd();

  const apiKey = getApiKey();
  const userId = getUserId();
  log.info('session', 'Startup config', {
    configPath: getConfigPath(),
    environment: getEnvironment(),
    apiBaseUrl: getApiBaseUrl(),
    hasApiKey: !!apiKey,
    apiKeyPrefix: apiKey ? apiKey.slice(0, 8) + '...' : null,
    hasUserId: !!userId,
    userId: userId ?? null,
    cwd,
  });

  const state: SessionState = {
    runner: null,
    proxy: null,
    browser: null,
    appConfig: null,
    lastWebConfig: null,
    proxyPort: null,
    unsubscribers: [],
  };

  let restarting = false;
  let cleanupConfigWatcher: (() => void) | undefined;

  let stopping = false;
  let degradedRetryTimer: ReturnType<typeof setInterval> | null = null;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    if (degradedRetryTimer) { clearInterval(degradedRetryTimer); degradedRetryTimer = null; }
    emitEvent('session-stopping');
    cleanupConfigWatcher?.();
    await teardownAll(state);
    emitEvent('session-stopped');
  };

  process.on('SIGTERM', () => { shutdown().then(() => process.exit(0)); });
  process.on('SIGINT', () => { shutdown().then(() => process.exit(0)); });

  // Initial session start — retry a few times with backoff before degrading.
  // Snapshot resumes often hit a transient 400 from /manage/start because the
  // platform-side session state is stale. A short retry usually recovers.
  const MAX_START_RETRIES = 5;
  let started = false;
  for (let attempt = 1; attempt <= MAX_START_RETRIES && !stopping; attempt++) {
    started = await startSession(cwd, opts, state, shutdown);
    if (started) break;
    if (attempt < MAX_START_RETRIES) {
      const delay = Math.min(1000 * 2 ** (attempt - 1), 10_000);
      log.info('session', `Start failed, retrying in ${delay}ms`, { attempt, maxAttempts: MAX_START_RETRIES });
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  if (!started && !stopping) {
    emitEvent('degraded-state', {
      reason: 'Config invalid or missing at boot. Waiting for valid mindstudio.json.',
    });
    log.warn('session', 'Booting in degraded state — no valid config. Watching for changes.');

    // Periodically retry in degraded state (covers transient platform issues
    // that outlast the initial retry window, e.g. long snapshot resume).
    degradedRetryTimer = setInterval(async () => {
      if (stopping || restarting || state.runner) {
        if (state.runner && degradedRetryTimer) {
          clearInterval(degradedRetryTimer);
          degradedRetryTimer = null;
        }
        return;
      }
      restarting = true;
      try {
        log.info('session', 'Retrying session start from degraded state');
        const ok = await startSession(cwd, opts, state, shutdown);
        if (ok) {
          emitEvent('degraded-state-resolved', { appId: state.appConfig?.appId });
          log.info('session', 'Recovered from degraded state');
          if (degradedRetryTimer) {
            clearInterval(degradedRetryTimer);
            degradedRetryTimer = null;
          }
        }
      } finally {
        restarting = false;
      }
    }, 15_000);
  }

  // Stdin command loop
  setupStdinCommands(state, cwd);

  // Watch mindstudio.json + every interface JSON it references. Most changes
  // trigger a full session restart (validate before teardown so corrupt writes
  // don't kill the running session). The only exception is web.json's
  // `defaultPreviewMode` — that hot-applies via the supervisor without a
  // restart, so rrweb continuity and cookies survive the swap.
  cleanupConfigWatcher = watchManifestFiles(cwd, async (changedPath) => {
    if (stopping || restarting) return;

    // Try the hot-apply fast path first — only triggers when the changed
    // file IS the active web.json AND the only field that differs is
    // defaultPreviewMode. Anything else falls through to the restart path.
    if (await tryHotApplyWebConfigChange(state, cwd, changedPath)) {
      return;
    }

    restarting = true;
    try {
      emitEvent('config-changed', { path: changedPath });

      // Validate BEFORE tearing down the running session
      const newConfig = detectAppConfig(cwd);
      if (!newConfig || !newConfig.appId) {
        emitEvent('config-error', {
          message: 'mindstudio.json is invalid — keeping current session',
        });
        log.warn('session', 'Config change detected but file is invalid, keeping current session');
        return;
      }

      const wasDegraded = !state.runner;
      await teardownRunner(state);
      const ok = await startSession(cwd, opts, state, shutdown);
      if (ok) {
        if (wasDegraded) {
          emitEvent('degraded-state-resolved', { appId: newConfig.appId });
          log.info('session', 'Recovered from degraded state');
          if (degradedRetryTimer) { clearInterval(degradedRetryTimer); degradedRetryTimer = null; }
        }
        if (state.proxy) {
          state.proxy.broadcastToClients('reload');
        }
      } else {
        emitEvent('degraded-state', {
          reason: 'Session restart failed after config change. Will retry on next change.',
        });
        log.warn('session', 'Session restart failed, entering degraded state');
      }
    } finally {
      restarting = false;
    }
  });

  // Keep the process alive — the poll loop runs in DevRunner
  await new Promise<void>(() => {});
}
