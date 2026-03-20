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
 * ## JSON Event Protocol
 *
 * Every line written to stdout is a JSON object with an `event` field:
 *
 * | Event                  | When                                    | Key Fields                                    |
 * |------------------------|-----------------------------------------|-----------------------------------------------|
 * | `session-starting`     | Session initializing                    | `appId`, `name`                               |
 * | `session-started`      | Platform session active, proxy running  | `sessionId`, `branch`, `proxyPort`, `proxyUrl`|
 * | `session-stopping`     | Graceful shutdown initiated             |                                               |
 * | `session-stopped`      | All resources cleaned up                |                                               |
 * | `session-expired`      | Platform expired the dev session        |                                               |
 * | `method-started`       | Method execution request received       | `id`, `method`                                |
 * | `method-completed`     | Method execution finished               | `id`, `success`, `duration`, `error?`         |
 * | `scenario-started`     | Scenario execution started              | `id`, `name`                                  |
 * | `scenario-completed`   | Scenario execution finished             | `id`, `success`, `duration`, `roles`, `error?`|
 * | `schema-sync-started`  | Table file changed, syncing schema      |                                               |
 * | `schema-sync-completed`| Schema synced to platform               | `created`, `altered`, `errors`                |
 * | `impersonation-changed`| Role override set or cleared            | `roles`                                       |
 * | `connection-lost`      | Lost connection, retrying with backoff  | `message`                                     |
 * | `connection-restored`  | Reconnected after connection loss       |                                               |
 * | `config-changed`       | mindstudio.json changed, restarting     |                                               |
 * | `config-error`         | Config invalid (non-fatal)              | `message`                                     |
 * | `command-error`        | Stdin command failed (non-fatal)        | `message`                                     |
 * | `error`                | Fatal startup error                     | `message`                                     |
 *
 * ## Usage
 *
 * CLI:
 * ```bash
 * mindstudio-local --headless --port 5173 --bind 0.0.0.0
 * ```
 *
 * Programmatic:
 * ```typescript
 * import { startHeadless } from '@mindstudio-ai/local-model-tunnel';
 *
 * await startHeadless({
 *   cwd: '/path/to/project',
 *   devPort: 5173,
 *   bindAddress: '0.0.0.0',
 * });
 * ```
 *
 * @module
 */

import { DevRunner } from './dev/runner';
import { DevProxy } from './dev/proxy';
import { devRequestEvents } from './dev/events';
import { syncSchema } from './dev/api';
import {
  detectAppConfig,
  getWebInterfaceConfig,
  readTableSources,
} from './dev/app-config';
import type { AppConfig } from './dev/types';
import { initRequestLog, closeRequestLog } from './dev/request-log';
import { initBrowserLog, closeBrowserLog } from './dev/browser-log';
import {
  getApiKey,
  getApiBaseUrl,
  getUserId,
  getEnvironment,
  getConfigPath,
} from './config';
import { initLoggerHeadless, log, type LogLevel } from './dev/logger';
import { stablePort, detectGitBranch } from './dev/utils';
import { watchTableFiles } from './dev/table-watcher';
import { watchConfigFile } from './dev/config-watcher';

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
  /** URL for the browser agent script. Defaults to self-served at /__mindstudio_dev__/agent.js. Set to an ngrok URL for development. */
  browserAgentUrl?: string;
}

/** Mutable state shared across the session lifecycle, stdin commands, and file watcher. */
interface SessionState {
  runner: DevRunner | null;
  proxy: DevProxy | null;
  appConfig: AppConfig | null;
  proxyPort: number | null;
  unsubscribers: Array<() => void>;
}

/** Write a JSON event to stdout. */
function emit(event: string, data?: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify({ event, ...data }) + '\n');
}

