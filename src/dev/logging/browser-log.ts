/**
 * NDJSON log for browser-side events (console, errors, network, clicks).
 * Thin wrapper around NdjsonLog.
 */

import { NdjsonLog } from './ndjson-log';

const ndjsonLog = new NdjsonLog('browser.ndjson');

export function initBrowserLog(projectRoot: string): void {
  ndjsonLog.init(projectRoot);
}

/** Map browser entry types to log levels. */
function inferLevel(entry: Record<string, unknown>): string {
  const type = entry.type as string | undefined;
  if (type === 'error') return 'error';
  const level = entry.level as string | undefined;
  if (level === 'warn' || level === 'error' || level === 'debug') return level;
  return 'info';
}

export function appendBrowserLogEntries(
  entries: Array<Record<string, unknown>>,
): void {
  for (const entry of entries) {
    ndjsonLog.append({
      ts: Date.now(),
      level: inferLevel(entry),
      module: 'browser',
      ...entry,
    });
  }
}

export function closeBrowserLog(): void {
  ndjsonLog.close();
}
