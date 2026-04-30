// Watches mindstudio.json (and optionally every interface JSON it references)
// for changes and triggers a callback.
//
// Uses chokidar instead of fs.watch so that atomic file replacements
// (write-tmp + rename) are detected on Linux. fs.watch watches the inode,
// so a rename-based write silently kills the watcher.

import { watch } from 'chokidar';
import { join } from 'node:path';
import { log } from '../logging/logger';
import { detectAppConfig } from './app-config';

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

  log.info('config', 'Watching mindstudio.json for changes', { path: configPath });

  return () => {
    clearTimeout(debounceTimer);
    watcher.close();
  };
}

/**
 * Watch mindstudio.json plus every JSON file it references via
 * `interfaces[].path` (web.json, api.json, agent.json, cron interface.json,
 * etc). The watch list is dynamic — when mindstudio.json itself changes,
 * we re-read it and reconcile the watched-paths set so newly-added
 * interfaces start being watched and removed ones stop.
 *
 * The callback fires once per debounced change burst with the path that
 * triggered it. Caller is responsible for deciding what to do (hot-apply
 * vs. full session restart).
 */
export function watchManifestFiles(
  cwd: string,
  onChanged: (changedPath: string) => void,
): () => void {
  const manifestPath = join(cwd, 'mindstudio.json');
  let watched = new Set<string>([manifestPath]);
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingPath: string | null = null;

  const watcher = watch(manifestPath, {
    ignoreInitial: true,
    disableGlobbing: true,
  });

  const updateInterfaceWatchers = (): void => {
    const config = detectAppConfig(cwd);
    const desired = new Set<string>([manifestPath]);
    for (const iface of config?.interfaces ?? []) {
      if (iface.enabled === false) continue;
      if (!iface.path) continue;
      desired.add(join(cwd, iface.path));
    }
    for (const p of desired) {
      if (!watched.has(p)) watcher.add(p);
    }
    for (const p of watched) {
      if (!desired.has(p)) watcher.unwatch(p);
    }
    watched = desired;
  };

  // Seed interface watchers from current manifest
  updateInterfaceWatchers();

  watcher.on('all', (_event, path) => {
    pendingPath = path ?? manifestPath;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const changed = pendingPath ?? manifestPath;
      pendingPath = null;
      // Manifest itself changed — refresh interface watch list before
      // the caller's handler runs (so subsequent changes hit the right set).
      if (changed === manifestPath) updateInterfaceWatchers();
      onChanged(changed);
    }, 500);
  });

  log.info('config', 'Watching manifest + interface configs for changes', {
    paths: Array.from(watched),
  });

  return () => {
    clearTimeout(debounceTimer);
    watcher.close();
  };
}
