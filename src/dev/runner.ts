// DevRunner — the core of dev mode.
//
// Lifecycle: start() → pollLoop() → handleRequest() → stop()
//
// The runner polls the platform for method execution requests, transpiles
// TypeScript on the fly, executes methods in isolated child processes, and
// posts results back. It does NOT handle the frontend (that's the proxy).
//
// The poll loop runs continuously. Requests are handled in the background
// so multiple methods can execute in parallel without blocking the poll.
// Connection issues trigger exponential backoff; 404 = session expired.

import {
  startDevSession,
  stopDevSession,
  pollDevRequest,
  submitDevResult,
  resetDevDatabase,
  impersonate,
  refreshContext,
  fetchCallbackToken,
  ApiError,
  DevPollError,
} from './api';
import { devRequestEvents } from './events';
import { Transpiler } from './transpiler';
import { executeMethod, cleanupWorker } from './executor';
import { getApiBaseUrl } from '../config';
import { requestDeviceAuth, pollDeviceAuth } from '../api';
import { setApiKey, setUserId } from '../config';
import { log } from './logger';
import type { DevProxy } from './proxy';
import type { DevSession, DevRequest, DevResult, AppScenario } from './types';

export class DevRunner {
  private isRunning = false;
  private session: DevSession | null = null;
  private transpiler: Transpiler | null = null;
  private backoffMs = 1000;
  private hadConnectionWarning = false;
  private proxyUrl: string | undefined;
  private proxy: DevProxy | null = null;

  constructor(
    private readonly appId: string,
    private readonly projectRoot: string,
    private readonly startOpts: {
      branch?: string;
      proxyUrl?: string;
      methods?: Array<{ id: string; export: string; path: string }>;
    } = {},
  ) {}

  // proxyUrl is sent on every poll request so the platform dashboard can
  // show the developer's preview URL. Also included in the start request
  // so the dashboard sees it immediately without waiting for the first poll.
  setProxyUrl(url: string): void {
    this.proxyUrl = url;
    this.startOpts.proxyUrl = url;
  }

  setProxy(proxy: DevProxy): void {
    this.proxy = proxy;
  }

  async start(): Promise<DevSession> {
    if (this.isRunning) {
      throw new Error('DevRunner is already running');
    }

    log.info('runner Starting session', { appId: this.appId, branch: this.startOpts.branch });
    const session = await startDevSession(this.appId, this.startOpts);
    this.session = session;
    this.transpiler = new Transpiler(this.projectRoot);
    this.isRunning = true;
    this.backoffMs = 1000;

    log.info('runner Session started', { sessionId: session.sessionId, branch: session.branch });

    // Start poll loop in background
    this.pollLoop();

    return session;
  }

  async stop(): Promise<void> {
    log.info('runner Stopping session');
    this.isRunning = false;

    if (this.session) {
      try {
        await stopDevSession(this.appId, this.session.sessionId);
      } catch (err) {
        log.warn('runner Failed to stop session cleanly', { error: err instanceof Error ? err.message : String(err) });
      }
      this.session = null;
    }

    await cleanupWorker();

    if (this.transpiler) {
      await this.transpiler.cleanup();
      this.transpiler = null;
    }
  }

  getSession(): DevSession | null {
    return this.session;
  }

  // Set role override for subsequent method executions.
  async setImpersonation(roles: string[]): Promise<void> {
    if (!this.session) return;
    log.info('runner Impersonating', { roles });
    const result = await impersonate(this.appId, this.session.sessionId, roles);
    await this.refreshClientContext();
    devRequestEvents.emitImpersonate({ roles: result.roles });
  }

  // Clear role override — revert to session's default roles.
  async clearImpersonation(): Promise<void> {
    if (!this.session) return;
    log.info('runner Clearing impersonation');
    const result = await impersonate(this.appId, this.session.sessionId, null);
    await this.refreshClientContext();
    devRequestEvents.emitImpersonate({ roles: result.roles });
  }

