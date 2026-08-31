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
  fetchCallbackToken,
  createAuthSession,
  ApiError,
  DevPollError,
  type SessionMethodPayload,
} from '../api';
import { devRequestEvents } from '../ipc/events';
import { Transpiler } from './transpiler';
import { executeMethod, cleanupWorker } from './executor';
import { getApiBaseUrl, getDbWsUrl } from '../../config';
import { requestDeviceAuth, pollDeviceAuth } from '../../api';
import { setApiKey, setUserId } from '../../config';
import { randomBytes } from 'node:crypto';
import { runJewelTest, JewelTestResult, jewelUserIdForApp } from './jewel';
import { log } from '../logging/logger';
import { logMethodExecution, logScenarioExecution } from '../logging/request-log';
import { formatErrorForDisplay } from './format-error';
import { readConfig } from '../interfaces/read-config';
import type { DevProxy } from '../proxy/proxy';
import type { DevSession, DevRequest, DevResult, AppScenario, AppConfig, AppMethod } from '../config/types';

// Reserved sentinel on run-method's userId: resolves to the dev-bypass user
// (find-or-create via platform), so agents can invoke auth-gated methods
// without round-tripping a scenario-seeded ID. The platform bypasses OTP
// verification for either identifier.
const TEST_USER_SENTINEL = 'testUser';
const TEST_USER_EMAIL = 'remy@mindstudio.ai';
const TEST_USER_PHONE = '+15555555555';

// The synthetic identity a platform-triggered invocation runs as (cron,
// webhook, email). Keep in sync with SYSTEM_USER_ID in youai-api
// (src/common/Db/v2Apps/_helpers/constants.ts) — same mirroring pattern as
// JEWEL_USER_NAMESPACE in ./jewel.ts.
//
// Deliberately independent of the app's auth table. A system-gated method is
// normal in an app with no users at all, so dev has to be able to produce this
// identity without one; the poll path gets it from the platform, and this is
// how the direct path gets it.
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';
const SYSTEM_ROLE = 'system';

export class DevRunner {
  private isRunning = false;
  private session: DevSession | null = null;
  private transpiler: Transpiler | null = null;
  private backoffMs = 1000;
  private hadConnectionWarning = false;
  private proxyUrl: string | undefined;
  private proxy: DevProxy | null = null;
  private appConfig: AppConfig | null = null;
  private testUserId: string | null = null;

