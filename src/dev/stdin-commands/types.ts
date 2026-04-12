/**
 * Shared types for stdin command handlers.
 */

import type { DevRunner } from '../execution/runner';
import type { DevProxy } from '../proxy/proxy';
import type { AppConfig } from '../config/types';

export interface SessionState {
  runner: DevRunner | null;
  proxy: DevProxy | null;
  appConfig: AppConfig | null;
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

export type ErrorCode =
  | 'NO_SESSION'
  | 'NO_BROWSER'
  | 'BROWSER_TIMEOUT'
  | 'BROWSER_DISCONNECTED'
  | 'BROWSER_SEND_FAILED'
  | 'BROWSER_ERROR'
  | 'INVALID_INPUT'
  | 'EXECUTION_ERROR'
  | 'UNKNOWN_ACTION'
  | 'UPLOAD_FAILED'
  | 'INFRASTRUCTURE';

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
