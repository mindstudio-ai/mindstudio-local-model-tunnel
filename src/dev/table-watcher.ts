// Watches directories containing table source files and triggers a callback
// when a declared table file is created or modified. Used by both headless
// and TUI modes to auto-sync schema without session restart.
//
// Watches directories (not individual files) so newly created table files
// are detected — important when an AI agent defines tables in mindstudio.json
// before writing the actual source files.
//
// Directories are deduplicated: if all tables live in src/tables/, only one
// watcher is created. Events are filtered by expected filenames.

import { watch } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { log } from './logger';
import type { AppTable } from './types';

/**
 * Watch table source directories for changes.
 *
 * @param tables - Table entries from appConfig.tables
 * @param cwd - Project root directory
 * @param onChanged - Called (debounced 500ms) when a table file changes
 * @returns Cleanup function that closes all watchers and clears timers
 */
export function watchTableFiles(
  tables: AppTable[],
  cwd: string,
  onChanged: () => void,
): () => void {
  if (tables.length === 0) return () => {};

  // Build a map of directory → set of expected filenames
  const dirToFiles = new Map<string, Set<string>>();
  for (const table of tables) {
    const absPath = join(cwd, table.path);
    const dir = dirname(absPath);
    const file = basename(absPath);
    if (!dirToFiles.has(dir)) dirToFiles.set(dir, new Set());
    dirToFiles.get(dir)!.add(file);
  }

  let syncTimer: ReturnType<typeof setTimeout> | undefined;
  const cleanups: Array<() => void> = [];

  cleanups.push(() => clearTimeout(syncTimer));

  for (const [dir, expectedFiles] of dirToFiles) {
    try {
      const w = watch(dir, (_eventType, filename) => {
        if (filename && !expectedFiles.has(filename)) return;
        clearTimeout(syncTimer);
        syncTimer = setTimeout(onChanged, 500);
      });
      cleanups.push(() => w.close());
    } catch {
      // Directory doesn't exist yet, skip
    }
  }

  log.info('table-watcher Watching directories', {
    dirs: dirToFiles.size,
    tables: tables.length,
  });

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