  // Fetch fresh clientContext from platform and update the proxy.
  // Called after impersonation changes so the browser gets a new ms_iface token.
  private async refreshClientContext(): Promise<void> {
    if (!this.session || !this.proxy) return;
    try {
      const context = await refreshContext(this.appId, this.session.sessionId);
      this.session.clientContext = context;
      this.proxy.updateClientContext(context);
    } catch (err) {
      log.warn('runner Failed to refresh client context', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Run a scenario: truncate tables → execute seed → impersonate roles.
  // Called directly (not via poll loop) by the TUI or headless stdin.
  async runScenario(scenario: AppScenario): Promise<{
    success: boolean;
    databases: DevSession['databases'];
    error?: string;
  }> {
    if (!this.session || !this.transpiler) {
      return { success: false, databases: [], error: 'Session not started' };
    }

    const startTime = Date.now();
    const scenarioName = scenario.name ?? scenario.export;
    devRequestEvents.emitScenarioStart({
      id: scenario.id,
      name: scenarioName,
      timestamp: startTime,
    });

    log.info('runner Running scenario', { id: scenario.id, name: scenarioName });

    try {
      // 1. Truncate all tables (clean slate)
      log.debug('runner Truncating database for scenario');
      const databases = await resetDevDatabase(this.appId, this.session.sessionId, 'truncate');
      this.session.databases = databases;

      // 2. Transpile and execute the seed function
      log.debug('runner Transpiling scenario', { path: scenario.path });
      const transpiledPath = await this.transpiler.transpile(scenario.path);

      // Fetch a callback token for the seed execution — same scoping as
      // poll-based tokens, but not tied to a poll request.
      log.debug('runner Fetching callback token for scenario');
      const authorizationToken = await fetchCallbackToken(this.appId, this.session.sessionId);

      log.debug('runner Executing scenario seed', { export: scenario.export });
      const result = await executeMethod({
        transpiledPath,
        methodExport: scenario.export,
        input: {},
        auth: this.session.auth,
        databases: this.session.databases,
        authorizationToken,
        apiBaseUrl: getApiBaseUrl(),
        projectRoot: this.projectRoot,
      });

      if (!result.success) {
        const error = result.error?.message ?? 'Scenario seed failed';
        log.error('runner Scenario seed failed', { id: scenario.id, error });
        devRequestEvents.emitScenarioComplete({
          id: scenario.id,
          success: false,
          duration: Date.now() - startTime,
          roles: scenario.roles,
          error,
        });
        return { success: false, databases, error };
      }

      // 3. Impersonate the scenario's roles
      if (scenario.roles.length > 0) {
        log.debug('runner Impersonating for scenario', { roles: scenario.roles });
        await impersonate(this.appId, this.session.sessionId, scenario.roles);
        await this.refreshClientContext();
      }

      const duration = Date.now() - startTime;
      log.info('runner Scenario complete', { id: scenario.id, duration, roles: scenario.roles });
      devRequestEvents.emitScenarioComplete({
        id: scenario.id,
        success: true,
        duration,
        roles: scenario.roles,
      });

      return { success: true, databases };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      log.error('runner Scenario failed', { id: scenario.id, error });
      devRequestEvents.emitScenarioComplete({
        id: scenario.id,
        success: false,
        duration: Date.now() - startTime,
        roles: scenario.roles,
        error,
      });
      return { success: false, databases: this.session.databases, error };
    }
  }

  private async pollLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        const request = await pollDevRequest(
          this.appId,
          this.session!.sessionId,
          this.proxyUrl,
        );

        if (this.hadConnectionWarning) {
          this.hadConnectionWarning = false;
          log.info('runner Connection restored');
          devRequestEvents.emitConnectionRestored();
        }

        if (request) {
          // Process in background — don't block the poll loop
          this.handleRequest(request);
        }

        this.backoffMs = 1000;
      } catch (error) {
        // Session expired
        if (error instanceof DevPollError && error.statusCode === 404) {
          log.error('runner Session expired (404)');
          devRequestEvents.emitSessionExpired();
          this.isRunning = false;
          return;
        }

        // Auth token expired — attempt automatic refresh
        if (
          (error instanceof DevPollError || error instanceof ApiError) &&
          error.statusCode === 401
        ) {
          log.warn('runner Auth token expired (401), attempting refresh');
          const refreshed = await this.refreshAuth();
          if (refreshed) {
            // Token refreshed — reset backoff and continue polling
            this.backoffMs = 1000;
            continue;
          }
          // Refresh failed — treat as session expired
          log.error('runner Auth refresh failed, stopping');
          devRequestEvents.emitSessionExpired();
          this.isRunning = false;
          return;
        }

        // Connection issue — backoff and retry
        if (!this.hadConnectionWarning) {
          this.hadConnectionWarning = true;
          log.warn('runner Connection lost, retrying...');
          devRequestEvents.emitConnectionWarning(
            'Lost connection to platform, retrying...',
          );
        }

        log.debug('runner Backing off', { ms: this.backoffMs });
        await this.sleep(this.backoffMs);
        this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
      }
    }
  }

