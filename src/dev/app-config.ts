// Detect and parse mindstudio.json from the working directory.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { AppConfig, WebInterfaceConfig } from './types';

/**
 * Read and parse mindstudio.json from the given directory.
 * Returns null if not found or invalid.
 */
export function detectAppConfig(cwd: string = process.cwd()): AppConfig | null {
  const appJsonPath = join(cwd, 'mindstudio.json');
  if (!existsSync(appJsonPath)) {
    return null;
  }

  try {
    const raw = readFileSync(appJsonPath, 'utf-8');
    const parsed = JSON.parse(raw);

    // Minimum validation: must have name and methods
    if (!parsed.name || !Array.isArray(parsed.methods)) {
      return null;
    }

    return {
      appId: parsed.appId,
      name: parsed.name,
      description: parsed.description,
      tables: parsed.tables ?? [],
      methods: parsed.methods,
      interfaces: parsed.interfaces ?? [],
    };
  } catch {
    return null;
  }
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
      continue;
    }

    try {
      const source = readFileSync(filePath, 'utf-8');
      // Use the export name as the table name for error reporting
      const name = table.export;
      results.push({ name, source });
    } catch {
      // Skip unreadable files
    }
  }

  return results;
}
