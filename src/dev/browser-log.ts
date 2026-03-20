// NDJSON log for browser-side events (console, errors, network failures, clicks).
//
// The dev proxy injects a small script into HTML responses that captures
// browser events and POSTs them to /__mindstudio_dev__/logs. This module
// writes those entries to .logs/browser.ndjson.
//
// Follows the same pattern as request-log.ts: sync writes, append mode, rotation.

import fs from 'node:fs';
import { join } from 'node:path';
import { log } from './logger';

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

export function initBrowserLog(projectRoot: string): void {
  closeBrowserLog();

  try {
    const logsDir = join(projectRoot, '.logs');
    fs.mkdirSync(logsDir, { recursive: true });

    logPath = join(logsDir, 'browser.ndjson');

    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, 'utf-8');
      lineCount = content.split('\n').filter((l) => l.trim()).length;
    } else {
      lineCount = 0;
    }

    fd = fs.openSync(logPath, 'a');
    log.info('Browser log initialized', { path: logPath, existingEntries: lineCount });
  } catch (err) {
    log.warn('Failed to initialize browser log', { error: err instanceof Error ? err.message : String(err) });
    fd = null;
    logPath = null;
  }
}

export function appendBrowserLogEntries(entries: Array<Record<string, unknown>>): void {
  if (fd === null) return;

  try {
    for (const entry of entries) {
      const record = {
        timestamp: new Date().toISOString(),
        ...entry,
      };
      const line = JSON.stringify(record) + '\n';
      fs.writeSync(fd, line);
      lineCount++;
    }
    maybeRotate();
  } catch (err) {
    log.debug('Failed to write browser log entry', { error: err instanceof Error ? err.message : String(err) });
  }
}

export function closeBrowserLog(): void {
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

    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    const kept = lines.slice(-KEEP_LINES);

    fs.closeSync(fd);
    fs.writeFileSync(logPath, kept.join('\n') + '\n', 'utf-8');
    fd = fs.openSync(logPath, 'a');
    lineCount = kept.length;

    log.debug('Browser log rotated', { kept: lineCount });
  } catch (err) {
    log.debug('Browser log rotation failed', { error: err instanceof Error ? err.message : String(err) });
  } finally {
    rotating = false;
  }
}
