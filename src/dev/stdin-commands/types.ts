/**
 * Shared types for stdin command handlers.
 */

import type { DevRunner } from '../runner';
import type { DevProxy } from '../proxy';
import type { AppConfig } from '../types';

export interface SessionState {
  runner: DevRunner | null;
  proxy: DevProxy | null;
  appConfig: AppConfig | null;
  proxyPort: number | null;
  unsubscribers: Array<() => void>;
}

export type EmitFn = (event: string, data?: Record<string, unknown>) => void;
