// Watches mindstudio.json for changes and triggers a callback.
//
// Uses chokidar instead of fs.watch so that atomic file replacements
// (write-tmp + rename) are detected on Linux. fs.watch watches the inode,
// so a rename-based write silently kills the watcher.

import { watch } from 'chokidar';
import { join } from 'node:path';
import { log } from './logger';

/**
 * Watch mindstudio.json for changes.
 *
 * @param cwd - Project root directory
 * @param onChanged - Called (debounced 500ms) when the config file changes
 * @returns Cleanup function that closes the watcher and clears timers
 */
export function watchConfigFile(
  cwd: string,
  onChanged: () => void,
): () => void {
  const configPath = join(cwd, 'mindstudio.json');

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const watcher = watch(configPath, {
    ignoreInitial: true,
    disableGlobbing: true,
  });

  watcher.on('all', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      onChanged();
    }, 500);
  });

  log.info('Watching mindstudio.json for changes', { path: configPath });

  return () => {
    clearTimeout(debounceTimer);
    watcher.close();
  };
}