  private async handleRequest(request: DevRequest): Promise<void> {
    const startTime = Date.now();

    devRequestEvents.emitStart({
      id: request.requestId,
      type: request.type,
      method: request.methodExport,
      timestamp: startTime,
    });

    log.info('runner Request received', { requestId: request.requestId, method: request.methodExport });

    try {
      // Transpile
      log.debug('runner Transpiling', { path: request.methodPath });
      const transpiledPath = await this.transpiler!.transpile(request.methodPath);

      // Role override lets the platform test methods as different users/roles
      // without restarting the session. If present, we build a custom auth
      // context with the overridden roles; otherwise use the session default.
      const auth = request.roleOverride
        ? {
            userId: this.session!.auth.userId,
            roleAssignments: request.roleOverride.map((roleName) => ({
              userId: this.session!.auth.userId,
              roleName,
            })),
          }
        : this.session!.auth;

      // Execute in isolated child process
      const result = await executeMethod({
        transpiledPath,
        methodExport: request.methodExport,
        input: request.input,
        auth,
        databases: this.session!.databases,
        authorizationToken: request.authorizationToken,
        apiBaseUrl: getApiBaseUrl(),
        projectRoot: this.projectRoot,
        streamId: request.streamId,
      });

      const devResult: DevResult = {
        type: 'execute',
        success: result.success,
        output: result.output,
        error: result.error,
        stdout: result.stdout,
        stats: result.stats,
      };

      await submitDevResult(
        this.appId,
        this.session!.sessionId,
        request.requestId,
        devResult,
      );

      const duration = Date.now() - startTime;
      log.info('runner Request complete', { requestId: request.requestId, success: result.success, duration });

      devRequestEvents.emitComplete({
        id: request.requestId,
        success: result.success,
        duration,
        error: result.error ? formatErrorForDisplay(result.error) : undefined,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      const duration = Date.now() - startTime;
      log.error('runner Request failed', { requestId: request.requestId, duration, error: message });

      try {
        await submitDevResult(
          this.appId,
          this.session!.sessionId,
          request.requestId,
          {
            type: 'execute',
            success: false,
            error: { message },
          },
        );
      } catch (submitErr) {
        log.error('runner Failed to submit error result', { error: submitErr instanceof Error ? submitErr.message : String(submitErr) });
      }

      devRequestEvents.emitComplete({
        id: request.requestId,
        success: false,
        duration: Date.now() - startTime,
        error: message,
      });
    }
  }

  /**
   * Attempt to refresh expired auth credentials via the device auth flow.
   * Opens the browser for the user to re-authorize, polls for the new token.
   * Returns true if refresh succeeded.
   */
  private async refreshAuth(): Promise<boolean> {
    const POLL_INTERVAL = 2000;
    const MAX_ATTEMPTS = 30;

    try {
      log.info('runner Auth expired, requesting re-authentication');
      const { url, token } = await requestDeviceAuth();

      devRequestEvents.emitAuthRefreshStart(url);

      // Try to open the browser — not fatal if it fails (headless, SSH, etc.)
      try {
        const open = (await import('open')).default;
        await open(url);
      } catch {
        log.warn('runner Could not open browser for auth — user must visit URL manually');
      }

      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        await this.sleep(POLL_INTERVAL);
        if (!this.isRunning) return false;

        const result = await pollDeviceAuth(token);

        if (result.status === 'completed' && result.apiKey) {
          setApiKey(result.apiKey);
          if (result.userId) {
            setUserId(result.userId);
          }
          log.info('runner Auth refreshed successfully');
          devRequestEvents.emitAuthRefreshSuccess();
          return true;
        }

        if (result.status === 'expired') {
          break;
        }
      }

      log.error('runner Auth refresh timed out or was denied');
      devRequestEvents.emitAuthRefreshFailed();
      return false;
    } catch (err) {
      log.error('runner Auth refresh failed', { error: err instanceof Error ? err.message : String(err) });
      devRequestEvents.emitAuthRefreshFailed();
      return false;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Format an error object from the executor into a readable string for the TUI.
 * Includes extra fields like code, statusCode, cause, etc. when present.
 */
function formatErrorForDisplay(error: Record<string, unknown>): string {
  const parts: string[] = [];

  // Main message
  if (error.message) {
    parts.push(String(error.message));
  }

  // Status/code info
  const code = error.code ?? error.statusCode ?? error.status;
  if (code !== undefined) {
    parts.push(`(code: ${code})`);
  }

  // Response body from HTTP errors
  if (error.body) {
    parts.push(`Response: ${String(error.body).slice(0, 200)}`);
  } else if (error.response) {
    parts.push(`Response: ${String(error.response).slice(0, 200)}`);
  }

  // Cause chain
  if (error.cause && typeof error.cause === 'object') {
    const cause = error.cause as Record<string, unknown>;
    if (cause.message) {
      parts.push(`Caused by: ${cause.message}`);
    }
  }

  return parts.join('\n');
}
