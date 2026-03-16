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
 * | Event                | When                                      | Key Fields                                    |
 * |----------------------|-------------------------------------------|-----------------------------------------------|
 * | `starting`           | Headless mode initializing                | `appId`, `name`                               |
 * | `session-started`    | Platform session active, proxy running    | `sessionId`, `branch`, `proxyPort`, `proxyUrl`|
 * | `schema-synced`      | Table schema synced to platform           | `created`, `altered`, `errors`                |
 * | `method-start`       | Method execution request received         | `id`, `method`                                |
 * | `method-complete`    | Method execution finished                 | `id`, `success`, `duration`, `error?`         |
 * | `connection-warning` | Lost connection to platform, retrying     | `message`                                     |
 * | `connection-restored`| Reconnected after connection loss         |                                               |
 * | `session-expired`    | Platform expired the dev session          |                                               |
 * | `config-changed`     | mindstudio.json changed, restarting       |                                               |
 * | `config-error`       | Config invalid during restart             | `message`                                     |
 * | `error`              | Fatal error, headless mode will exit      | `message`                                     |
 * | `stopping`           | Graceful shutdown initiated               |                                               |
 * | `stopped`            | All resources cleaned up, exiting         |                                               |
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
import {
  getApiKey,
  getApiBaseUrl,
  getUserId,
  getEnvironment,
  getConfigPath,
} from './config';
import { initLoggerHeadless, log, type LogLevel } from './dev/logger';
import { execSync } from 'node:child_process';
import { watch, type FSWatcher } from 'node:fs';
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

/** Derive a stable port number (3100-3999) from the app ID. */
function stablePort(appId: string): number {
  let hash = 0;
  for (let i = 0; i < appId.length; i++) {
    hash = ((hash << 5) - hash + appId.charCodeAt(i)) | 0;
  }
  return 3100 + (Math.abs(hash) % 900);
}

