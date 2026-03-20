// Structured NDJSON request log for method and scenario executions.
//
// Writes one JSON object per line to .logs/requests.ndjson in the project root.
// Designed to be read by AI agents debugging app issues and potentially
// rendered by a frontend dashboard.
//
// Rotation: keeps the last 300 entries when the file exceeds 500 lines or 2MB.

import fs from 'node:fs';
import { join } from 'node:path';
import { log } from './logger';
import type { DevSession, AppScenario } from './types';
import type { ExecuteMethodResult } from './executor';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MethodLogEntry {
  requestId: string;
  sessionId: string;
  methodExport: string;
  methodPath: string;
  input: unknown;
  roleOverride?: string[];
  authorizationToken: string;
  databases: DevSession['databases'];
  result: ExecuteMethodResult;
  duration: number;
}

export interface ScenarioLogEntry {
  sessionId: string;
  scenario: AppScenario;
  databases: DevSession['databases'];
  result: ExecuteMethodResult | null;
  infrastructureError?: string;
  duration: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let fd: number | null = null;
let logPath: string | null = null;
let lineCount = 0;
let rotating = false;

const MAX_LINES = 500;
const KEEP_LINES = 300;
const MAX_BYTES = 2 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initRequestLog(projectRoot: string): void {
  // Close previous fd if reinitializing (session restart)
  closeRequestLog();

  try {
    const logsDir = join(projectRoot, '.logs');
    fs.mkdirSync(logsDir, { recursive: true });

    logPath = join(logsDir, 'requests.ndjson');

    // Count existing lines
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, 'utf-8');
      lineCount = content.split('\n').filter((l) => l.trim()).length;
    } else {
      lineCount = 0;
    }

    fd = fs.openSync(logPath, 'a');
    log.info('Request log initialized', { path: logPath, existingEntries: lineCount });
  } catch (err) {
    log.warn('Failed to initialize request log', { error: err instanceof Error ? err.message : String(err) });
    fd = null;
    logPath = null;
  }
}

export function logMethodExecution(entry: MethodLogEntry): void {
  const record = {
    type: 'method',
    timestamp: new Date().toISOString(),
    requestId: entry.requestId,
    sessionId: entry.sessionId,
    method: entry.methodExport,
    path: entry.methodPath,
    input: entry.input,
    roleOverride: entry.roleOverride ?? null,
    authorizationToken: entry.authorizationToken,
    databases: entry.databases,
    success: entry.result.success,
    output: entry.result.output ?? null,
    error: entry.result.error ?? null,
    stdout: entry.result.stdout ?? [],
    duration: entry.duration,
    stats: entry.result.stats ?? null,
  };
  appendEntry(record);
}

export function logScenarioExecution(entry: ScenarioLogEntry): void {
  const record: Record<string, unknown> = {
    type: 'scenario',
    timestamp: new Date().toISOString(),
    sessionId: entry.sessionId,
    scenario: {
      id: entry.scenario.id,
      name: entry.scenario.name ?? entry.scenario.export,
      export: entry.scenario.export,
      path: entry.scenario.path,
    },
    databases: entry.databases,
    success: entry.result?.success ?? false,
    output: entry.result?.output ?? null,
    error: entry.result?.error ?? (entry.infrastructureError ? { message: entry.infrastructureError } : null),
    stdout: entry.result?.stdout ?? [],
    duration: entry.duration,
    stats: entry.result?.stats ?? null,
  };
  appendEntry(record);
}

export function closeRequestLog(): void {
  if (fd !== null) {
    try {
      fs.closeSync(fd);
    } catch {
      // Best effort
    }
    fd = null;
  }
  logPath = null;
  lineCount = 0;
  rotating = false;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function appendEntry(record: Record<string, unknown>): void {
  if (fd === null) return;

  try {
    const line = JSON.stringify(record) + '\n';
    fs.writeSync(fd, line);
    lineCount++;
    maybeRotate();
  } catch (err) {
    log.debug('Failed to write request log entry', { error: err instanceof Error ? err.message : String(err) });
  }
}

function maybeRotate(): void {
  if (fd === null || logPath === null || rotating) return;

  try {
    let needsRotation = lineCount > MAX_LINES;

    if (!needsRotation) {
      const stat = fs.fstatSync(fd);
      needsRotation = stat.size > MAX_BYTES;
    }

    if (!needsRotation) return;

    rotating = true;

    // Read, truncate, rewrite
    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    const kept = lines.slice(-KEEP_LINES);

    // Close old fd, rewrite file, reopen
    fs.closeSync(fd);
    fs.writeFileSync(logPath, kept.join('\n') + '\n', 'utf-8');
    fd = fs.openSync(logPath, 'a');
    lineCount = kept.length;

    log.debug('Request log rotated', { kept: lineCount });
  } catch (err) {
    log.debug('Request log rotation failed', { error: err instanceof Error ? err.message : String(err) });
  } finally {
    rotating = false;
  }
}
