/**
 * NDJSON request log for method and scenario executions.
 * Thin wrapper around NdjsonLog.
 */

import { NdjsonLog } from './ndjson-log';
import type { DevSession, AppScenario } from '../config/types';
import type { ExecuteMethodResult } from '../execution/executor';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MethodLogEntry {
  requestId: string;
  sessionId: string;
  methodExport: string;
  methodPath: string;
  input: unknown;
  roleOverride?: string[];
  authorizationToken: string;
  /** The full globalThis.ai context at execution time. */
  context?: { auth: unknown; databases: unknown };
  databases: DevSession['databases'];
  result: ExecuteMethodResult;
  duration: number;
  timing?: {
    transpileMs: number;
    executeMs: number;
    submitMs: number;
    totalMs: number;
  };
}

export interface ScenarioLogEntry {
  sessionId: string;
  scenario: AppScenario;
  databases: DevSession['databases'];
  result: ExecuteMethodResult | null;
  infrastructureError?: string;
  duration: number;
}

// ---------------------------------------------------------------------------
// Log instance
// ---------------------------------------------------------------------------

const ndjsonLog = new NdjsonLog('requests.ndjson');

export function initRequestLog(projectRoot: string): void {
  ndjsonLog.init(projectRoot);
}

export function logMethodExecution(entry: MethodLogEntry): void {
  ndjsonLog.append({
    ts: Date.now(),
    level: 'info',
    module: 'execution',
    msg: entry.result.success ? 'Method complete' : 'Method failed',
    type: 'method',
    requestId: entry.requestId,
    sessionId: entry.sessionId,
    method: entry.methodExport,
    path: entry.methodPath,
    input: entry.input,
    roleOverride: entry.roleOverride ?? null,
    authorizationToken: entry.authorizationToken,
    databases: entry.databases,
    success: entry.result.success,
    output: entry.result.output ?? null,
    error: entry.result.error ?? null,
    stdout: entry.result.stdout ?? [],
    context: entry.context ?? null,
    duration: entry.duration,
    timing: entry.timing ?? null,
    stats: entry.result.stats ?? null,
  });
}

export function logScenarioExecution(entry: ScenarioLogEntry): void {
  ndjsonLog.append({
    ts: Date.now(),
    level: 'info',
    module: 'execution',
    msg: (entry.result?.success ?? false) ? 'Scenario complete' : 'Scenario failed',
    type: 'scenario',
    sessionId: entry.sessionId,
    scenario: {
      id: entry.scenario.id,
      name: entry.scenario.name ?? entry.scenario.export,
      export: entry.scenario.export,
      path: entry.scenario.path,
    },
    databases: entry.databases,
    success: entry.result?.success ?? false,
    output: entry.result?.output ?? null,
    error:
      entry.result?.error ??
      (entry.infrastructureError
        ? { message: entry.infrastructureError }
        : null),
    stdout: entry.result?.stdout ?? [],
    duration: entry.duration,
    stats: entry.result?.stats ?? null,
  });
}

export function closeRequestLog(): void {
  ndjsonLog.close();
}