/** Detect current git branch, or undefined if not in a git repo. */
function detectGitBranch(): string | undefined {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || undefined;
  } catch {
    return undefined;
  }
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
    emit('config-error', { message: 'No valid mindstudio.json found in ' + cwd });
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

  emit('starting', { appId: appConfig.appId, name: appConfig.name });

  try {
    // Start platform session
    const branch = detectGitBranch();
    const runner = new DevRunner(appConfig.appId, cwd, {
      branch,
      methods: appConfig.methods.map((m) => ({ id: m.id, export: m.export, path: m.path })),
    });
    const session = await runner.start();
    state.runner = runner;

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
          emit('schema-synced', {
            created: syncResult.created,
            altered: syncResult.altered,
            errors: syncResult.errors,
          });
        }
      } catch (err) {
        emit('schema-synced', {
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
      const proxy = new DevProxy(devPort, session.clientContext, bindAddress);
      const preferred = opts.proxyPort ?? stablePort(appConfig.appId);
      proxyPort = await proxy.start(preferred);
      runner.setProxyUrl(`http://${bindAddress === '0.0.0.0' ? 'localhost' : bindAddress}:${proxyPort}`);
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
      roles: appConfig.roles.map((r) => ({ id: r.id, name: r.name, description: r.description })),
      scenarios: appConfig.scenarios.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        path: s.path,
        roles: s.roles,
      })),
    });

    // Subscribe to events and relay as JSON.
    // Store unsubscribe functions so we can clean up on restart.
    const unsubs = state.unsubscribers;

    unsubs.push(devRequestEvents.onStart((event) => {
      emit('method-start', { id: event.id, method: event.method });
    }));

    unsubs.push(devRequestEvents.onComplete((event) => {
      emit('method-complete', {
        id: event.id,
        success: event.success,
        duration: event.duration,
        ...(event.error ? { error: event.error } : {}),
      });
    }));

    unsubs.push(devRequestEvents.onConnectionWarning((message) => {
      emit('connection-warning', { message });
    }));

    unsubs.push(devRequestEvents.onConnectionRestored(() => {
      emit('connection-restored');
    }));

    unsubs.push(devRequestEvents.onSessionExpired(() => {
      emit('session-expired');
      shutdown().then(() => process.exit(1));
    }));

    unsubs.push(devRequestEvents.onImpersonate((event) => {
      emit('impersonated', { roles: event.roles });
    }));

    unsubs.push(devRequestEvents.onScenarioStart((event) => {
      emit('scenario-start', { id: event.id, name: event.name });
    }));

    unsubs.push(devRequestEvents.onScenarioComplete((event) => {
      emit('scenario-complete', {
        id: event.id,
        success: event.success,
        duration: event.duration,
        roles: event.roles,
        ...(event.error ? { error: event.error } : {}),
      });
    }));

    return true;
  } catch (err) {
    emit('config-error', {
      message: err instanceof Error ? err.message : 'Failed to start session',
    });
    return false;
  }
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
  log.info('headless Auth config', {
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
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  let restarting = false;
  let watcher: FSWatcher | undefined;

  // Graceful shutdown
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    emit('stopping');
    clearTimeout(restartTimer);
    watcher?.close();
    await teardownSession(state);
    emit('stopped');
  };

  process.on('SIGTERM', () => { shutdown().then(() => process.exit(0)); });
  process.on('SIGINT', () => { shutdown().then(() => process.exit(0)); });

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

  // Watch mindstudio.json for changes — restart session on edit (500ms debounce)
  try {
    const configPath = join(cwd, 'mindstudio.json');
    watcher = watch(configPath, () => {
      clearTimeout(restartTimer);
      restartTimer = setTimeout(async () => {
        if (stopping || restarting) return;
        restarting = true;
        try {
          log.info('headless Config changed, restarting session');
          emit('config-changed');
          await teardownSession(state);
          await startSession(cwd, opts, state, shutdown);
        } finally {
          restarting = false;
        }
      }, 500);
    });
  } catch {
    // File might not exist yet or watch not supported
  }

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
        const cmd = JSON.parse(line) as { action: string; [key: string]: unknown };
        handleStdinCommand(cmd, state, cwd);
      } catch {
        emit('error', { message: `Invalid JSON on stdin: ${line.slice(0, 100)}` });
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
    case 'runScenario': {
      if (!state.runner) {
        emit('error', { message: 'No active session' });
        return;
      }
      const freshConfig = detectAppConfig(cwd) ?? state.appConfig;
      const scenario = freshConfig?.scenarios.find((s) => s.id === cmd.scenarioId);
      if (!scenario) {
        emit('error', { message: `Unknown scenario: ${cmd.scenarioId}` });
        return;
      }
      // Runner emits scenario-start/complete events which are already relayed
      await state.runner.runScenario(scenario);
      break;
    }

    case 'syncSchema': {
      if (!state.runner) {
        emit('error', { message: 'No active session' });
        return;
      }
      const freshConfig = detectAppConfig(cwd) ?? state.appConfig;
      const session = state.runner.getSession();
      if (!session || !freshConfig?.appId) {
        emit('error', { message: 'No active session for schema sync' });
        return;
      }
      try {
        const tableSources = readTableSources(freshConfig, cwd);
        if (tableSources.length > 0) {
          const result = await syncSchema(freshConfig.appId, session.sessionId, tableSources);
          emit('schema-synced', {
            created: result.created,
            altered: result.altered,
            errors: result.errors,
          });
        }
      } catch (err) {
        emit('error', { message: err instanceof Error ? err.message : 'Schema sync failed' });
      }
      break;
    }

    case 'impersonate': {
      if (!state.runner) {
        emit('error', { message: 'No active session' });
        return;
      }
      const roles = cmd.roles as string[];
      if (!Array.isArray(roles)) {
        emit('error', { message: 'impersonate requires roles array' });
        return;
      }
      await state.runner.setImpersonation(roles);
      break;
    }

    case 'clearImpersonation': {
      if (!state.runner) {
        emit('error', { message: 'No active session' });
        return;
      }
      await state.runner.clearImpersonation();
      break;
    }

    case 'listRoles': {
      const freshConfig = detectAppConfig(cwd) ?? state.appConfig;
      emit('roles-list', {
        roles: (freshConfig?.roles ?? []).map((r) => ({ id: r.id, name: r.name, description: r.description })),
      });
      break;
    }

    case 'listScenarios': {
      const freshConfig = detectAppConfig(cwd) ?? state.appConfig;
      emit('scenarios-list', {
        scenarios: (freshConfig?.scenarios ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          roles: s.roles,
        })),
      });
      break;
    }

    default:
      emit('error', { message: `Unknown action: ${cmd.action}` });
  }
}
