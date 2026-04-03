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
import { watchConfigFile } from './dev/config/config-watcher';

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

  // Resolve dev port
  let devPort = opts.devPort ?? null;
  if (devPort === null) {
    const webConfig = getWebInterfaceConfig(appConfig, cwd);
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
    appConfig: null,
    proxyPort: null,
    unsubscribers: [],
  };

  let restarting = false;
  let cleanupConfigWatcher: (() => void) | undefined;

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    emitEvent('session-stopping');
    cleanupConfigWatcher?.();
    await teardownAll(state);
    emitEvent('session-stopped');
  };

  process.on('SIGTERM', () => { shutdown().then(() => process.exit(0)); });
  process.on('SIGINT', () => { shutdown().then(() => process.exit(0)); });

  // Initial session start — enter degraded state if config is invalid so the
  // agent/user can fix mindstudio.json and the watcher will pick it up.
  const ok = await startSession(cwd, opts, state, shutdown);
  if (!ok) {
    emitEvent('degraded-state', {
      reason: 'Config invalid or missing at boot. Waiting for valid mindstudio.json.',
    });
    log.warn('session', 'Booting in degraded state — no valid config. Watching for changes.');
  }

  // Stdin command loop
  setupStdinCommands(state, cwd);

  // Watch mindstudio.json for changes — validate before teardown so corrupt
  // writes don't kill a running session. In degraded state (no runner), a
  // valid config triggers a fresh startSession.
  cleanupConfigWatcher = watchConfigFile(cwd, async () => {
    if (stopping || restarting) return;
    restarting = true;
    try {
      emitEvent('config-changed');

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
