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
