// Watches directories containing table source files and triggers a callback
// when a declared table file is created or modified. Used by both headless
// and TUI modes to auto-sync schema without session restart.
//
// Uses chokidar instead of fs.watch so that:
// - Atomic file replacements (write-tmp + rename) are detected on Linux
// - Directories that don't exist yet are watched once created
// - Events are deduplicated and debounced reliably

import { watch } from 'chokidar';
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

  // Resolve absolute paths for each table file
  const filePaths = tables.map((t) => join(cwd, t.path));

  let syncTimer: ReturnType<typeof setTimeout> | undefined;

  const watcher = watch(filePaths, {
    ignoreInitial: true,
    // Don't fail if files don't exist yet — watch for creation
    disableGlobbing: true,
  });

  watcher.on('all', () => {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(onChanged, 500);
  });

  // Build a map for logging
  const dirToFiles = new Map<string, Set<string>>();
  for (const table of tables) {
    const absPath = join(cwd, table.path);
    const dir = dirname(absPath);
    const file = basename(absPath);
    if (!dirToFiles.has(dir)) dirToFiles.set(dir, new Set());
    dirToFiles.get(dir)!.add(file);
  }

  log.info('Watching table source files', {
    dirs: dirToFiles.size,
    tables: tables.length,
  });

  return () => {
    clearTimeout(syncTimer);
    watcher.close();
  };
}
