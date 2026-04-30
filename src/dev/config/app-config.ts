// Reads the project's mindstudio.json manifest and related config files.
//
// mindstudio.json is the source of truth for the app — it declares methods,
// tables, interfaces, and the appId. The CLI reads it on startup to know
// what to transpile, which dev server to start, and what to send to the platform.
//
// Web interface config (e.g. dist/interfaces/web/web.json) provides devPort
// and devCommand for the frontend dev server.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { log } from '../logging/logger';
import type { AppConfig, WebInterfaceConfig } from './types';

/**
 * Read and parse mindstudio.json from the given directory.
 * Returns null if not found or invalid.
 */
export function detectAppConfig(cwd: string = process.cwd()): AppConfig | null {
  const appJsonPath = join(cwd, 'mindstudio.json');
  if (!existsSync(appJsonPath)) return null;

  try {
    const raw = readFileSync(appJsonPath, 'utf-8');
    const parsed = JSON.parse(raw);

    // Minimum validation: must have name and methods
    if (!parsed.name || !Array.isArray(parsed.methods)) {
      return null;
    }

    const config = {
      appId: parsed.appId,
      name: parsed.name,
      description: parsed.description,
      auth: parsed.auth ?? undefined,
      roles: parsed.roles ?? [],
      tables: parsed.tables ?? [],
      methods: parsed.methods,
      scenarios: parsed.scenarios ?? [],
      interfaces: parsed.interfaces ?? [],
    };
    log.info('config', 'Loaded mindstudio.json', {
      appId: config.appId,
      roles: config.roles.length,
      methods: config.methods.length,
      tables: config.tables.length,
      scenarios: config.scenarios.length,
      interfaces: config.interfaces.length,
    });
    return config;
  } catch (err) {
    log.warn('config', 'Failed to parse mindstudio.json', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * Read the manifest, retrying until `predicate` is satisfied or attempts
 * are exhausted. Closes the race where a stdin command fires immediately
 * after a manifest edit — the disk write may be momentarily partial
 * (atomic-rename in flight) or recently completed but read before the
 * rename committed. Returns the last config seen (even if predicate
 * never satisfied), so callers can produce accurate "not found" errors.
 *
 * Defaults: 5 attempts × 60ms = ~300ms ceiling for genuinely-absent items.
 */
export async function detectAppConfigUntil(
  cwd: string,
  predicate: (config: AppConfig) => boolean,
  attempts = 5,
  delayMs = 60,
): Promise<AppConfig | null> {
  let last: AppConfig | null = null;
  for (let i = 0; i < attempts; i++) {
    const config = detectAppConfig(cwd);
    if (config) {
      last = config;
      if (predicate(config)) return config;
    }
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return last;
}

/**
 * Find the web interface config from mindstudio.json and read its devPort/devCommand.
 * Returns null if no web interface is declared or config file doesn't exist.
 */
export function getWebInterfaceConfig(
  appConfig: AppConfig,
  cwd: string = process.cwd(),
): WebInterfaceConfig | null {
  const webInterface = appConfig.interfaces.find(
    (i) => i.type === 'web' && i.enabled !== false,
  );
  if (!webInterface) {
    return null;
  }

  const configPath = join(cwd, webInterface.path);
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const web = parsed.web;
    if (!web || typeof web !== 'object') {
      return null;
    }

    return {
      devPort: typeof web.devPort === 'number' ? web.devPort : undefined,
      devCommand: typeof web.devCommand === 'string' ? web.devCommand : undefined,
      defaultPreviewMode:
        web.defaultPreviewMode === 'mobile'
          ? 'mobile'
          : web.defaultPreviewMode === 'desktop'
            ? 'desktop'
            : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Get the web interface project directory from mindstudio.json.
 * The convention is that the config file lives inside the web project directory.
 */
export function getWebProjectDir(
  appConfig: AppConfig,
  cwd: string = process.cwd(),
): string | null {
  const webInterface = appConfig.interfaces.find(
    (i) => i.type === 'web' && i.enabled !== false,
  );
  if (!webInterface) {
    return null;
  }

  return dirname(join(cwd, webInterface.path));
}

/**
 * Read raw TypeScript source for each table file listed in mindstudio.json.
 * Returns array of { name, source } for sending to sync-schema endpoint.
 * Skips files that don't exist.
 */
export function readTableSources(
  appConfig: AppConfig,
  cwd: string = process.cwd(),
): Array<{ name: string; source: string }> {
  const results: Array<{ name: string; source: string }> = [];

  for (const table of appConfig.tables) {
    const filePath = join(cwd, table.path);
    if (!existsSync(filePath)) {
      log.warn('config', 'Table source file not found', { table: table.export, path: table.path });
      continue;
    }

    try {
      const source = readFileSync(filePath, 'utf-8');
      // Use the export name as the table name for error reporting
      const name = table.export;
      results.push({ name, source });
    } catch (err) {
      log.warn('config', 'Table source file unreadable', { table: table.export, path: table.path, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (results.length < appConfig.tables.length) {
    log.warn('config', 'Table source files missing', { missing: appConfig.tables.length - results.length, found: results.length, expected: appConfig.tables.length });
  }

  return results;
}

/**
 * Find project directories that have a package.json but no node_modules.
 * Returns paths that need `npm install`.
 */
export function findDirsNeedingInstall(
  appConfig: AppConfig,
  cwd: string = process.cwd(),
): string[] {
  const dirs: string[] = [];

  // Backend directory (derived from first method path, e.g. dist/backend/src/foo.ts → dist/backend)
  if (appConfig.methods.length > 0) {
    const firstMethodPath = appConfig.methods[0].path;
    // Walk up from the method file to find the nearest package.json
    const parts = firstMethodPath.split('/');
    for (let i = parts.length - 1; i >= 1; i--) {
      const candidate = join(cwd, ...parts.slice(0, i));
      if (existsSync(join(candidate, 'package.json'))) {
        if (!existsSync(join(candidate, 'node_modules'))) {
          dirs.push(candidate);
        }
        break;
      }
    }
  }

  // Web frontend directory
  const webProjectDir = getWebProjectDir(appConfig, cwd);
  if (webProjectDir && existsSync(join(webProjectDir, 'package.json'))) {
    if (!existsSync(join(webProjectDir, 'node_modules'))) {
      dirs.push(webProjectDir);
    }
  }

  return dirs;
}
