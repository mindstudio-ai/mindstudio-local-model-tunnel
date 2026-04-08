// Execute transpiled methods in a persistent worker process.
//
// Instead of spawning a new Node.js process per request (which costs ~1-2s in
// cold start), we keep a single long-lived worker that receives requests over
// IPC. The Node runtime and SDK modules stay warm across invocations.
//
// Two execution modes depending on the installed @mindstudio-ai/agent version:
//
// ALS mode (>= 0.1.46): Uses runWithContext() + AsyncLocalStorage for per-request
// auth/token scoping. Methods execute concurrently. Fire-and-forget background
// tasks retain their auth context. Matches production sandbox behavior.
//
// Legacy mode (< 0.1.46): Per-request state (process.env.CALLBACK_TOKEN, global.ai)
// is set globally. Methods are serialized via a queue to prevent auth leakage.
//
// The worker is lazily spawned on first use, respawned if it dies, and killed
// on cleanup.

import { fork, type ChildProcess } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { log } from '../logging/logger';
import { logMethodStart, logMethodStdout, logBackgroundStdout } from '../logging/request-log';
import type { DevSession } from '../config/types';

const EXECUTION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes — matches prod

export interface ExecuteMethodOptions {
  transpiledPath: string;
  methodExport: string;
  input: unknown;
  auth: DevSession['auth'];
  databases: DevSession['databases'];
  authorizationToken: string;
  apiBaseUrl: string;
  projectRoot: string;
  sessionId?: string;
  streamId?: string;
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
let workerSupportsAls = false;
const pending = new Map<string, PendingRequest>();

/** Metadata for requests, used for lifecycle log events. */
const requestMeta = new Map<string, { sessionId: string; method: string; input: unknown }>();

// ---------------------------------------------------------------------------
// Shared error serializer (used by both worker scripts)
// ---------------------------------------------------------------------------

const SERIALIZE_ERROR_FN = `
function serializeError(err) {
  if (!err) return { message: 'Unknown error' };

  const serialized = {
    message: String(err.message ?? err),
    stack: err.stack,
  };

  if (err.code !== undefined) serialized.code = err.code;
  if (err.statusCode !== undefined) serialized.statusCode = err.statusCode;
  if (err.status !== undefined) serialized.status = err.status;
  if (err.response !== undefined) {
    try { serialized.response = typeof err.response === 'string' ? err.response : JSON.stringify(err.response); } catch {}
  }
  if (err.body !== undefined) {
    try { serialized.body = typeof err.body === 'string' ? err.body : JSON.stringify(err.body); } catch {}
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
`;

// ---------------------------------------------------------------------------
// ALS worker script — concurrent execution with per-request context
// ---------------------------------------------------------------------------

function buildAlsWorkerScript(): string {
  return `
import { AsyncLocalStorage } from 'node:async_hooks';
import { format } from 'node:util';
import { runWithContext } from '@mindstudio-ai/agent';

${SERIALIZE_ERROR_FN}

// Per-request console capture via AsyncLocalStorage
const consoleAls = new AsyncLocalStorage();
const _origLog = console.log;
const _origWarn = console.warn;
const _origError = console.error;

console.log = (...args) => {
  const stdout = consoleAls.getStore();
  if (stdout) stdout.push(format(...args));
  _origLog(...args);
};
console.warn = (...args) => {
  const stdout = consoleAls.getStore();
  if (stdout) stdout.push(format(...args));
  _origWarn(...args);
};
console.error = (...args) => {
  const stdout = consoleAls.getStore();
  if (stdout) stdout.push(format(...args));
  _origError(...args);
};

// Track secret keys so we can clean up between requests
let _activeSecretKeys = [];

process.on('message', async (msg) => {
  const { id, transpiledPath, methodExport, input, auth, databases, authorizationToken, apiBaseUrl, streamId, secrets } = msg;

  // Apply per-request secrets to process.env (clean up previous first)
  for (const key of _activeSecretKeys) delete process.env[key];
  _activeSecretKeys = secrets ? Object.keys(secrets) : [];
  if (secrets) Object.assign(process.env, secrets);

  const ctx = {
    callbackToken: authorizationToken,
    remoteHostname: apiBaseUrl,
    auth: auth ?? { userId: null, roleAssignments: [] },
    databases: databases ?? [],
    streamId: streamId ?? undefined,
  };

  const stdout = [];
  let flushed = 0;
  let done = false;

  // Flush new stdout lines every 1s while the method is running.
  // After the method returns, switches to background-stdout type.
  const flushInterval = setInterval(() => {
    if (stdout.length > flushed) {
      const lines = stdout.slice(flushed);
      flushed = stdout.length;
      try {
        process.send({ type: done ? 'background-stdout' : 'stdout', id, lines });
      } catch {}
      idleTicks = 0;
    } else if (done) {
      idleTicks++;
      if (idleTicks >= 2) {
        clearInterval(flushInterval);
        try { process.send({ type: 'stdout-end', id }); } catch {}
      }
    }
  }, 1000);
  let idleTicks = 0;

  process.send({ type: 'start', id });

  const startTime = Date.now();

  try {
    const returnValue = await consoleAls.run(stdout, () =>
      runWithContext(ctx, async () => {
        const mod = await import(transpiledPath + '?t=' + Date.now());
        const fn = mod[methodExport];
        if (typeof fn !== 'function') {
          throw new Error(methodExport + ' is not a function (got ' + typeof fn + ')');
        }
        return fn(input);
      }),
    );
    const stats = { memoryUsedBytes: process.memoryUsage().heapUsed, executionTimeMs: Date.now() - startTime };

    // Final flush of any remaining lines before sending result
    if (stdout.length > flushed) {
      try { process.send({ type: 'stdout', id, lines: stdout.slice(flushed) }); } catch {}
      flushed = stdout.length;
    }

    done = true;
    process.send({ id, success: true, output: returnValue, stats });
  } catch (err) {
    const stats = { memoryUsedBytes: process.memoryUsage().heapUsed, executionTimeMs: Date.now() - startTime };

    if (stdout.length > flushed) {
      try { process.send({ type: 'stdout', id, lines: stdout.slice(flushed) }); } catch {}
      flushed = stdout.length;
    }

    done = true;
    process.send({ id, success: false, error: serializeError(err), stats });
  }
});

// Signal ready
process.send({ type: 'ready' });
`;
}

// ---------------------------------------------------------------------------
// Legacy worker script — globals + serialized execution
// ---------------------------------------------------------------------------

function buildLegacyWorkerScript(): string {
  return `
${SERIALIZE_ERROR_FN}

// Save original console methods so we can restore after each request
const _origLog = console.log;
const _origWarn = console.warn;
const _origError = console.error;

// Track secret keys so we can clean up between requests
let _activeSecretKeys = [];

process.on('message', async (msg) => {
  const { id, transpiledPath, methodExport, input, auth, databases, authorizationToken, apiBaseUrl, streamId, secrets } = msg;

  // Update per-request env vars
  process.env.CALLBACK_TOKEN = authorizationToken;
  process.env.REMOTE_HOSTNAME = apiBaseUrl;
  if (streamId) process.env.STREAM_ID = streamId;
  else delete process.env.STREAM_ID;

  // Apply per-request secrets to process.env (clean up previous first)
  for (const key of _activeSecretKeys) delete process.env[key];
  _activeSecretKeys = secrets ? Object.keys(secrets) : [];
  if (secrets) Object.assign(process.env, secrets);

  // Update global context
  global.ai = { auth, databases };

  // Capture console output for this request
  const stdout = [];
  console.log = (...args) => stdout.push(args.map(String).join(' '));
  console.warn = (...args) => stdout.push(args.map(String).join(' '));
  console.error = (...args) => stdout.push(args.map(String).join(' '));

  const startTime = Date.now();

  try {
    // Cache-bust so code changes are picked up
    const mod = await import(transpiledPath + '?t=' + Date.now());
    const fn = mod[methodExport];
    if (typeof fn !== 'function') {
      throw new Error(methodExport + ' is not a function (got ' + typeof fn + ')');
    }
    const returnValue = await fn(input);
    const stats = { memoryUsedBytes: process.memoryUsage().heapUsed, executionTimeMs: Date.now() - startTime };
    process.send({ id, success: true, output: returnValue, stdout, stats });
  } catch (err) {
    const stats = { memoryUsedBytes: process.memoryUsage().heapUsed, executionTimeMs: Date.now() - startTime };
    process.send({ id, success: false, error: serializeError(err), stdout, stats });
  } finally {
    // Restore console
    console.log = _origLog;
    console.warn = _origWarn;
    console.error = _origError;
  }
});

// Signal ready
process.send({ type: 'ready' });
`;
}

// ---------------------------------------------------------------------------
// SDK version detection
// ---------------------------------------------------------------------------

function detectAlsSupport(projectRoot: string): boolean {
  try {
    const pkgPath = join(projectRoot, 'node_modules', '@mindstudio-ai', 'agent', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const parts = (pkg.version || '').split('.').map(Number);
    const [major = 0, minor = 0, patch = 0] = parts;
    // runWithContext was added in 0.1.46
    return major > 0 || minor > 1 || (minor === 1 && patch >= 46);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Worker lifecycle
// ---------------------------------------------------------------------------

/** Ensure a live worker process exists; spawn one if needed. */
async function ensureWorker(projectRoot: string): Promise<ChildProcess> {
  // Respawn if worker died or project root changed
  if (worker?.connected && workerProjectRoot === projectRoot) {
    return worker;
  }

  // Log respawn reason (skip for first spawn)
  if (worker || workerProjectRoot) {
    const reason = workerProjectRoot !== projectRoot ? 'project-root-changed' : 'disconnected';
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

  // Detect execution mode
  workerSupportsAls = detectAlsSupport(projectRoot);
  log.info('executor', 'SDK context support', { als: workerSupportsAls });

  // Write worker script
  const scriptPath = join(
    tmpdir(),
    `ms-dev-worker-${randomBytes(4).toString('hex')}.mjs`,
  );
  const script = workerSupportsAls ? buildAlsWorkerScript() : buildLegacyWorkerScript();
  await writeFile(scriptPath, script, 'utf-8');
  workerScriptPath = scriptPath;
  workerProjectRoot = projectRoot;

  log.debug('executor', 'Spawning method execution process', { cwd: projectRoot, scriptPath, als: workerSupportsAls });

  const child = fork(scriptPath, [], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env },
  });

  // Wait for ready signal
  await new Promise<void>((resolve, reject) => {
    const onMessage = (msg: any) => {
      if (msg?.type === 'ready') {
        child.off('message', onMessage);
        resolve();
      }
    };
    child.on('message', onMessage);
    child.on('error', reject);
    child.on('exit', (code) => reject(new Error(`Worker exited during startup with code ${code}`)));
  });

  // Route lifecycle events and results from the worker
  child.on('message', (msg: any) => {
    if (!msg?.id) return;
    const meta = requestMeta.get(msg.id);

    switch (msg.type) {
      case 'start':
        if (meta) logMethodStart(msg.id, meta.sessionId, meta.method, meta.input);
        return;
      case 'stdout':
        if (meta && msg.lines?.length) logMethodStdout(msg.id, meta.sessionId, meta.method, msg.lines);
        return;
      case 'background-stdout':
        if (meta && msg.lines?.length) logBackgroundStdout(msg.id, meta.sessionId, meta.method, msg.lines);
        return;
      case 'stdout-end':
        requestMeta.delete(msg.id);
        return;
    }

    // Method result — resolve the pending promise
    const req = pending.get(msg.id);
    if (!req) return;
    pending.delete(msg.id);
    clearTimeout(req.timer);
    req.resolve(msg as ExecuteMethodResult);
  });

  // If worker dies unexpectedly, reject all pending requests
  child.on('exit', (code) => {
    log.warn('executor', 'Method execution process exited unexpectedly', { code });
    for (const [id, req] of pending) {
      clearTimeout(req.timer);
      req.resolve({ success: false, error: { message: `Worker process exited with code ${code}` } });
    }
    pending.clear();
    worker = null;
  });

  // Capture stderr for debugging
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) log.warn('executor', 'Method process stderr', { text: text.slice(0, 500) });
  });

