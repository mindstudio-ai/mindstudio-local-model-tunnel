// The forked dev method worker — one long-lived process that executes transpiled
// methods over IPC (see executor.ts for the parent side and worker-protocol.ts for
// the wire contract). Compiled by tsup to dist/dev-worker.js, then copied into the
// project's transpiler output dir and forked from there.
//
// Top-level `import { runWithContext }` is correct here: unlike the prod CFES
// worker (which extracts a release's dependency artifact over node_modules at
// /configure — AFTER startup — and must therefore lazy-load the SDK), the dev
// worker's @mindstudio-ai/agent is the project's already-installed copy and is
// stable for the worker's whole life (the worker respawns when the project root
// changes). Do NOT cargo-cult a lazy import from prod: there is no artifact swap to
// race here.

import { AsyncLocalStorage } from 'node:async_hooks';
import { format } from 'node:util';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runWithContext } from '@mindstudio-ai/agent';

import type {
  ExecuteRequest,
  WireError,
  WorkerMessage,
} from './worker-protocol';

// The SDK reaches for this hook by name on globalThis (see waitUntil in the
// agent SDK's client.ts); `declare global` lets us assign it without an `any` cast.
declare global {
  // eslint-disable-next-line no-var
  var __msWaitUntil: ((promise: Promise<unknown>) => void) | undefined;
}

/** Per-request state tracked for the lifetime of a request (through background work). */
interface ActiveRequest {
  id: string;
  stdout: string[];
  flushed: number;
  done: boolean;
  doneAt: number;
  pending: number;
  released: boolean;
}

const send = (msg: WorkerMessage): void => {
  try {
    process.send?.(msg);
  } catch {
    // Best effort — the parent may have already gone.
  }
};

function serializeError(err: any): WireError {
  if (!err) return { message: 'Unknown error' };

  const serialized: WireError = {
    message: String(err.message ?? err),
    stack: err.stack,
  };

  if (err.code !== undefined) serialized.code = err.code;
  if (err.statusCode !== undefined) serialized.statusCode = err.statusCode;
  if (err.status !== undefined) serialized.status = err.status;
  if (err.response !== undefined) {
    try {
      serialized.response =
        typeof err.response === 'string'
          ? err.response
          : JSON.stringify(err.response);
    } catch {}
  }
  if (err.body !== undefined) {
    try {
      serialized.body =
        typeof err.body === 'string' ? err.body : JSON.stringify(err.body);
    } catch {}
  }
  if (err.cause !== undefined) {
    serialized.cause = serializeError(err.cause);
  }

  for (const key of Object.keys(err)) {
    if (!(key in serialized)) {
      try {
        const val = err[key];
        if (val !== undefined && typeof val !== 'function') {
          serialized[key] = typeof val === 'object' ? JSON.stringify(val) : val;
        }
      } catch {}
    }
  }

  return serialized;
}

// Per-request state (stdout capture + waitUntil accounting) via AsyncLocalStorage.
// The store is the whole request object so the waitUntil hook can attribute
// registrations to the request that spawned them.
const consoleAls = new AsyncLocalStorage<ActiveRequest>();
const _origLog = console.log;
const _origWarn = console.warn;
const _origError = console.error;

console.log = (...args: unknown[]) => {
  const req = consoleAls.getStore();
  if (req) req.stdout.push(format(...args));
  _origLog(...args);
};
console.warn = (...args: unknown[]) => {
  const req = consoleAls.getStore();
  if (req) req.stdout.push(format(...args));
  _origWarn(...args);
};
console.error = (...args: unknown[]) => {
  const req = consoleAls.getStore();
  if (req) req.stdout.push(format(...args));
  _origError(...args);
};

// Track secret keys so we can clean up between requests.
// CAVEAT: process.env is process-global but methods run concurrently (ALS), so two
// truly-concurrent requests carrying DIFFERENT secret sets can clobber each other's
// env. Rare in dev (a single session's concurrent invocations share the same
// secrets). A full fix needs the SDK to read secrets from ctx instead of env —
// out of scope for this worker.
let _activeSecretKeys: string[] = [];

// ---------------------------------------------------------------------------
// mindstudio.waitUntil() host hook
// ---------------------------------------------------------------------------
// The SDK calls globalThis.__msWaitUntil(promise) so the worker knows background
// work EXISTS (not just its stdout). We track a per-request pending count and
// mirror open/idle transitions to the parent over IPC, so a teardown while work is
// in flight can be annotated in the request log even though the worker is killed
// by then. Mirrors the prod hook in CFES worker/src/background.ts.
globalThis.__msWaitUntil = (promise: Promise<unknown>) => {
  const req = consoleAls.getStore();
  if (!req || typeof promise?.finally !== 'function') return;
  if (req.released) return; // past the cutoff — nothing to defer
  req.pending++;
  if (req.pending === 1) send({ type: 'background-open', id: req.id });
  promise
    .finally(() => {
      // The sweep's cutoff force-release may have already zeroed this request's
      // registrations — don't double-decrement.
      if (req.released || req.pending <= 0) return;
      req.pending--;
      if (req.pending === 0) send({ type: 'background-idle', id: req.id });
    })
    // finally() re-throws the original rejection into this chain; swallow it here
    // so registration itself can never mint a new unhandled rejection. The SDK
    // attaches its own logging .catch to the caller's promise.
    .catch(() => {});
};

