// Unified config reader — assembles all local config slices into one bundle.
//
// Called on get-config poll requests. Each slice is read independently;
// a missing or broken interface returns null for that key without
// failing the whole response.

import { readAgentConfig, type AgentConfigBundle } from './agent-config';
import { readApiConfig, type ApiConfigBundle } from './api-config';
import { log } from '../logging/logger';
import type { AppConfig, AppAuthConfig } from '../config/types';

export interface ConfigBundle {
  name: string;
  auth: AppAuthConfig | null;
  agent: AgentConfigBundle | null;
  api: ApiConfigBundle | null;
}

/**
 * Read all local config slices from the project.
 *
 * @param projectRoot  Absolute path to the project root
 * @param appConfig    The parsed AppConfig from mindstudio.json
 */
export function readConfig(
  projectRoot: string,
  appConfig: AppConfig,
): ConfigBundle {
  let agent: AgentConfigBundle | null = null;
  try {
    agent = readAgentConfig(projectRoot, appConfig);
  } catch (err) {
    log.debug('config', 'Agent config not available', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  let api: ApiConfigBundle | null = null;
  try {
    api = readApiConfig(projectRoot, appConfig);
  } catch (err) {
    log.debug('config', 'API config not available', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    name: appConfig.name,
    auth: appConfig.auth ?? null,
    agent,
    api,
  };
}
