// Execute transpiled methods in a persistent worker process.
//
// Instead of spawning a new Node.js process per request (which costs ~1-2s in
// cold start), we keep a single long-lived worker that receives requests over
// IPC. The Node runtime and SDK modules stay warm across invocations.
//
// The worker uses runWithContext() + AsyncLocalStorage for per-request auth/token
// scoping: methods execute concurrently, fire-and-forget background tasks retain
// their auth context, and mindstudio.waitUntil() registrations are tracked so an
// interrupted-on-teardown annotation lands in the request log — matching prod
// sandbox behavior (CFES worker/src/{execution,background}.ts). runWithContext
// requires @mindstudio-ai/agent >= 0.1.46; an older SDK fails loudly at spawn (see
// assertAgentSupportsAls) rather than silently misbehaving.
//
// The worker itself is a compiled module (worker.ts → dist/dev-worker.js); this
// file spawns/manages it and owns the parent side of the IPC contract
// (worker-protocol.ts). It's lazily spawned on first use, respawned if it dies,
// and killed on cleanup.

import { fork, type ChildProcess } from 'node:child_process';
import { copyFile, unlink, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { log } from '../logging/logger';
import {
  logMethodStart,
  logMethodStdout,
  logBackgroundStdout,
} from '../logging/request-log';
import type { DevSession } from '../config/types';
import type { ExecuteRequest, WorkerMessage } from './worker-protocol';

const EXECUTION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes — matches prod

// runWithContext (ALS-mode execution) landed in this SDK version.
const MIN_AGENT_VERSION = '0.1.46';

// V8 heap cap for the forked worker, set below the sandbox's memory headroom so
// a heap-object runaway aborts the worker (which then respawns on the next call)
// rather than growing unbounded. Defense-in-depth only: it does NOT bound
// external/Buffer memory (how embedding vectors allocate), which is the usual OOM
// cause — a runaway there OOM-kills the worker and it simply respawns.
const WORKER_MAX_OLD_SPACE_MB = Math.max(
  256,
  Number(process.env.MS_DEV_WORKER_MAX_OLD_SPACE_MB) || 1024,
);

// The compiled worker (tsup entry 'dev-worker'), sitting next to this bundle in
// dist/. Copied into the project's transpiler output dir at spawn — see spawnWorker
// for why it must be forked from inside the project tree.
const DEV_WORKER_DIST = fileURLToPath(
  new URL('./dev-worker.js', import.meta.url),
);

export interface ExecuteMethodOptions {
  requestId: string;
  transpiledPath: string;
  methodExport: string;
  input: unknown;
  auth: DevSession['auth'];
  databases: DevSession['databases'];
  authorizationToken: string;
  apiBaseUrl: string;
  dbWsUrl?: string;
  projectRoot: string;
  sessionId?: string;
  streamId?: string;
  /** Originating-session identity (voice/agent tool calls) — rides into the SDK ctx. */
  session?: Record<string, unknown>;
  secrets?: Record<string, string>;
}

export interface ExecuteMethodResult {
  success: boolean;
  output?: unknown;
  error?: { message: string; stack?: string };
  stdout?: string[];
  stats?: { memoryUsedBytes: number; executionTimeMs: number };
}

// ---------------------------------------------------------------------------
// Worker management
// ---------------------------------------------------------------------------

/** Pending request waiting for a response from the worker. */
interface PendingRequest {
  resolve: (result: ExecuteMethodResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

let worker: ChildProcess | null = null;
let workerScriptPath: string | null = null;
let workerProjectRoot: string | null = null;
// In-flight spawn memo: ensureWorker is async and only assigns `worker` after
// awaiting the ready signal, so a burst of concurrent cold-start calls would
// otherwise each fork a worker and leak all but the last. Concurrent callers
// await this single promise instead.
let spawning: Promise<ChildProcess> | null = null;
const pending = new Map<string, PendingRequest>();

/**
 * Metadata for requests, used for lifecycle log events. `pendingBackground` is
 * the count of live mindstudio.waitUntil() registrations for the request,
 * mirrored from the worker over IPC so teardown can annotate interrupted work
 * even though the worker is already killed by then.
 */
const requestMeta = new Map<
  string,
  {
    sessionId: string;
    method: string;
    input: unknown;
    pendingBackground: number;
  }
>();

// ---------------------------------------------------------------------------
// SDK version assertion
// ---------------------------------------------------------------------------

/**
 * Assert the installed @mindstudio-ai/agent supports ALS execution
 * (runWithContext, added in 0.1.46). Walks up from the transpiler's output
 * directory to find the package via normal node_modules resolution — the
 * transpiled methods resolve their imports from there, so the agent package is
 * guaranteed findable from that location. Throws an actionable error on a
 * missing or too-old SDK, which surfaces as a normal method failure rather than a
 * cryptic "does not provide an export named 'runWithContext'" worker crash.
 */
function assertAgentSupportsAls(scriptDir: string): void {
  let dir = scriptDir;
  while (true) {
    const candidate = join(
      dir,
      'node_modules',
      '@mindstudio-ai',
      'agent',
      'package.json',
    );
    let version: string | null = null;
    try {
      const pkg = JSON.parse(readFileSync(candidate, 'utf-8'));
      version = String(pkg.version || '');
    } catch {
      // Not at this level — walk up.
    }
    if (version !== null) {
      const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
      const ok = major > 0 || minor > 1 || (minor === 1 && patch >= 46);
      if (!ok) {
        throw new Error(
          `@mindstudio-ai/agent ${version} is too old for local development — ` +
            `upgrade to >= ${MIN_AGENT_VERSION} (runWithContext support).`,
        );
      }
      return;
    }
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `@mindstudio-ai/agent not found near ${scriptDir}. Run \`npm install\` ` +
      `(local development requires >= ${MIN_AGENT_VERSION}).`,
  );
}

// ---------------------------------------------------------------------------
// Worker lifecycle
// ---------------------------------------------------------------------------

/** Ensure a live worker process exists; spawn one if needed. */
async function ensureWorker(
  projectRoot: string,
  scriptDir: string,
): Promise<ChildProcess> {
  // Fast path: a live worker already serving this project root.
  if (worker?.connected && workerProjectRoot === projectRoot) {
    return worker;
  }

  // Coalesce concurrent cold-starts onto ONE spawn (see the `spawning` note).
  if (!spawning) {
    const p = spawnWorker(projectRoot, scriptDir);
    spawning = p;
    // Clear the memo when this spawn settles — but only if it's still ours (a
    // later spawn for a different root may have already replaced it).
    p.finally(() => {
      if (spawning === p) spawning = null;
    }).catch(() => {});
  }

  const w = await spawning;
  // The coalesced spawn may have targeted a different project root; if ours still
  // isn't the live worker, start a fresh one.
  if (w.connected && workerProjectRoot === projectRoot) return w;
  return ensureWorker(projectRoot, scriptDir);
}

/** Spawn a fresh worker for `projectRoot`, wait until it's ready, and wire it up. */
async function spawnWorker(
  projectRoot: string,
  scriptDir: string,
): Promise<ChildProcess> {
  // Log respawn reason (skip for first spawn)
  if (worker || workerProjectRoot) {
    const reason =
      workerProjectRoot !== projectRoot
        ? 'project-root-changed'
        : 'disconnected';
    log.info('executor', 'Respawning worker process', { reason });
  }

  // Clean up old worker
  if (worker) {
    worker.removeAllListeners();
    worker.kill();
    worker = null;
  }

  // Clean up old script
  if (workerScriptPath) {
    await unlink(workerScriptPath).catch(() => {});
    workerScriptPath = null;
  }

  // Fail loudly on a missing / too-old SDK rather than crashing the worker at
  // startup on the runWithContext import.
  assertAgentSupportsAls(scriptDir);

  // Copy the compiled worker into the transpiler output dir and fork it from
  // there so its `import '@mindstudio-ai/agent'` resolves against the PROJECT's
  // install (the tunnel doesn't depend on the SDK — it can't resolve it from its
  // own dist/). Node walks up from node_modules/.cache/mindstudio-dev/ to the
  // project's node_modules. `.mjs` forces ESM on the ESM bundle.
  await mkdir(scriptDir, { recursive: true });
  const scriptPath = join(
    scriptDir,
    `ms-dev-worker-${randomBytes(4).toString('hex')}.mjs`,
  );
  await copyFile(DEV_WORKER_DIST, scriptPath);
  workerScriptPath = scriptPath;
  workerProjectRoot = projectRoot;

  log.debug('executor', 'Spawning method execution process', {
    cwd: projectRoot,
    scriptPath,
  });

  const child = fork(scriptPath, [], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env },
    // Cap the worker heap below the sandbox's memory headroom (see
    // WORKER_MAX_OLD_SPACE_MB) so an OOM surfaces as a catchable per-request
    // heap error rather than an OS SIGKILL of the whole worker process.
    execArgv: [`--max-old-space-size=${WORKER_MAX_OLD_SPACE_MB}`],
  });

  // Wait for ready signal. Remove ALL three startup listeners on settle so they
  // don't linger alongside the real handlers installed below.
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      child.off('message', onMessage);
      child.off('error', onError);
      child.off('exit', onExit);
    };
    const onMessage = (raw: unknown) => {
      if ((raw as WorkerMessage)?.type === 'ready') {
        cleanup();
        resolve();
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Worker exited during startup with code ${code}`));
    };
    child.on('message', onMessage);
    child.on('error', onError);
    child.on('exit', onExit);
  });

  // Route lifecycle events and results from the worker
  child.on('message', (raw) => {
    const msg = raw as WorkerMessage;
    if (msg.type === 'ready') return; // consumed by the ready-wait above
    const meta = requestMeta.get(msg.id);

    switch (msg.type) {
      case 'start':
        if (meta)
          logMethodStart(msg.id, meta.sessionId, meta.method, meta.input);
        return;
      case 'stdout':
        if (meta && msg.lines.length)
          logMethodStdout(msg.id, meta.sessionId, meta.method, msg.lines);
        return;
      case 'background-stdout':
        if (meta && msg.lines.length)
          logBackgroundStdout(msg.id, meta.sessionId, meta.method, msg.lines);
        return;
      // waitUntil registration accounting, mirrored from the worker. We keep the
      // count parent-side so a teardown (worker already killed by then) can
      // annotate any request still holding background work.
      case 'background-open':
        if (meta) meta.pendingBackground++;
        return;
      case 'background-idle':
        if (meta && meta.pendingBackground > 0) meta.pendingBackground--;
        return;
      case 'stdout-end':
        requestMeta.delete(msg.id);
        return;
      case 'result': {
        // Method result — resolve the pending promise.
        const req = pending.get(msg.id);
        if (!req) return;
        pending.delete(msg.id);
        clearTimeout(req.timer);
        req.resolve(msg);
        return;
      }
    }
  });

  // If worker dies unexpectedly, reject all pending requests
  child.on('exit', (code) => {
    log.warn('executor', 'Method execution process exited unexpectedly', {
      code,
    });
    for (const [, req] of pending) {
      clearTimeout(req.timer);
      req.resolve({
        success: false,
        error: { message: `Worker process exited with code ${code}` },
      });
    }
    pending.clear();
    // A crash is also an interruption: annotate any request that still had
    // background (waitUntil) work in flight, then drop the now-stale meta.
    annotateInterruptedBackground('worker crash');
    requestMeta.clear();
    worker = null;
  });

  // Drain the worker's stdout/stderr. Per-request console output is captured
  // with attribution in the ndjson request log (via the ALS interceptor); this
  // is the raw process stream — surfaced for live visibility (shown on stderr
  // in headless mode; interactive writes the logger to .logs/tunnel.ndjson) and,
  // crucially, drained so a chatty method can't back-pressure the (previously
  // unread) stdout pipe and stall the worker.
  child.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text)
      log.info('executor', 'Method process stdout', {
        text: text.slice(0, 2000),
      });
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text)
      log.warn('executor', 'Method process stderr', {
        text: text.slice(0, 2000),
      });
  });

  worker = child;
  log.info('executor', 'Method execution process ready', { pid: child.pid });
  return child;
}

/**
 * Annotate any request still holding live waitUntil background work as
 * interrupted. Called on teardown (cleanupWorker) and on an unexpected worker
 * crash — in both cases the worker is gone, so the parent-side pendingBackground
 * count is the only remaining record that background work was still in flight.
 */
function annotateInterruptedBackground(reason: string): void {
  for (const [id, meta] of requestMeta) {
    if (meta.pendingBackground > 0) {
      logBackgroundStdout(id, meta.sessionId, meta.method, [
        `[platform] Background work interrupted by ${reason}`,
      ]);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute a transpiled method in the persistent worker process. Methods run
 * concurrently — the worker scopes per-request auth/token via runWithContext +
 * AsyncLocalStorage.
 */
export function executeMethod(
  opts: ExecuteMethodOptions,
): Promise<ExecuteMethodResult> {
  return executeMethodInWorker(opts);
}

async function executeMethodInWorker(
  opts: ExecuteMethodOptions,
): Promise<ExecuteMethodResult> {
  const w = await ensureWorker(opts.projectRoot, dirname(opts.transpiledPath));

  const id = opts.requestId;

  log.debug('executor', 'Sending method to execution process', {
    id,
    methodExport: opts.methodExport,
  });

  return new Promise<ExecuteMethodResult>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      log.warn('executor', 'Method execution timed out', {
        id,
        methodExport: opts.methodExport,
      });
      resolve({
        success: false,
        error: { message: 'Method execution timed out after 30m' },
      });
    }, EXECUTION_TIMEOUT_MS);

    pending.set(id, { resolve, timer });
    if (opts.sessionId) {
      requestMeta.set(id, {
        sessionId: opts.sessionId,
        method: opts.methodExport,
        input: opts.input,
        pendingBackground: 0,
      });
    }

    const request: ExecuteRequest = {
      id,
      transpiledPath: opts.transpiledPath,
      methodExport: opts.methodExport,
      input: opts.input,
      auth: opts.auth,
      databases: opts.databases,
      authorizationToken: opts.authorizationToken,
      apiBaseUrl: opts.apiBaseUrl,
      dbWsUrl: opts.dbWsUrl,
      streamId: opts.streamId,
      session: opts.session,
      secrets: opts.secrets,
    };
    w.send(request);
  });
}

/**
 * Kill the persistent worker. Called on session stop / cleanup.
 */
export async function cleanupWorker(): Promise<void> {
  // Annotate interrupted background work BEFORE killing the worker — the
  // parent-side pendingBackground counts are the only record once it's dead.
  annotateInterruptedBackground('dev session restart');

  if (worker) {
    worker.removeAllListeners();
    worker.kill();
    worker = null;
  }
  if (workerScriptPath) {
    await unlink(workerScriptPath).catch(() => {});
    workerScriptPath = null;
  }
  workerProjectRoot = null;
  spawning = null;
  for (const [, req] of pending) {
    clearTimeout(req.timer);
  }
  pending.clear();
  requestMeta.clear();
}
