// Execute a transpiled method in an isolated child process.
//
// Each method invocation gets its own Node.js process for isolation.
// The process runs a bootstrap .mjs script that:
// 1. Sets up globalThis.ai (auth + database context for the SDK)
// 2. Intercepts console.log/warn/error into a buffer (so it doesn't
//    corrupt our JSON result on stdout)
// 3. Imports the transpiled method and calls it
// 4. Writes the result as JSON to stdout
//
// This mirrors the cloud sandbox's buildIndexFile.ts pattern. The SDK
// (@mindstudio-ai/agent) doesn't know it's running locally — it uses
// the same env vars (CALLBACK_TOKEN, REMOTE_HOSTNAME) for db queries
// and other platform callbacks.

import { spawn } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { log } from './logger';
import type { DevSession } from './types';

const EXECUTION_TIMEOUT_MS = 30_000;

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

/**
 * Build the bootstrap ESM script that sets up globalThis.ai,
 * imports the transpiled method, calls the export, and writes the result to stdout.
 */
function buildBootstrapScript(opts: ExecuteMethodOptions): string {
  return `
global.ai = {
  auth: ${JSON.stringify(opts.auth)},
  databases: ${JSON.stringify(opts.databases)},
};

function serializeError(err) {
  if (!err) return { message: 'Unknown error' };

  const serialized = {
    message: String(err.message ?? err),
    stack: err.stack,
  };

  // Capture common extra properties from SDK/HTTP errors
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

  // Capture any other enumerable properties
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

// Capture console output from method code
const _stdout = [];
console.log = (...args) => _stdout.push(args.map(String).join(' '));
console.warn = (...args) => _stdout.push(args.map(String).join(' '));
console.error = (...args) => _stdout.push(args.map(String).join(' '));

const _startTime = Date.now();

const { ${opts.methodExport} } = await import(${JSON.stringify(opts.transpiledPath + '?t=' + Date.now())});

try {
  const returnValue = await ${opts.methodExport}(${JSON.stringify(opts.input)});
  const _stats = { memoryUsedBytes: process.memoryUsage().heapUsed, executionTimeMs: Date.now() - _startTime };
  process.stdout.write(JSON.stringify({ success: true, output: returnValue, stdout: _stdout, stats: _stats }));
} catch (err) {
  const _stats = { memoryUsedBytes: process.memoryUsage().heapUsed, executionTimeMs: Date.now() - _startTime };
  process.stdout.write(JSON.stringify({
    success: false,
    error: serializeError(err),
    stdout: _stdout,
    stats: _stats,
  }));
}
`;
}

/**
 * Execute a transpiled method file in an isolated Node.js child process.
 */
export async function executeMethod(
  opts: ExecuteMethodOptions,
): Promise<ExecuteMethodResult> {
  // Write bootstrap script to a temp file
  const tempFile = join(
    tmpdir(),
    `ms-dev-${randomBytes(8).toString('hex')}.mjs`,
  );
  const script = buildBootstrapScript(opts);

  try {
    await writeFile(tempFile, script, 'utf-8');
    log.debug('executor Spawning node process', { methodExport: opts.methodExport, cwd: opts.projectRoot, tempFile });

    return await new Promise<ExecuteMethodResult>((resolve, reject) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      const child = spawn('node', [tempFile], {
        cwd: opts.projectRoot,
        env: {
          ...process.env,
          // Clear API key so SDK falls through to CALLBACK_TOKEN for auth.
          // The SDK resolves auth as: MINDSTUDIO_API_KEY > ~/.mindstudio/config > CALLBACK_TOKEN.
          // We need CALLBACK_TOKEN (the per-request hook token from the platform).
          MINDSTUDIO_API_KEY: '',
          // These env vars are read by @mindstudio-ai/agent for db queries
          // and other platform callbacks. Same names as the cloud sandbox.
          CALLBACK_TOKEN: opts.authorizationToken,
          REMOTE_HOSTNAME: opts.apiBaseUrl,
          MINDSTUDIO_CALLBACK_TOKEN: opts.authorizationToken,
          MINDSTUDIO_API_BASE_URL: opts.apiBaseUrl,
          // STREAM_ID enables streaming responses via the platform's Redis pub/sub → SSE channel
          ...(opts.streamId ? { STREAM_ID: opts.streamId } : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
      child.stderr.on('data', (chunk) => stderrChunks.push(chunk));

      const timeout = setTimeout(() => {
        log.warn('executor Timeout after 30s, sending SIGKILL', { methodExport: opts.methodExport });
        child.kill('SIGKILL');
        reject(new Error('Method execution timed out after 30s'));
      }, EXECUTION_TIMEOUT_MS);

      child.on('close', (code) => {
        clearTimeout(timeout);

        const stdout = Buffer.concat(stdoutChunks).toString('utf-8').trim();
        const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();

        log.debug('executor Process exited', { code, stdoutLen: stdout.length, stderrLen: stderr.length });

        if (stdout) {
          try {
            resolve(JSON.parse(stdout) as ExecuteMethodResult);
            return;
          } catch {
            log.warn('executor Invalid JSON from stdout', { stdout: stdout.slice(0, 200) });
          }
        }

        // Process exited without writing valid JSON to stdout
        const errorMessage =
          stderr ||
          stdout ||
          `Method process exited with code ${code ?? 'unknown'}`;

        resolve({
          success: false,
          error: { message: errorMessage },
        });
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        log.error('executor Process error', { error: err.message });
        reject(err);
      });
    });
  } finally {
    // Clean up temp file
    await unlink(tempFile).catch(() => {});
  }
}