// ---------------------------------------------------------------------------
// Single flush loop for all active requests
// ---------------------------------------------------------------------------
// One interval sweeps all tracked requests instead of one interval per
// request. This stays efficient even with thousands of concurrent requests.

const BACKGROUND_TIMEOUT = 30 * 60 * 1000; // 30 minutes after method returns

const activeRequests = new Map<string, ActiveRequest>();

setInterval(() => {
  const now = Date.now();
  for (const [id, req] of activeRequests) {
    if (req.stdout.length > req.flushed) {
      const lines = req.stdout.slice(req.flushed);
      req.flushed = req.stdout.length;
      send({ type: req.done ? 'background-stdout' : 'stdout', id, lines });
    } else if (req.done && now - req.doneAt > BACKGROUND_TIMEOUT) {
      // Force-release any still-pending waitUntil registrations so a
      // never-settling promise can't keep the entry (and its parent-side pending
      // count) alive forever.
      req.released = true;
      req.pending = 0;
      activeRequests.delete(id);
      send({ type: 'stdout-end', id });
    }
  }
}, 1000);

// ---------------------------------------------------------------------------

process.on('message', async (raw) => {
  const msg = raw as ExecuteRequest;
  const {
    id,
    transpiledPath,
    methodExport,
    input,
    auth,
    databases,
    authorizationToken,
    apiBaseUrl,
    dbWsUrl,
    streamId,
    session,
    secrets,
  } = msg;

  // DB-over-WS transport for the agent SDK's db (falls back to fetch if unset).
  if (dbWsUrl) process.env.DB_WS_URL = dbWsUrl;

  // Apply per-request secrets to process.env (clean up previous first). See the
  // concurrency caveat on _activeSecretKeys above.
  for (const key of _activeSecretKeys) delete process.env[key];
  _activeSecretKeys = secrets ? Object.keys(secrets) : [];
  if (secrets) Object.assign(process.env, secrets);

  // auth/databases are opaque passthroughs — cast the assembled context to the
  // SDK's RequestContext (same approach as the prod worker) rather than coupling
  // to its internal shapes.
  const ctx = {
    callbackToken: authorizationToken,
    remoteHostname: apiBaseUrl,
    auth: auth ?? { userId: null, roleAssignments: [] },
    databases: databases ?? [],
    streamId: streamId ?? undefined,
    session: session ?? undefined,
  } as Parameters<typeof runWithContext>[0];

  const req: ActiveRequest = {
    id,
    stdout: [],
    flushed: 0,
    done: false,
    doneAt: 0,
    pending: 0,
    released: false,
  };
  activeRequests.set(id, req);

  send({ type: 'start', id });

  const startTime = Date.now();

  try {
    const returnValue = await consoleAls.run(req, () =>
      runWithContext(ctx, async () => {
        // Content-hash the transpiled file so the cache-bust query is stable
        // across calls when the code hasn't changed. Node's ESM loader caches by
        // URL and never evicts, so a per-call unique query (e.g. Date.now()) would
        // leak one module graph PER CALL for the worker's whole life. Keyed by
        // content, retention is bounded by the number of distinct code versions,
        // while an actual edit still yields a fresh URL and reloads.
        const version = createHash('sha1')
          .update(readFileSync(transpiledPath))
          .digest('hex');
        const mod = await import(transpiledPath + '?v=' + version);
        const fn = mod[methodExport];
        if (typeof fn !== 'function') {
          throw new Error(
            methodExport + ' is not a function (got ' + typeof fn + ')',
          );
        }
        return fn(input);
      }),
    );
    const stats = {
      memoryUsedBytes: process.memoryUsage().heapUsed,
      executionTimeMs: Date.now() - startTime,
    };

    // Final flush of any remaining lines before sending result
    if (req.stdout.length > req.flushed) {
      send({ type: 'stdout', id, lines: req.stdout.slice(req.flushed) });
      req.flushed = req.stdout.length;
    }

    req.done = true;
    req.doneAt = Date.now();
    send({
      type: 'result',
      id,
      success: true,
      output: returnValue,
      stdout: req.stdout,
      stats,
    });
  } catch (err) {
    const stats = {
      memoryUsedBytes: process.memoryUsage().heapUsed,
      executionTimeMs: Date.now() - startTime,
    };

    if (req.stdout.length > req.flushed) {
      send({ type: 'stdout', id, lines: req.stdout.slice(req.flushed) });
      req.flushed = req.stdout.length;
    }

    req.done = true;
    req.doneAt = Date.now();
    send({
      type: 'result',
      id,
      success: false,
      error: serializeError(err),
      stdout: req.stdout,
      stats,
    });
  }
});

// Signal ready
send({ type: 'ready' });
