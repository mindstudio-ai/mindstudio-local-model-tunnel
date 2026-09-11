// Unified config reader — assembles all local config slices into one bundle.
//
// The bundle is PUSHED to the platform at session start (the dev session IS a
// release; see `startDevSession`), so whatever we resolve here is what the
// platform serves for the whole session. Each slice is read independently: a
// slice the app never declared is legitimately `null`. But a slice that IS
// declared and fails to resolve — compiled files not materialized yet after a
// snapshot resume, or `mindstudio.json` caught mid-write — must NOT be shipped
// as a healthy release, or the platform answers `no_agent_config` (RPT-1232)
// until the next restart. `readConfig` reports those as `unresolvedDeclared`,
// and `resolveConfigSnapshot` retries them before the caller publishes.

import { readAgentConfig, type AgentConfigBundle } from './agent-config';
import { readVoiceConfig, type VoiceConfigBundle } from './voice-config';
import { readApiConfig, type ApiConfigBundle } from './api-config';
import { readMcpConfig, type McpConfigBundle } from './mcp-config';
import { log } from '../logging/logger';
import { detectAppConfig } from '../config/app-config';
import type { AppConfig, AppAuthConfig } from '../config/types';

export type InterfaceType = 'agent' | 'voice' | 'api' | 'mcp';

// Interfaces that drive a platform-side loop the preview can't function
// without. A declared-but-unresolved one of these blocks the config push (the
// others only warn); see `resolveConfigSnapshot` and `startSession`.
const LOOP_CRITICAL: readonly InterfaceType[] = ['agent', 'voice'];

export function hasLoopCriticalGap(
  unresolvedDeclared: InterfaceType[],
): boolean {
  return unresolvedDeclared.some((t) => LOOP_CRITICAL.includes(t));
}

export interface ConfigBundle {
  name: string;
  auth: AppAuthConfig | null;
  agent: AgentConfigBundle | null;
  voice: VoiceConfigBundle | null;
  api: ApiConfigBundle | null;
  mcp: McpConfigBundle | null;
}

export interface ConfigReadResult {
  bundle: ConfigBundle;
  /**
   * Interface types declared (and enabled) in `mindstudio.json` whose config
   * could not be resolved on this read — a transient miss, not a legitimate
   * "not configured". Empty on a healthy read.
   */
  unresolvedDeclared: InterfaceType[];
}

// Read one slice. A throw when the interface is NOT declared is expected and
// stays at debug; a throw when it IS declared is a real transient failure —
// flag it and log at warn so it's visible in tunnel.log and future bundles.
function readSlice<T>(
  type: InterfaceType,
  appConfig: AppConfig,
  read: () => T,
  unresolvedDeclared: InterfaceType[],
): T | null {
  const declared = appConfig.interfaces.some(
    (i) => i.type === type && i.enabled !== false,
  );
  try {
    return read();
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (declared) {
      unresolvedDeclared.push(type);
      log.warn('config', `${type} interface declared but failed to resolve`, {
        error,
      });
    } else {
      log.debug('config', `${type} config not available`, { error });
    }
    return null;
  }
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
): ConfigReadResult {
  const unresolvedDeclared: InterfaceType[] = [];

  const agent = readSlice(
    'agent',
    appConfig,
    () => readAgentConfig(projectRoot, appConfig),
    unresolvedDeclared,
  );
  const voice = readSlice(
    'voice',
    appConfig,
    () => readVoiceConfig(projectRoot, appConfig),
    unresolvedDeclared,
  );
  const api = readSlice(
    'api',
    appConfig,
    () => readApiConfig(projectRoot, appConfig),
    unresolvedDeclared,
  );
  const mcp = readSlice(
    'mcp',
    appConfig,
    () => readMcpConfig(projectRoot, appConfig),
    unresolvedDeclared,
  );

  return {
    bundle: {
      name: appConfig.name,
      auth: appConfig.auth ?? null,
      agent,
      voice,
      api,
      mcp,
    },
    unresolvedDeclared,
  };
}

/**
 * Resolve the config snapshot to push at session start, retrying while a
 * loop-critical interface (agent/voice) is declared but unresolved.
 *
 * This restores what the old per-request `get-config` poll gave for free: a
 * transient miss (files still materializing after a snapshot resume, or the
 * manifest mid atomic-rename) self-corrects within a few hundred ms instead of
 * sticking for the whole session. The manifest is re-read each attempt so a
 * mid-write that settles is picked up. If the gap outlasts the retry window the
 * caller should defer the start (headless falls back to its 15s degraded loop).
 */
export async function resolveConfigSnapshot(
  cwd: string,
  appConfig: AppConfig,
  attempts = 5,
  delayMs = 120,
): Promise<{ appConfig: AppConfig } & ConfigReadResult> {
  let current = appConfig;
  let result = readConfig(cwd, current);

  for (
    let i = 1;
    i < attempts && hasLoopCriticalGap(result.unresolvedDeclared);
    i++
  ) {
    await new Promise((r) => setTimeout(r, delayMs));
    current = detectAppConfig(cwd) ?? current;
    result = readConfig(cwd, current);
  }

  return { appConfig: current, ...result };
}