/**
 * Start a dev session: read config, start runner, sync schema, start proxy,
 * subscribe to events. Returns true on success, false on config/startup error
 * (non-fatal — caller can retry on next config change).
 */
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
    emit('config-error', {
      message: 'No valid mindstudio.json found in ' + cwd,
    });
    return false;
  }

  if (!appConfig.appId) {
    emit('config-error', { message: 'Missing "appId" in mindstudio.json' });
    return false;
  }

  state.appConfig = appConfig;

  // Resolve dev port
  let devPort = opts.devPort ?? null;
  if (devPort === null) {
    const webConfig = getWebInterfaceConfig(appConfig, cwd);
    devPort = webConfig?.devPort ?? null;
  }

  emit('session-starting', { appId: appConfig.appId, name: appConfig.name });

  try {
    // Start platform session
    const branch = detectGitBranch();
    const runner = new DevRunner(appConfig.appId, cwd, {
      branch,
      methods: appConfig.methods.map((m) => ({
        id: m.id,
        export: m.export,
        path: m.path,
      })),
    });
    const session = await runner.start();
    state.runner = runner;

    // Initialize logs for method execution tracking and browser capture
    initRequestLog(cwd);
    initBrowserLog(cwd);

    // Sync schema
    if (appConfig.tables.length > 0) {
      try {
        const tableSources = readTableSources(appConfig, cwd);
        if (tableSources.length > 0) {
          const syncResult = await syncSchema(
            appConfig.appId,
            session.sessionId,
            tableSources,
          );
          session.databases = syncResult.databases;
          emit('schema-sync-completed', {
            created: syncResult.created,
            altered: syncResult.altered,
            errors: syncResult.errors,
          });
        } else {
          log.warn('No table source files found, skipping schema sync', {
            expected: appConfig.tables.map((t) => t.path),
          });
        }
      } catch (err) {
        emit('schema-sync-completed', {
          created: [],
          altered: [],
          errors: [err instanceof Error ? err.message : 'Schema sync failed'],
        });
      }
    }

    // Start proxy — sits in front of the dev server, injects __MINDSTUDIO__.
    // Only started if we have a dev server port and the platform returned clientContext.
    // In headless mode we don't start the dev server (caller manages it), but we
    // do start the proxy so the preview URL works.
    let proxyPort: number | null = null;
    if (devPort !== null && session.clientContext) {
      const proxy = new DevProxy(devPort, session.clientContext, bindAddress, opts.browserAgentUrl);
      const preferred = opts.proxyPort ?? stablePort(appConfig.appId);
      proxyPort = await proxy.start(preferred);
      runner.setProxyUrl(
        `http://${bindAddress === '0.0.0.0' ? 'localhost' : bindAddress}:${proxyPort}`,
      );
      runner.setProxy(proxy);
      state.proxy = proxy;
    }
    state.proxyPort = proxyPort;

    emit('session-started', {
      sessionId: session.sessionId,
      releaseId: session.releaseId,
      branch: session.branch,
      proxyPort,
      proxyUrl: proxyPort
        ? `http://${bindAddress === '0.0.0.0' ? 'localhost' : bindAddress}:${proxyPort}/`
        : null,
      webInterfaceUrl: session.webInterfaceUrl,
      roles: appConfig.roles.map((r) => ({
        id: r.id,
        name: r.name ?? r.id,
        description: r.description,
      })),
      scenarios: appConfig.scenarios.map((s) => ({
        id: s.id,
        name: s.name ?? s.export,
        description: s.description,
        path: s.path,
        roles: s.roles,
      })),
    });

    // Subscribe to events and relay as JSON.
    // Store unsubscribe functions so we can clean up on restart.
    const unsubs = state.unsubscribers;

    unsubs.push(
      devRequestEvents.onStart((event) => {
        emit('method-started', { id: event.id, method: event.method });
      }),
    );

    unsubs.push(
      devRequestEvents.onComplete((event) => {
        emit('method-completed', {
          id: event.id,
          success: event.success,
          duration: event.duration,
          ...(event.error ? { error: event.error } : {}),
        });
      }),
    );

    unsubs.push(
      devRequestEvents.onConnectionWarning((message) => {
        emit('connection-lost', { message });
      }),
    );

    unsubs.push(
      devRequestEvents.onConnectionRestored(() => {
        emit('connection-restored');
      }),
    );

    unsubs.push(
      devRequestEvents.onSessionExpired(() => {
        emit('session-expired');
        shutdown().then(() => process.exit(1));
      }),
    );

    unsubs.push(
      devRequestEvents.onAuthRefreshStart((url) => {
        emit('auth-refresh-start', { url });
      }),
    );

    unsubs.push(
      devRequestEvents.onAuthRefreshSuccess(() => {
        emit('auth-refresh-success');
      }),
    );

    unsubs.push(
      devRequestEvents.onAuthRefreshFailed(() => {
        emit('auth-refresh-failed');
      }),
    );

    unsubs.push(
      devRequestEvents.onImpersonate((event) => {
        emit('impersonation-changed', { roles: event.roles });
      }),
    );

    unsubs.push(
      devRequestEvents.onScenarioStart((event) => {
        emit('scenario-started', { id: event.id, name: event.name });
      }),
    );

    unsubs.push(
      devRequestEvents.onScenarioComplete((event) => {
        emit('scenario-completed', {
          id: event.id,
          success: event.success,
          duration: event.duration,
          roles: event.roles,
          ...(event.error ? { error: event.error } : {}),
        });
      }),
    );

    // Watch table source files for changes — auto-sync without session restart
    setupTableWatchers(cwd, state);

    return true;
  } catch (err) {
    emit('config-error', {
      message: err instanceof Error ? err.message : 'Failed to start session',
    });
    return false;
  }
}

