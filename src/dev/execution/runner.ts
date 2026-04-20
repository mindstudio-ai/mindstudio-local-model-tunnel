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
  createAuthSession,
  ApiError,
  DevPollError,
} from '../api';
import { devRequestEvents } from '../ipc/events';
import { Transpiler } from './transpiler';
import { executeMethod, cleanupWorker } from './executor';
import { getApiBaseUrl } from '../../config';
import { requestDeviceAuth, pollDeviceAuth } from '../../api';
import { setApiKey, setUserId } from '../../config';
import { randomBytes } from 'node:crypto';
import { log } from '../logging/logger';
import { logMethodExecution, logScenarioExecution } from '../logging/request-log';
import { formatErrorForDisplay } from './format-error';
import { readConfig } from '../interfaces/read-config';
import type { DevProxy } from '../proxy/proxy';
import type { DevSession, DevRequest, DevResult, AppScenario, AppConfig } from '../config/types';

// Reserved sentinel on run-method's userId: resolves to the dev-bypass user
// (find-or-create via platform), so agents can invoke auth-gated methods
// without round-tripping a scenario-seeded ID. The platform bypasses OTP
// verification for either identifier.
const TEST_USER_SENTINEL = 'testUser';
const TEST_USER_EMAIL = 'remy@mindstudio.ai';
const TEST_USER_PHONE = '+15555555555';

export class DevRunner {
  private isRunning = false;
  private session: DevSession | null = null;
  private transpiler: Transpiler | null = null;
  private backoffMs = 1000;
  private hadConnectionWarning = false;
  private proxyUrl: string | undefined;
  private proxy: DevProxy | null = null;
  private appConfig: AppConfig | null = null;
  private roleOverride: string[] | null = null;
  private testUserId: string | null = null;

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

  setAppConfig(appConfig: AppConfig): void {
    this.appConfig = appConfig;
  }

  async start(): Promise<DevSession> {
    if (this.isRunning) {
      throw new Error('DevRunner is already running');
    }

    log.info('runner', 'Dev session starting', { appId: this.appId, branch: this.startOpts.branch });
    const session = await startDevSession(this.appId, this.startOpts);

    // Default auth is anonymous — matches production behavior for
    // unauthenticated requests. The platform user's identity should never
    // leak into the app's auth context. Users get a real identity by
    // logging in through the app's auth flow, impersonating, or passing
    // roles/userId on the runMethod command.
    session.auth = { userId: null, roleAssignments: [] };

    this.session = session;
    this.transpiler = new Transpiler(this.projectRoot);
    this.isRunning = true;
    this.backoffMs = 1000;

    log.info('runner', 'Dev session started', { sessionId: session.sessionId, branch: session.branch });

    return session;
  }

  // Begin polling for platform method requests. Call this after all
  // post-start setup (schema sync, proxy init) is complete so methods
  // don't execute against stale session state.
  startPolling(): void {
    this.pollLoop();
  }

  async stop(): Promise<void> {
    log.info('runner', 'Dev session stopping');
    this.isRunning = false;

    if (this.session) {
      try {
        await stopDevSession(this.appId, this.session.sessionId);
      } catch (err) {
        log.warn('runner', 'Failed to stop dev session cleanly', { error: err instanceof Error ? err.message : String(err) });
      }
      this.session = null;
    }

    this.roleOverride = null;
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
    log.info('runner', 'Setting role override', { roles });
    await impersonate(this.appId, this.session.sessionId, roles);
    this.roleOverride = roles;
    await this.refreshClientContext();
  }

