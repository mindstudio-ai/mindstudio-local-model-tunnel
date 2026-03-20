/**
 * NDJSON log for browser-side events (console, errors, network, clicks).
 * Thin wrapper around NdjsonLog.
 */

import { NdjsonLog } from './ndjson-log';

const ndjsonLog = new NdjsonLog('browser.ndjson');

export function initBrowserLog(projectRoot: string): void {
  ndjsonLog.init(projectRoot);
}

export function appendBrowserLogEntries(
  entries: Array<Record<string, unknown>>,
): void {
  for (const entry of entries) {
    ndjsonLog.append({
      timestamp: new Date().toISOString(),
      ...entry,
    });
  }
}

export function closeBrowserLog(): void {
  ndjsonLog.close();
}
