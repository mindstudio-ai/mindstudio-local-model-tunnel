// DevRunner — manages the dev session poll loop and method execution.

import {
  startDevSession,
  stopDevSession,
  pollDevRequest,
  submitDevResult,
  DevPollError,
} from './api';
import { devRequestEvents } from './events';
import { Transpiler } from './transpiler';
import { executeMethod } from './executor';
import { getApiBaseUrl } from '../config';
import type { DevSession, DevRequest, DevResult } from './types';

export class DevRunner {
  private isRunning = false;
  private session: DevSession | null = null;
  private transpiler: Transpiler | null = null;
  private backoffMs = 1000;
  private hadConnectionWarning = false;
  private proxyUrl: string | undefined;

  constructor(
    private readonly appId: string,
    private readonly projectRoot: string,
    private readonly startOpts: {
      branch?: string;
      proxyUrl?: string;
      methods?: Array<{ id: string; export: string; path: string }>;
    } = {},
  ) {}

  setProxyUrl(url: string): void {
    this.proxyUrl = url;
    this.startOpts.proxyUrl = url;
  }

  async start(): Promise<DevSession> {
    if (this.isRunning) {
      throw new Error('DevRunner is already running');
    }

    const session = await startDevSession(this.appId, this.startOpts);
    this.session = session;
    this.transpiler = new Transpiler(this.projectRoot);
    this.isRunning = true;
    this.backoffMs = 1000;

    // Start poll loop in background
    this.pollLoop();

    return session;
  }

  async stop(): Promise<void> {
    this.isRunning = false;

    if (this.session) {
      try {
        await stopDevSession(this.appId, this.session.sessionId);
      } catch {
        // Best effort cleanup
      }
      this.session = null;
    }

    if (this.transpiler) {
      await this.transpiler.cleanup();
      this.transpiler = null;
    }
  }

  getSession(): DevSession | null {
    return this.session;
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
          devRequestEvents.emitSessionExpired();
          this.isRunning = false;
          return;
        }

        // Connection issue — backoff and retry
        if (!this.hadConnectionWarning) {
          this.hadConnectionWarning = true;
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
    const startTime = Date.now();

    devRequestEvents.emitStart({
      id: request.requestId,
      type: request.type,
      method: request.methodExport,
      timestamp: startTime,
    });

    try {
      // Transpile
      const transpiledPath = await this.transpiler!.transpile(request.methodPath);

      // Use role override if present, otherwise default session auth
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

      devRequestEvents.emitComplete({
        id: request.requestId,
        success: result.success,
        duration: Date.now() - startTime,
        error: result.error ? formatErrorForDisplay(result.error) : undefined,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';

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
      } catch {
        // If we can't even submit the error, just log it
      }

      devRequestEvents.emitComplete({
        id: request.requestId,
        success: false,
        duration: Date.now() - startTime,
        error: message,
      });
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