  // Clear role override — revert to session's default roles.
  async clearImpersonation(): Promise<void> {
    if (!this.session) return;
    log.info('runner', 'Clearing role override');
    await impersonate(this.appId, this.session.sessionId, null);
    this.roleOverride = null;
    await this.refreshClientContext();
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
      log.warn('runner', 'Failed to refresh session context after role change', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Run a method directly (not via poll loop). Used by headless stdin commands
  // and programmatic callers to test methods without a browser.
  async runMethod(opts: {
    methodExport: string;
    methodPath: string;
    input: unknown;
    roles?: string[];
    userId?: string;
  }): Promise<{ success: boolean; output?: unknown; error?: Record<string, unknown> | null; stdout?: string[]; duration: number }> {
    if (!this.session || !this.transpiler) {
      return { success: false, error: { message: 'Session not started' }, duration: 0 };
    }

    const requestId = randomBytes(8).toString('hex');
    const startTime = Date.now();

    log.info('runner', 'Method received', { requestId, method: opts.methodExport, source: 'direct', sessionId: this.session.sessionId });

    try {
      const authorizationToken = await fetchCallbackToken(this.appId, this.session.sessionId);
      const transpiledPath = await this.transpiler.transpile(opts.methodPath);

      // Per-request overrides > session impersonation > session default.
      // "testUser" is a reserved sentinel — resolves to the dev-bypass user.
      const userId =
        opts.userId === TEST_USER_SENTINEL
          ? await this.resolveTestUserId()
          : (opts.userId ?? this.session.auth.userId);
      const roles = opts.roles ?? this.roleOverride;
      const auth = roles
        ? {
            userId,
            roleAssignments: roles.map((roleName) => ({ userId, roleName })),
          }
        : { ...this.session.auth, userId };

      const result = await executeMethod({
        requestId,
        transpiledPath,
        methodExport: opts.methodExport,
        input: opts.input,
        auth,
        databases: this.session.databases,
        authorizationToken,
        apiBaseUrl: getApiBaseUrl(),
        projectRoot: this.projectRoot,
        sessionId: this.session.sessionId,
      });

      const duration = Date.now() - startTime;

      if (result.success) {
        log.info('runner', 'Method complete', { requestId, method: opts.methodExport, duration, sessionId: this.session.sessionId });
      } else {
        log.warn('runner', 'Method failed', {
          requestId,
          method: opts.methodExport,
          duration,
          error: result.error ? formatErrorForDisplay(result.error) : undefined,
          sessionId: this.session.sessionId,
        });
      }

      logMethodExecution({
        requestId,
        sessionId: this.session.sessionId,
        methodExport: opts.methodExport,
        methodPath: opts.methodPath,
        input: opts.input,
        authorizationToken,
        context: { auth, databases: this.session.databases },
        databases: this.session.databases,
        result,
        duration,
      });

      return {
        success: result.success,
        output: result.output,
        error: result.error ?? null,
        stdout: result.stdout,
        duration,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      const duration = Date.now() - startTime;
      log.error('runner', 'Method execution error', { requestId, method: opts.methodExport, duration, error: message, sessionId: this.session.sessionId });

      logMethodExecution({
        requestId,
        sessionId: this.session.sessionId,
        methodExport: opts.methodExport,
        methodPath: opts.methodPath,
        input: opts.input,
        authorizationToken: '',
        databases: this.session.databases,
        result: { success: false, error: { message } },
        duration,
      });

      return { success: false, error: { message }, duration };
    }
  }

  // Run a scenario: truncate tables → execute seed → impersonate roles.
  // Called directly (not via poll loop) by the TUI or headless stdin.
  async runScenario(scenario: AppScenario, opts?: { skipTruncate?: boolean }): Promise<{
    success: boolean;
    databases: DevSession['databases'];
    error?: string;
  }> {
    if (!this.session || !this.transpiler) {
      return { success: false, databases: [], error: 'Session not started' };
    }

    const requestId = randomBytes(8).toString('hex');
    const startTime = Date.now();
    const scenarioName = scenario.name ?? scenario.export;

    log.info('runner', 'Scenario starting', { requestId, id: scenario.id, name: scenarioName });

    try {
      // 1. Truncate all tables (clean slate) unless caller opts out
      if (!opts?.skipTruncate) {
        log.debug('runner', 'Resetting database for scenario');
        const databases = await resetDevDatabase(this.appId, this.session.sessionId, 'truncate');
        this.session.databases = databases;
      }

      // 2. Transpile and execute the seed function
      log.debug('runner', 'Transpiling scenario', { path: scenario.path });
      const transpiledPath = await this.transpiler.transpile(scenario.path);

      // Fetch a callback token for the seed execution — same scoping as
      // poll-based tokens, but not tied to a poll request.
      const authorizationToken = await fetchCallbackToken(this.appId, this.session.sessionId);

      log.debug('runner', 'Running scenario seed function', { export: scenario.export });
      const result = await executeMethod({
        requestId,
        transpiledPath,
        methodExport: scenario.export,
        input: {},
        auth: this.session.auth,
        databases: this.session.databases,
        authorizationToken,
        apiBaseUrl: getApiBaseUrl(),
        projectRoot: this.projectRoot,
        sessionId: this.session.sessionId,
      });

      if (!result.success) {
        const error = result.error?.message ?? 'Scenario seed failed';
        log.error('runner', 'Scenario seed function failed', { id: scenario.id, name: scenarioName, duration: Date.now() - startTime, error });
        logScenarioExecution({
          sessionId: this.session.sessionId,
          scenario,
          databases: this.session.databases,
          result,
          duration: Date.now() - startTime,
        });
        return { success: false, databases: this.session.databases, error };
      }

      // 3. Impersonate the scenario's roles
      if (scenario.roles.length > 0) {
        log.debug('runner', 'Setting role override for scenario', { roles: scenario.roles });
        await impersonate(this.appId, this.session.sessionId, scenario.roles);
        await this.refreshClientContext();
      }

      const duration = Date.now() - startTime;
      log.info('runner', 'Scenario complete', { id: scenario.id, name: scenarioName, duration, roles: scenario.roles });
      logScenarioExecution({
        sessionId: this.session.sessionId,
        scenario,
        databases: this.session.databases,
        result,
        duration,
      });
      return { success: true, databases: this.session.databases };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      log.error('runner', 'Scenario failed', { id: scenario.id, name: scenarioName, duration: Date.now() - startTime, error });
      logScenarioExecution({
        sessionId: this.session.sessionId,
        scenario,
        databases: this.session.databases,
        result: null,
        infrastructureError: error,
        duration: Date.now() - startTime,
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
          log.info('runner', 'Connection to platform restored');
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
          log.error('runner', 'Dev session expired', { statusCode: 404 });
          devRequestEvents.emitSessionExpired();
          this.isRunning = false;
          return;
        }

        // Auth token expired — attempt automatic refresh
        if (
          (error instanceof DevPollError || error instanceof ApiError) &&
          error.statusCode === 401
        ) {
          const refreshed = await this.refreshAuth();
          if (refreshed) {
            // Token refreshed — reset backoff and continue polling
            this.backoffMs = 1000;
            continue;
          }
          // Refresh failed — treat as session expired
          log.error('runner', 'Re-authentication failed');
          devRequestEvents.emitSessionExpired();
          this.isRunning = false;
          return;
        }

        // Connection issue — backoff and retry
        if (!this.hadConnectionWarning) {
          this.hadConnectionWarning = true;
          log.warn('runner', 'Lost connection to platform, retrying');
          devRequestEvents.emitConnectionWarning(
            'Lost connection to platform, retrying...',
          );
        }

        await this.sleep(this.backoffMs);
        this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
      }
    }
  }

  private async handleRequest(request: DevRequest): Promise<void> {
    if (request.type === 'get-config') {
      await this.handleGetConfig(request);
      return;
    }

    const startTime = Date.now();

    // Resolve method from app config by ID — the API only sends methodId,
    // we look up the export name and file path from mindstudio.json.
    const method = this.appConfig?.methods.find((m) => m.id === request.methodId);
    if (!method) {
      const message = `Unknown method ID: ${request.methodId}`;
      log.error('runner', message, { requestId: request.requestId, sessionId: this.session!.sessionId });
      try {
        await submitDevResult(this.appId, this.session!.sessionId, request.requestId, {
          type: 'execute',
          success: false,
          error: { message },
        });
      } catch {}
      devRequestEvents.emitComplete({ id: request.requestId, success: false, duration: 0, error: message });
      return;
    }

    devRequestEvents.emitStart({
      id: request.requestId,
      type: request.type,
      method: method.export,
      timestamp: startTime,
    });

    log.info('runner', 'Method received', { requestId: request.requestId, method: method.export, source: 'poll', sessionId: this.session!.sessionId });

    try {
      const t0 = Date.now();
      const transpiledPath = await this.transpiler!.transpile(method.path);
      const t1 = Date.now();

      // userId from the resolved ms_iface_ token — fresh on every request,
      // changes as users log in/out. Never fall back to the stale session value.
      const userId = request.userId ?? null;

      // Role override (impersonation) > actual role assignments from DB
      const overrideRoles = request.roleOverride ?? this.roleOverride;
      const auth = {
        userId,
        roleAssignments: overrideRoles
          ? overrideRoles.map((roleName) => ({ userId, roleName }))
          : request.roleAssignments ?? [],
      };

      // Execute in isolated child process
      const result = await executeMethod({
        requestId: request.requestId,
        transpiledPath,
        methodExport: method.export,
        input: request.input,
        auth,
        databases: this.session!.databases,
        authorizationToken: request.authorizationToken,
        apiBaseUrl: getApiBaseUrl(),
        projectRoot: this.projectRoot,
        sessionId: this.session!.sessionId,
        streamId: request.streamId,
        secrets: request.secrets,
      });
      const t2 = Date.now();

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
      const t3 = Date.now();

      const duration = Date.now() - startTime;
      const timing = {
        transpileMs: t1 - t0,
        executeMs: t2 - t1,
        submitMs: t3 - t2,
        totalMs: duration,
      };
      if (result.success) {
        log.info('runner', 'Method complete', { requestId: request.requestId, method: method.export, timing, sessionId: this.session!.sessionId });
      } else {
        log.warn('runner', 'Method failed', {
          requestId: request.requestId,
          method: method.export,
          timing,
          error: result.error ? formatErrorForDisplay(result.error) : undefined,
          sessionId: this.session!.sessionId,
        });
      }

      logMethodExecution({
        requestId: request.requestId,
        sessionId: this.session!.sessionId,
        methodExport: method.export,
        methodPath: method.path,
        input: request.input,
        roleOverride: request.roleOverride,
        authorizationToken: request.authorizationToken,
        context: { auth, databases: this.session!.databases },
        databases: this.session!.databases,
        result,
        duration,
        timing,
      });

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
      log.error('runner', 'Method execution error', { requestId: request.requestId, method: method.export, duration, error: message, sessionId: this.session!.sessionId });

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
        log.error('runner', 'Failed to report method error to platform', { error: submitErr instanceof Error ? submitErr.message : String(submitErr) });
      }

      logMethodExecution({
        requestId: request.requestId,
        sessionId: this.session!.sessionId,
        methodExport: method.export,
        methodPath: method.path,
        input: request.input,
        roleOverride: request.roleOverride,
        authorizationToken: request.authorizationToken,
        databases: this.session!.databases,
        result: { success: false, error: { message } },
        duration: Date.now() - startTime,
      });

      devRequestEvents.emitComplete({
        id: request.requestId,
        success: false,
        duration: Date.now() - startTime,
        error: message,
      });
    }
  }

  private async handleGetConfig(request: DevRequest): Promise<void> {
    log.info('runner', 'Config requested', { requestId: request.requestId, sessionId: this.session!.sessionId });

    try {
      if (!this.appConfig) {
        throw new Error('App config not available');
      }

      const config = readConfig(this.projectRoot, this.appConfig);

      await submitDevResult(
        this.appId,
        this.session!.sessionId,
        request.requestId,
        {
          type: 'get-config',
          success: true,
          output: config,
        },
      );

      log.info('runner', 'Config sent', { requestId: request.requestId });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      log.error('runner', 'Config failed', { requestId: request.requestId, error: message });

      try {
        await submitDevResult(
          this.appId,
          this.session!.sessionId,
          request.requestId,
          {
            type: 'get-config',
            success: false,
            error: { message },
          },
        );
      } catch (submitErr) {
        log.error('runner', 'Failed to report config error to platform', { error: submitErr instanceof Error ? submitErr.message : String(submitErr) });
      }
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
      log.info('runner', 'Session token expired, requesting re-authentication');
      const { url, token } = await requestDeviceAuth();

      devRequestEvents.emitAuthRefreshStart(url);

      // Try to open the browser — not fatal if it fails (headless, SSH, etc.)
      try {
        const open = (await import('open')).default;
        await open(url);
      } catch {
        log.warn('runner', 'Could not open browser — visit URL to re-authenticate');
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
          log.info('runner', 'Re-authentication successful');
          devRequestEvents.emitAuthRefreshSuccess();
          return true;
        }

        if (result.status === 'expired') {
          break;
        }
      }

      log.error('runner', 'Re-authentication timed out or was denied');
      devRequestEvents.emitAuthRefreshFailed();
      return false;
    } catch (err) {
      log.error('runner', 'Re-authentication failed', { error: err instanceof Error ? err.message : String(err) });
      devRequestEvents.emitAuthRefreshFailed();
      return false;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async resolveTestUserId(): Promise<string> {
    if (this.testUserId) return this.testUserId;
    const auth = this.appConfig?.auth;
    if (!auth?.enabled) {
      throw new Error(
        `Cannot resolve userId="${TEST_USER_SENTINEL}": auth is not enabled in mindstudio.json. ` +
          `Add an "auth" block with enabled: true and a users table.`,
      );
    }
    // Prefer email when both are configured — it's the more common dev setup.
    const methods = auth.methods ?? [];
    const hasEmail = methods.some((m) => m.includes('email'));
    const hasPhone = methods.some((m) => m.includes('phone'));
    let opts: { email?: string; phone?: string };
    if (hasEmail) {
      opts = { email: TEST_USER_EMAIL };
    } else if (hasPhone) {
      opts = { phone: TEST_USER_PHONE };
    } else {
      throw new Error(
        `Cannot resolve userId="${TEST_USER_SENTINEL}": auth.methods in mindstudio.json ` +
          `does not include an email- or phone-based method (got ${JSON.stringify(methods)}).`,
      );
    }
    const { user } = await createAuthSession(this.appId, opts);
    const id = (user as { id?: unknown }).id;
    if (typeof id !== 'string') {
      throw new Error(
        `createAuthSession did not return a string user.id for the test user`,
      );
    }
    this.testUserId = id;
    return id;
  }
}

