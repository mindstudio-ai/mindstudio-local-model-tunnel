/**
 * Shared types for stdin command handlers.
 */

import type { DevRunner } from '../execution/runner';
import type { DevProxy } from '../proxy/proxy';
import type { BrowserSupervisor } from '../browser';
import type { AppConfig, WebInterfaceConfig } from '../config/types';

export interface SessionState {
  runner: DevRunner | null;
  proxy: DevProxy | null;
  browser: BrowserSupervisor | null;
  appConfig: AppConfig | null;
  /** Cached web.json snapshot at session start; used to diff hot-applicable
   *  changes (e.g. defaultPreviewMode) against the current state. */
  lastWebConfig: WebInterfaceConfig | null;
  proxyPort: number | null;
  unsubscribers: Array<() => void>;
}

export interface CommandContext {
  state: SessionState;
  cwd: string;
  requestId: string;
  /** Emit a "started" progress event for this command. */
  started(data?: Record<string, unknown>): void;
}

export type CommandHandler = (
  ctx: CommandContext,
  cmd: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export const ERROR_CODES = [
  'NO_SESSION',
  'NO_BROWSER',
  'BROWSER_TIMEOUT',
  'BROWSER_DISCONNECTED',
  'COMMAND_LOST_ON_NAVIGATION',
  'PAGE_LEFT_APP_ORIGIN',
  'BROWSER_SEND_FAILED',
  'BROWSER_ERROR',
  'INVALID_INPUT',
  'EXECUTION_ERROR',
  'UNKNOWN_ACTION',
  'UPLOAD_FAILED',
  'INFRASTRUCTURE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Typed error with a machine-readable error code.
 * Thrown by handlers and the proxy dispatch layer.
 */
export class CommandError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
  ) {
    super(message);
  }
}

/**
 * The code a thrown value declares for itself, if it's one we report.
 *
 * Lets any error carry its own code — `CommandError` and the browser module's
 * `ScreenshotTimeoutError` both do — rather than the router growing an
 * `instanceof` branch per error type and falling back to `INFRASTRUCTURE` for
 * everything else, which labels ordinary slowness as broken plumbing and sends
 * the agent looking in the wrong place.
 */
export function errorCodeOf(err: unknown): ErrorCode | null {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' &&
    (ERROR_CODES as readonly string[]).includes(code)
    ? (code as ErrorCode)
    : null;
}