  worker = child;
  log.info('executor', 'Method execution process ready', { pid: child.pid });
  return child;
}

// ---------------------------------------------------------------------------
// Execution queue — only used in legacy mode (SDK < 0.1.46)
// ---------------------------------------------------------------------------

let queueTail: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const task = queueTail.then(fn, fn);
  queueTail = task.catch(() => {});
  return task;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute a transpiled method in the persistent worker process.
 * In ALS mode, executes directly (concurrent). In legacy mode, queued.
 */
export function executeMethod(
  opts: ExecuteMethodOptions,
): Promise<ExecuteMethodResult> {
  if (workerSupportsAls) {
    return executeMethodInWorker(opts);
  }
  return enqueue(() => executeMethodInWorker(opts));
}

async function executeMethodInWorker(
  opts: ExecuteMethodOptions,
): Promise<ExecuteMethodResult> {
  const w = await ensureWorker(opts.projectRoot);

  const id = randomBytes(8).toString('hex');

  log.debug('executor', 'Sending method to execution process', { id, methodExport: opts.methodExport });

  return new Promise<ExecuteMethodResult>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      log.warn('executor', 'Method execution timed out', { id, methodExport: opts.methodExport });
      resolve({
        success: false,
        error: { message: 'Method execution timed out after 30m' },
      });
    }, EXECUTION_TIMEOUT_MS);

    pending.set(id, { resolve, timer });
    if (opts.sessionId) {
      requestMeta.set(id, { sessionId: opts.sessionId, method: opts.methodExport, input: opts.input });
    }

    w.send({
      id,
      transpiledPath: opts.transpiledPath,
      methodExport: opts.methodExport,
      input: opts.input,
      auth: opts.auth,
      databases: opts.databases,
      authorizationToken: opts.authorizationToken,
      apiBaseUrl: opts.apiBaseUrl,
      streamId: opts.streamId,
      secrets: opts.secrets,
    });
  });
}

/**
 * Kill the persistent worker. Called on session stop / cleanup.
 */
export async function cleanupWorker(): Promise<void> {
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
  workerSupportsAls = false;
  for (const [, req] of pending) {
    clearTimeout(req.timer);
  }
  pending.clear();
  requestMeta.clear();
  queueTail = Promise.resolve();
}
