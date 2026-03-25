// Execute transpiled methods in a persistent worker process.
//
// Instead of spawning a new Node.js process per request (which costs ~1-2s in
// cold start), we keep a single long-lived worker that receives requests over
// IPC. The Node runtime and SDK modules stay warm across invocations.
//
// Concurrent requests are supported — the worker handles multiple async
// invocations in parallel, matched by request ID.
//
// The worker is lazily spawned on first use, respawned if it dies, and killed
// on cleanup. Per-request state (env vars, global.ai) is set before each call.

import { fork, type ChildProcess } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { log } from '../logging/logger';
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
  streamId?: string;
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
const pending = new Map<string, PendingRequest>();

/** Build the persistent worker script. */
function buildWorkerScript(): string {
  return `
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

// Save original console methods so we can restore after each request
const _origLog = console.log;
const _origWarn = console.warn;
const _origError = console.error;

process.on('message', async (msg) => {
  const { id, transpiledPath, methodExport, input, auth, databases, authorizationToken, apiBaseUrl, streamId } = msg;

  // Update per-request env vars
  process.env.CALLBACK_TOKEN = authorizationToken;
  process.env.REMOTE_HOSTNAME = apiBaseUrl;
  if (streamId) process.env.STREAM_ID = streamId;
  else delete process.env.STREAM_ID;

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

/** Ensure a live worker process exists; spawn one if needed. */
async function ensureWorker(projectRoot: string): Promise<ChildProcess> {
  // Respawn if worker died or project root changed
  if (worker?.connected && workerProjectRoot === projectRoot) {
    return worker;
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

  // Write worker script
  const scriptPath = join(
    tmpdir(),
    `ms-dev-worker-${randomBytes(4).toString('hex')}.mjs`,
  );
  await writeFile(scriptPath, buildWorkerScript(), 'utf-8');
  workerScriptPath = scriptPath;
  workerProjectRoot = projectRoot;

  log.debug('Spawning method execution process', { cwd: projectRoot, scriptPath });

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

  // Route responses to pending requests
  child.on('message', (msg: any) => {
    if (!msg?.id) return;
    const req = pending.get(msg.id);
    if (!req) return;
    pending.delete(msg.id);
    clearTimeout(req.timer);
    req.resolve(msg as ExecuteMethodResult);
  });

  // If worker dies unexpectedly, reject all pending requests
  child.on('exit', (code) => {
    log.warn('Method execution process exited unexpectedly', { code });
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
    if (text) log.warn('Method process stderr', { text: text.slice(0, 500) });
  });

  worker = child;
  log.info('Method execution process ready', { pid: child.pid });
  return child;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute a transpiled method in the persistent worker process.
 */
export async function executeMethod(
  opts: ExecuteMethodOptions,
): Promise<ExecuteMethodResult> {
  const w = await ensureWorker(opts.projectRoot);

  const id = randomBytes(8).toString('hex');

  log.debug('Sending method to execution process', { id, methodExport: opts.methodExport });

  return new Promise<ExecuteMethodResult>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      log.warn('Method execution timed out', { id, methodExport: opts.methodExport });
      resolve({
        success: false,
        error: { message: 'Method execution timed out after 30s' },
      });
    }, EXECUTION_TIMEOUT_MS);

    pending.set(id, { resolve, timer });

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
  for (const [, req] of pending) {
    clearTimeout(req.timer);
  }
  pending.clear();
}
