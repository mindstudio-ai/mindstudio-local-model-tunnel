// Read the local API interface config from the compiled api.json file.
//
// Called via readConfig() on every get-config poll request — reads fresh
// from disk so local changes are reflected immediately.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppConfig } from '../config/types';

export interface ApiConfigBundle {
  name: string;
  description?: string;
  routes: Array<{
    method: string;
    path: string;
    handler: string;
    summary?: string;
    description?: string;
    tag?: string;
    params?: Record<string, unknown>;
  }>;
}

/**
 * Read the API interface config from the local dist files.
 *
 * @param projectRoot  Absolute path to the project root
 * @param appConfig    The parsed AppConfig
 * @returns The API config ready to send to the platform
 * @throws If no API interface is configured or the file is missing/invalid
 */
export function readApiConfig(
  projectRoot: string,
  appConfig: AppConfig,
): ApiConfigBundle {
  const apiInterface = appConfig.interfaces.find(
    (i) => i.type === 'api' && i.enabled !== false,
  );
  if (!apiInterface) {
    throw new Error('No API interface config found');
  }

  const apiJsonPath = join(projectRoot, apiInterface.path);
  const raw = readFileSync(apiJsonPath, 'utf-8');
  const parsed = JSON.parse(raw);

  if (!parsed.api) {
    throw new Error('No API interface config found');
  }

  return parsed.api;
}