  constructor(
    private readonly appId: string,
    private readonly projectRoot: string,
    private readonly startOpts: {
      branch?: string;
      proxyUrl?: string;
      methods?: SessionMethodPayload[];
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
    // logging in through the app's auth flow, or by passing roles/userId
    // on the runMethod command.
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

    await cleanupWorker();

    if (this.transpiler) {
      await this.transpiler.cleanup();
      this.transpiler = null;
    }
  }

  getSession(): DevSession | null {
    return this.session;
  }

  // Set the dev test user's roles — a real write to the user's row (the
  // platform upserts the user, updates role assignments, and syncs the app's
  // users table). "Role switching" in dev is just this: the developer signs in
  // as the test user through the app's own auth flow and sees the app from
  // whatever roles the row currently holds.
  async setTestUserRoles(roles: string[]): Promise<Record<string, unknown>> {
    log.info('runner', 'Setting test user roles', { roles });
    const { user } = await createAuthSession(this.appId, {
      ...this.testUserIdentityOpts(),
      roles,
    });
    this.testUserId = typeof user.id === 'string' ? user.id : this.testUserId;
    return user;
  }

  // Find-or-create the dev test user and return it (including current roles).
  async getTestUser(): Promise<Record<string, unknown>> {
    const { user } = await createAuthSession(
      this.appId,
      this.testUserIdentityOpts(),
    );
    this.testUserId = typeof user.id === 'string' ? user.id : this.testUserId;
    return user;
  }

  // Run a method directly (not via poll loop). Used by headless stdin commands
  // and programmatic callers to test methods without a browser.
  async runMethod(opts: {
    methodExport: string;
    methodPath: string;
    input: unknown;
    roles?: string[];
    userId?: string;
    /** Freshly-read manifest, when the caller has one. The auth branch below
     *  keys on `auth.enabled`, and the watcher-held copy can lag a manifest
     *  write by a debounce — the same window run-method's retry-aware read
     *  already closes for method lookup. */
    appConfig?: AppConfig | null;
  }): Promise<{ success: boolean; output?: unknown; error?: Record<string, unknown> | null; stdout?: string[]; duration: number }> {
    if (!this.session || !this.transpiler) {
      return { success: false, error: { message: 'Session not started' }, duration: 0 };
    }

    const requestId = randomBytes(8).toString('hex');
    const startTime = Date.now();

    log.info('runner', 'Method received', { requestId, method: opts.methodExport, source: 'direct', sessionId: this.session.sessionId });

    try {
      const { authorizationToken, secrets } = await fetchCallbackToken(this.appId, this.session.sessionId);
      const transpiledPath = await this.transpiler.transpile(opts.methodPath);

      const auth = await this.resolveRunAsAuth(opts);

      const result = await executeMethod({
        requestId,
        transpiledPath,
        methodExport: opts.methodExport,
        input: opts.input,
        auth,
        databases: this.session.databases,
        authorizationToken,
        apiBaseUrl: getApiBaseUrl(),
        dbWsUrl: getDbWsUrl(),
        projectRoot: this.projectRoot,
        sessionId: this.session.sessionId,
        secrets,
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

  // Run a method's jewel directly against a test input and return the pair
  // record. Called via the test-jewel stdin command — the jewel authoring
  // loop. Never executes the method itself and never writes to the platform
  // pair ledger; the record comes back inline (and lands in requests.ndjson).
  async testJewel(opts: {
    method: AppMethod;
    humanInput?: unknown;
    subject?: unknown;
  }): Promise<JewelTestResult | { success: false; error: string }> {
    if (!this.session || !this.transpiler) {
      return { success: false, error: 'Session not started' };
    }

    return runJewelTest({
      appId: this.appId,
      sessionId: this.session.sessionId,
      databases: this.session.databases,
      transpiler: this.transpiler,
      projectRoot: this.projectRoot,
      method: opts.method,
      humanInput: opts.humanInput,
      subject: opts.subject,
    });
  }

  // Run a scenario: truncate tables → execute seed → assign the scenario's
  // roles to the dev test user. Called directly (not via poll loop) by the
  // TUI or headless stdin.
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
        // Truncation deleted the synced users-table row behind the cached
        // test user id — drop the cache so the next use re-upserts it.
        this.testUserId = null;
      }

      // 2. Transpile and execute the seed function
      log.debug('runner', 'Transpiling scenario', { path: scenario.path });
      const transpiledPath = await this.transpiler.transpile(scenario.path);

      // Fetch a callback token + dev secrets for the seed execution —
      // same scoping as poll-based tokens, but not tied to a poll request.
      const { authorizationToken, secrets } = await fetchCallbackToken(this.appId, this.session.sessionId);

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
        dbWsUrl: getDbWsUrl(),
        projectRoot: this.projectRoot,
        sessionId: this.session.sessionId,
        secrets,
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

      // 3. Assign the scenario's roles to the dev test user — a real write to
      // the user's row, so signing in as the test account shows the app from
      // this scenario's perspective. Requires app auth; without it there are
      // no users to hold roles.
      if (scenario.roles.length > 0) {
        if (this.appConfig?.auth?.enabled) {
          log.debug('runner', 'Assigning scenario roles to test user', { roles: scenario.roles });
          await this.setTestUserRoles(scenario.roles);
        } else {
          log.warn('runner', 'Scenario declares roles but auth is not enabled — skipping role assignment', { roles: scenario.roles });
        }
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
        // The session can be nulled mid-loop when a mindstudio.json change
        // restarts the session (stop() clears it). Snapshot it and exit if gone.
        const session = this.session;
        if (!session) break;
        const request = await pollDevRequest(
          this.appId,
          session.sessionId,
          this.proxyUrl,
        );

        if (this.hadConnectionWarning) {
          this.hadConnectionWarning = false;
          log.info('runner', 'Connection to platform restored');
          devRequestEvents.emitConnectionRestored();
        }

        if (request && this.isRunning) {
          // Process in background — don't block the poll loop. Fire-and-forget,
          // so guard against an unhandled rejection here taking down the whole
          // process (e.g. the session gets torn down while this is in flight).
          this.handleRequest(request).catch((err) =>
            log.error('runner', 'Unhandled request error', {
              requestId: request.requestId,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
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
    // A polled request can still be in flight when the session is torn down (a
    // mindstudio.json change restarts the session, and stop() nulls
    // this.session). This runs un-awaited from pollLoop, so dereferencing a null
    // session here would surface as an unhandled rejection and crash the
    // process. Snapshot the session and bail if it's gone.
    const session = this.session;
    if (!session) return;

    if (request.type === 'get-config') {
      await this.handleGetConfig(request);
      return;
    }

    const transpiler = this.transpiler;
    if (!transpiler) return;

    const startTime = Date.now();

    // Resolve method from app config by ID — the API only sends methodId,
    // we look up the export name and file path from mindstudio.json.
    const method = this.appConfig?.methods.find((m) => m.id === request.methodId);
    if (!method) {
      const message = `Unknown method ID: ${request.methodId}`;
      log.error('runner', message, { requestId: request.requestId, sessionId: session.sessionId });
      try {
        await submitDevResult(this.appId, session.sessionId, request.requestId, {
          type: 'execute',
          success: false,
          error: { message },
        });
      } catch {}
      devRequestEvents.emitComplete({ id: request.requestId, success: false, duration: 0, error: message });
      return;
    }

    // Jewel dispatch (dev twin of the deployed jewelS3Key dispatch): run the
    // method's companion jewel instead of the method itself. The platform
    // gated on the session-start declaration; a missing local entry here is
    // config drift and reports as an ordinary execution error.
    const jewel = request.jewel ? method.jewel : undefined;
    if (request.jewel && !jewel) {
      const message = `Method ${method.id} declares no jewel in mindstudio.json`;
      log.error('runner', message, { requestId: request.requestId, sessionId: session.sessionId });
      try {
        await submitDevResult(this.appId, session.sessionId, request.requestId, {
          type: 'execute',
          success: false,
          error: { message },
        });
      } catch {}
      devRequestEvents.emitComplete({ id: request.requestId, success: false, duration: 0, error: message });
      return;
    }
    const execPath = jewel ? jewel.path : method.path;
    const execExport = jewel ? (jewel.export ?? 'default') : method.export;

    devRequestEvents.emitStart({
      id: request.requestId,
      type: request.type,
      method: jewel ? `${method.export} (jewel)` : method.export,
      timestamp: startTime,
    });

    log.info('runner', 'Method received', { requestId: request.requestId, method: method.export, jewel: !!jewel, source: 'poll', sessionId: session.sessionId });

    try {
      const t0 = Date.now();
      const transpiledPath = await transpiler.transpile(execPath);
      const t1 = Date.now();

      // userId from the resolved ms_iface_ token — fresh on every request,
      // changes as users log in/out. Never fall back to the stale session value.
      const userId = request.userId ?? null;

      // Jewels run as the app's deterministic jewel user with the
      // manifest-declared roles — same identity a deployed run gets
      // (matches runJewelTest).
      const auth = jewel
        ? {
            userId: jewelUserIdForApp(this.appId),
            roleAssignments: (jewel.roles ?? []).map((roleName) => ({
              userId: jewelUserIdForApp(this.appId),
              roleName,
            })),
          }
        : {
            userId,
            roleAssignments: request.roleAssignments ?? [],
          };

      // Execute in isolated child process
      const result = await executeMethod({
        requestId: request.requestId,
        transpiledPath,
        methodExport: execExport,
        input: request.input,
        auth,
        databases: session.databases,
        authorizationToken: request.authorizationToken,
        apiBaseUrl: getApiBaseUrl(),
        dbWsUrl: getDbWsUrl(),
        projectRoot: this.projectRoot,
        sessionId: session.sessionId,
        streamId: request.streamId,
        session: request.session,
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
        session.sessionId,
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
        log.info('runner', 'Method complete', { requestId: request.requestId, method: method.export, timing, sessionId: session.sessionId });
      } else {
        log.warn('runner', 'Method failed', {
          requestId: request.requestId,
          method: method.export,
          timing,
          error: result.error ? formatErrorForDisplay(result.error) : undefined,
          sessionId: session.sessionId,
        });
      }

      logMethodExecution({
        requestId: request.requestId,
        sessionId: session.sessionId,
        methodExport: execExport,
        methodPath: execPath,
        input: request.input,
        authorizationToken: request.authorizationToken,
        context: { auth, databases: session.databases },
        databases: session.databases,
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
      log.error('runner', 'Method execution error', { requestId: request.requestId, method: method.export, duration, error: message, sessionId: session.sessionId });

      try {
        await submitDevResult(
          this.appId,
          session.sessionId,
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
        sessionId: session.sessionId,
        methodExport: execExport,
        methodPath: execPath,
        input: request.input,
        authorizationToken: request.authorizationToken,
        databases: session.databases,
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
    const session = this.session;
    if (!session) return;
    log.info('runner', 'Config requested', { requestId: request.requestId, sessionId: session.sessionId });

    try {
      if (!this.appConfig) {
        throw new Error('App config not available');
      }

      const config = readConfig(this.projectRoot, this.appConfig);

      await submitDevResult(
        this.appId,
        session.sessionId,
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
          session.sessionId,
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

  // Resolve which identity the dev test user is minted under, from the app's
  // auth config. auth.methods is a strict enum: "email-code", "sms-code",
  // and/or "remy". Prefer a code-verify identity when configured (email first
  // — the more common dev setup); fall back to a delegated "Sign in with Remy"
  // test user for apps whose only human method is `remy` (no email/phone to
  // seed — the platform resolves the developer's own delegated identity).
  private testUserIdentityOpts(): {
    email?: string;
    phone?: string;
    delegated?: boolean;
  } {
    const auth = this.appConfig?.auth;
    if (!auth?.enabled) {
      throw new Error(
        `The dev test user requires auth: enable it in mindstudio.json ` +
          `(an "auth" block with enabled: true and a users table).`,
      );
    }
    const methods = auth.methods ?? [];
    if (methods.includes('email-code')) return { email: TEST_USER_EMAIL };
    if (methods.includes('sms-code')) return { phone: TEST_USER_PHONE };
    if (methods.includes('remy')) return { delegated: true };
    throw new Error(
      `The dev test user requires auth.methods in mindstudio.json to include ` +
        `"email-code", "sms-code", or "remy" (got ${JSON.stringify(methods)}).`,
    );
  }

  // The identity and roles a direct run executes as.
  //
  // Roles only mean something attached to a user: the SDK derives `auth.roles`
  // by matching assignments against `auth.userId`, and `requireRole` rejects a
  // null identity before it ever looks at roles. Roles on an anonymous call are
  // therefore unsatisfiable — the method's own pinned SDK either reports them
  // and rejects anyway (older builds match a null holder against a null
  // identity, so `hasRole` says yes while `requireRole` throws 401) or drops
  // them. Either way the gate can't pass, so every branch that carries roles
  // resolves a real holder here or fails with a reason the caller can act on.
  private async resolveRunAsAuth(opts: {
    roles?: string[];
    userId?: string;
    appConfig?: AppConfig | null;
  }): Promise<DevSession['auth']> {
    const sessionAuth = this.session?.auth ?? {
      userId: null,
      roleAssignments: [],
    };
    const roles = opts.roles?.length ? opts.roles : undefined;

    const named =
      opts.userId === TEST_USER_SENTINEL
        ? await this.resolveTestUserId()
        : opts.userId;

    // No roles requested: run as whoever was named, else anonymously — which
    // is exactly what an unauthenticated production request looks like.
    if (!roles) {
      return { ...sessionAuth, userId: named ?? sessionAuth.userId };
    }

    const holder =
      named ?? (await this.resolveRoleHolder(roles, opts.appConfig));
    return {
      userId: holder,
      roleAssignments: roles.map((roleName) => ({ userId: holder, roleName })),
    };
  }

  // Who holds caller-supplied roles when the caller didn't name a user.
  private async resolveRoleHolder(
    roles: string[],
    appConfig?: AppConfig | null,
  ): Promise<string> {
    // An auth-enabled app binds them to the dev test user's real row — the
    // same identity the preview's sign-in helper uses, so `auth.userId` and
    // role lookups behave as they would in production.
    if ((appConfig ?? this.appConfig)?.auth?.enabled) {
      return this.resolveTestUserId();
    }
    // No auth block means no users to bind to. `system` is the exception and
    // never needed one: it's the identity the platform itself runs as when it
    // invokes a method on the app's behalf, so a system-gated method is
    // ordinary in an app with no users.
    if (roles.includes(SYSTEM_ROLE)) {
      return SYSTEM_USER_ID;
    }
    throw new Error(
      `Cannot run as role(s) [${roles.join(', ')}]: this app has no "auth" block in ` +
        `mindstudio.json, so it has no users to hold a role. Only "${SYSTEM_ROLE}" can be ` +
        `simulated without auth — it's the identity cron, webhook, and email invocations ` +
        `run as. Enable auth in the manifest to test any other role.`,
    );
  }

  private async resolveTestUserId(): Promise<string> {
    if (this.testUserId) return this.testUserId;
    const { user } = await createAuthSession(
      this.appId,
      this.testUserIdentityOpts(),
    );
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