/** Set up table file watchers that auto-sync schema on change. */
function setupTableWatchers(cwd: string, state: SessionState): void {
  if (!state.appConfig || state.appConfig.tables.length === 0) return;

  const cleanup = watchTableFiles(state.appConfig.tables, cwd, async () => {
    if (!state.runner || !state.appConfig?.appId) return;
    const session = state.runner.getSession();
    if (!session) return;

    emit('schema-sync-started');
    log.info('Table source file changed, syncing schema');

    try {
      const tableSources = readTableSources(state.appConfig, cwd);
      if (tableSources.length > 0) {
        const result = await syncSchema(
          state.appConfig.appId,
          session.sessionId,
          tableSources,
        );
        session.databases = result.databases;
        emit('schema-sync-completed', {
          created: result.created,
          altered: result.altered,
          errors: result.errors,
        });
        log.info('Schema sync complete', {
          created: result.created,
          altered: result.altered,
        });
      } else {
        log.warn('Table source file change detected but file(s) still missing', {
          expected: state.appConfig.tables.map((t) => t.path),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Schema sync failed';
      emit('command-error', { message });
      log.warn('Schema sync failed', { error: message });
    }
  });

  state.unsubscribers.push(cleanup);
}

/** Tear down the current session: unsubscribe events, stop proxy, stop runner. */
async function teardownSession(state: SessionState): Promise<void> {
  for (const unsub of state.unsubscribers) unsub();
  state.unsubscribers = [];

  state.proxy?.stop();
  state.proxy = null;
  state.proxyPort = null;

  if (state.runner) {
    await state.runner.stop().catch(() => {});
    state.runner = null;
  }

  closeRequestLog();
  closeBrowserLog();
}

/**
 * Start the dev tunnel in headless mode.
 *
 * Reads mindstudio.json, starts a platform session, syncs schema,
 * starts the local proxy, and enters the poll loop. Outputs JSON
 * events to stdout. Does not return until shutdown (SIGTERM/SIGINT).
 *
 * Watches mindstudio.json for changes and automatically restarts the
 * session when the config is updated (same behavior as the TUI).
 *
 * Does NOT start a dev server — the caller is responsible for that.
 *
 * @param opts - Configuration options
 *
 * @example
 * ```typescript
 * // From a C&C server — spawn and read events
 * import { startHeadless } from '@mindstudio-ai/local-model-tunnel';
 *
 * await startHeadless({
 *   cwd: '/workspace/my-app',
 *   devPort: 5173,
 *   bindAddress: '0.0.0.0',
 * });
 * ```
 */
export async function startHeadless(opts: HeadlessOptions = {}): Promise<void> {
  initLoggerHeadless(opts.logLevel ?? 'info');

  const cwd = opts.cwd ?? process.cwd();

  // Log auth config so sandbox operators can diagnose issues
  const apiKey = getApiKey();
  const userId = getUserId();
  log.info('Startup config', {
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

  // File watcher state
  let restarting = false;
  let cleanupConfigWatcher: (() => void) | undefined;

  // Graceful shutdown
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    emit('session-stopping');
    cleanupConfigWatcher?.();
    await teardownSession(state);
    emit('session-stopped');
  };

  process.on('SIGTERM', () => {
    shutdown().then(() => process.exit(0));
  });
  process.on('SIGINT', () => {
    shutdown().then(() => process.exit(0));
  });

  // Initial session start
  const ok = await startSession(cwd, opts, state, shutdown);
  if (!ok && !state.appConfig) {
    // No valid config at all on first try — emit fatal error.
    // The watcher below will still start if the file exists, so the
    // process stays alive to retry on config fix.
    emit('error', { message: 'No valid mindstudio.json found in ' + cwd });
  }

  // Stdin command loop — reads from state so it always sees current runner/config
  setupStdinCommands(state, cwd);

  // Watch mindstudio.json for changes — restart session on edit
  cleanupConfigWatcher = watchConfigFile(cwd, async () => {
    if (stopping || restarting) return;
    restarting = true;
    try {
      log.info('mindstudio.json changed, restarting dev session');
      emit('config-changed');
      await teardownSession(state);
      await startSession(cwd, opts, state, shutdown);
    } finally {
      restarting = false;
    }
  });

  // Keep the process alive — the poll loop runs in DevRunner
  await new Promise<void>(() => {});
}

/**
 * Read NDJSON commands from stdin and dispatch them.
 * Uses the shared state object so commands always reference the current session.
 */
function setupStdinCommands(state: SessionState, cwd: string): void {
  if (!process.stdin.readable) return;

  let buffer = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;

      try {
        const cmd = JSON.parse(line) as {
          action: string;
          [key: string]: unknown;
        };
        handleStdinCommand(cmd, state, cwd);
      } catch {
        emit('command-error', {
          message: `Invalid JSON on stdin: ${line.slice(0, 100)}`,
        });
      }
    }
  });
}

async function handleStdinCommand(
  cmd: { action: string; [key: string]: unknown },
  state: SessionState,
  cwd: string,
): Promise<void> {
  switch (cmd.action) {
    case 'run-scenario': {
      if (!state.runner) {
        emit('command-error', { message: 'No active session' });
        return;
      }
      const freshConfig = detectAppConfig(cwd) ?? state.appConfig;
      const scenario = freshConfig?.scenarios.find(
        (s) => s.id === cmd.scenarioId,
      );
      if (!scenario) {
        emit('command-error', {
          message: `Unknown scenario: ${cmd.scenarioId}`,
        });
        return;
      }
      // Runner emits scenario-start/complete events which are already relayed
      await state.runner.runScenario(scenario);
      break;
    }

    case 'run-method': {
      if (!state.runner) {
        emit('command-error', { message: 'No active session' });
        return;
      }
      const methodName = cmd.method as string;
      if (!methodName) {
        emit('command-error', { message: 'run-method requires "method" (export name or ID)' });
        return;
      }
      const freshConfig = detectAppConfig(cwd) ?? state.appConfig;
      const method = freshConfig?.methods.find((m) => m.export === methodName)
        ?? freshConfig?.methods.find((m) => m.id === methodName);
      if (!method) {
        emit('command-error', { message: `Unknown method: ${methodName}` });
        return;
      }
      const methodResult = await state.runner.runMethod({
        methodExport: method.export,
        methodPath: method.path,
        input: cmd.input ?? {},
      });
      emit('method-run-completed', {
        method: method.export,
        success: methodResult.success,
        output: methodResult.output ?? null,
        error: methodResult.error ?? null,
        stdout: methodResult.stdout ?? [],
        duration: methodResult.duration,
      });
      break;
    }

    case 'impersonate': {
      if (!state.runner) {
        emit('command-error', { message: 'No active session' });
        return;
      }
      const roles = cmd.roles as string[];
      if (!Array.isArray(roles)) {
        emit('command-error', { message: 'impersonate requires roles array' });
        return;
      }
      await state.runner.setImpersonation(roles);
      break;
    }

    case 'clear-impersonation': {
      if (!state.runner) {
        emit('command-error', { message: 'No active session' });
        return;
      }
      await state.runner.clearImpersonation();
      break;
    }

    case 'browser': {
      if (!state.proxy) {
        emit('command-error', { message: 'No active proxy — browser commands require a web interface' });
        return;
      }
      const steps = cmd.steps as Array<Record<string, unknown>>;
      if (!Array.isArray(steps) || steps.length === 0) {
        emit('command-error', { message: 'browser action requires a non-empty "steps" array' });
        return;
      }
      try {
        const result = await state.proxy.dispatchBrowserCommand(steps);
        emit('browser-completed', {
          steps: result.steps,
          snapshot: result.snapshot,
          duration: result.duration,
        });
      } catch (err) {
        emit('command-error', {
          message: err instanceof Error ? err.message : 'Browser command failed',
        });
      }
      break;
    }

    default:
      emit('command-error', { message: `Unknown action: ${cmd.action}` });
  }
}
