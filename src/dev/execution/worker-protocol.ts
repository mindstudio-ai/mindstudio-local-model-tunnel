// IPC contract between the executor (parent, executor.ts) and the forked dev
// worker (worker.ts). Type-only: shared by both ends so the wire shape is checked
// on both sides, and nothing here emits runtime code — the worker stays a
// standalone bundle (only node builtins + the external @mindstudio-ai/agent).

/** Parent → worker: one method execution request. */
export interface ExecuteRequest {
  id: string;
  transpiledPath: string;
  methodExport: string;
  input: unknown;
  // auth/databases are opaque passthroughs into the SDK ctx — the worker never
  // inspects them, so they stay `unknown` and this file stays decoupled from
  // config/types (the parent types them via DevSession and they pass through).
  auth: unknown;
  databases: unknown;
  authorizationToken: string;
  apiBaseUrl: string;
  dbWsUrl?: string;
  streamId?: string;
  session?: Record<string, unknown>;
  secrets?: Record<string, string>;
}

/** Per-request execution stats, reported on the terminal result. */
export interface ExecuteStats {
  memoryUsedBytes: number;
  executionTimeMs: number;
}

/** Serialized error shape (see serializeError in worker.ts). */
export interface WireError {
  message: string;
  stack?: string;
  [key: string]: unknown;
}

/** The terminal result of an execution. */
export interface WorkerResult {
  type: 'result';
  id: string;
  success: boolean;
  output?: unknown;
  error?: WireError;
  stdout: string[];
  stats: ExecuteStats;
}

/**
 * Worker → parent messages. All but `ready` carry an `id`; the sweep streams
 * `stdout` (in-method) and `background-stdout` (post-return), `background-open`/
 * `background-idle` mirror the request's live waitUntil count, and `stdout-end`
 * retires a request after the 30-min background cutoff.
 */
export type WorkerMessage =
  | { type: 'ready' }
  | { type: 'start'; id: string }
  | { type: 'stdout'; id: string; lines: string[] }
  | { type: 'background-stdout'; id: string; lines: string[] }
  | { type: 'background-open'; id: string }
  | { type: 'background-idle'; id: string }
  | { type: 'stdout-end'; id: string }
  | WorkerResult;
