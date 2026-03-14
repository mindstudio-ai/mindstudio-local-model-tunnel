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
import {
  getApiKey,
  getApiBaseUrl,
  getUserId,
  getEnvironment,
  getConfigPath,
} from './config';
import { initLoggerHeadless, log, type LogLevel } from './dev/logger';
import { execSync } from 'node:child_process';

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
 * Start the dev tunnel in headless mode.
 *
 * Reads mindstudio.json, starts a platform session, syncs schema,
 * starts the local proxy, and enters the poll loop. Outputs JSON
 * events to stdout. Does not return until shutdown (SIGTERM/SIGINT).
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

  // Read mindstudio.json
  const appConfig = detectAppConfig(cwd);
  if (!appConfig) {
    emit('error', { message: 'No valid mindstudio.json found in ' + cwd });
    return;
  }

  if (!appConfig.appId) {
    emit('error', { message: 'Missing "appId" in mindstudio.json' });
    return;
  }

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

  emit('starting', { appId: appConfig.appId, name: appConfig.name });

  // Resolve dev port
  let devPort = opts.devPort ?? null;
  if (devPort === null) {
    const webConfig = getWebInterfaceConfig(appConfig, cwd);
    devPort = webConfig?.devPort ?? null;
  }

  const bindAddress = opts.bindAddress ?? '127.0.0.1';

  let runner: DevRunner | null = null;
  let proxy: DevProxy | null = null;

  // Graceful shutdown
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    emit('stopping');
    proxy?.stop();
    if (runner) {
      await runner.stop().catch(() => {});
    }
    emit('stopped');
  };

  process.on('SIGTERM', () => { shutdown().then(() => process.exit(0)); });
  process.on('SIGINT', () => { shutdown().then(() => process.exit(0)); });

  try {
    // Start platform session
    const branch = detectGitBranch();
    runner = new DevRunner(appConfig.appId, cwd, {
      branch,
      methods: appConfig.methods.map((m) => ({ id: m.id, export: m.export, path: m.path })),
    });
    const session = await runner.start();

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

    // Start proxy
    let proxyPort: number | null = null;
    if (devPort !== null && session.clientContext) {
      proxy = new DevProxy(devPort, session.clientContext, bindAddress);
      const preferred = opts.proxyPort ?? stablePort(appConfig.appId);
      proxyPort = await proxy.start(preferred);
      runner.setProxyUrl(`http://${bindAddress === '0.0.0.0' ? 'localhost' : bindAddress}:${proxyPort}`);
    }

    emit('session-started', {
      sessionId: session.sessionId,
      releaseId: session.releaseId,
      branch: session.branch,
      proxyPort,
      proxyUrl: proxyPort
        ? `http://${bindAddress === '0.0.0.0' ? 'localhost' : bindAddress}:${proxyPort}/`
        : null,
      webInterfaceUrl: session.webInterfaceUrl,
    });

    // Subscribe to events and relay as JSON
    devRequestEvents.onStart((event) => {
      emit('method-start', { id: event.id, method: event.method });
    });

    devRequestEvents.onComplete((event) => {
      emit('method-complete', {
        id: event.id,
        success: event.success,
        duration: event.duration,
        ...(event.error ? { error: event.error } : {}),
      });
    });

    devRequestEvents.onConnectionWarning((message) => {
      emit('connection-warning', { message });
    });

    devRequestEvents.onConnectionRestored(() => {
      emit('connection-restored');
    });

    devRequestEvents.onSessionExpired(() => {
      emit('session-expired');
      shutdown().then(() => process.exit(1));
    });

    // Keep the process alive — the poll loop runs in DevRunner
    await new Promise<void>(() => {});
  } catch (err) {
    emit('error', {
      message: err instanceof Error ? err.message : 'Unknown error',
    });
    await shutdown();
  }
}
