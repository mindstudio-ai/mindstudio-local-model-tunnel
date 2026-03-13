// Execute a transpiled method in an isolated child process.
// Modeled after the cloud sandbox's buildIndexFile.ts pattern.

import { spawn } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
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
const _origLog = console.log;
const _origWarn = console.warn;
const _origError = console.error;
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

    return await new Promise<ExecuteMethodResult>((resolve, reject) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      const child = spawn('node', [tempFile], {
        cwd: opts.projectRoot,
        env: {
          ...process.env,
          // Unset API key so SDK uses the callback token for auth
          MINDSTUDIO_API_KEY: '',
          CALLBACK_TOKEN: opts.authorizationToken,
          REMOTE_HOSTNAME: opts.apiBaseUrl,
          MINDSTUDIO_CALLBACK_TOKEN: opts.authorizationToken,
          MINDSTUDIO_API_BASE_URL: opts.apiBaseUrl,
          ...(opts.streamId ? { STREAM_ID: opts.streamId } : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
      child.stderr.on('data', (chunk) => stderrChunks.push(chunk));

      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('Method execution timed out after 30s'));
      }, EXECUTION_TIMEOUT_MS);

      child.on('close', (code) => {
        clearTimeout(timeout);

        const stdout = Buffer.concat(stdoutChunks).toString('utf-8').trim();
        const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();

        if (stdout) {
          try {
            resolve(JSON.parse(stdout) as ExecuteMethodResult);
            return;
          } catch {
            // stdout wasn't valid JSON — fall through to error handling
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
        reject(err);
      });
    });
  } finally {
    // Clean up temp file
    await unlink(tempFile).catch(() => {});
  }
}
