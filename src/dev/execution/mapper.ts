/**
 * Dev-tunnel mapper execution.
 *
 * A mapper (`<slug>.mapper.ts`, a defineMapper executor) turns each raw object
 * entering a data source into documents. In production the platform runs the
 * compiled bundle as an execution frame; in dev the platform sends the same
 * frame through the tunnel (`DevRequest.mapper`) and this module transpiles
 * and runs the local source — for a dev-session `Source.add()`, and for
 * `remy-admin datasources map test --dev`, which shows outcomes without
 * ingesting anything.
 *
 * The `test-mapper` stdin command runs the mapper directly over objects the
 * caller supplies (each with a readable `url`), the same way test-jewel runs a
 * jewel: transpile, execute, hand the record straight back.
 */

import { randomUUID } from 'node:crypto';

import { executeMethod } from './executor';
import { Transpiler } from './transpiler';
import { fetchCallbackToken } from '../api';
import { getApiBaseUrl, getDbWsUrl } from '../../config';
import { log } from '../logging/logger';
import { logMapperExecution } from '../logging/request-log';
import type { AppDataSource, DevSession } from '../config/types';

// The synthetic identity a platform-triggered invocation runs as (cron,
// webhook, email — and every mapper frame). Keep in sync with SYSTEM_USER_ID
// in youai-api (src/common/Db/v2Apps/_helpers/constants.ts) — same mirroring
// pattern as JEWEL_USER_NAMESPACE in ./jewel.ts.
//
// Deliberately independent of the app's auth table. A system-gated method is
// normal in an app with no users at all, so dev has to be able to produce this
// identity without one; the poll path gets it from the platform, and this is
// how the direct path gets it.
export const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';
export const SYSTEM_ROLE = 'system';

export const SYSTEM_AUTH: DevSession['auth'] = {
  userId: SYSTEM_USER_ID,
  roleAssignments: [{ userId: SYSTEM_USER_ID, roleName: SYSTEM_ROLE }],
};

export interface RunMapperOpts {
  appId: string;
  sessionId: string;
  databases: DevSession['databases'];
  transpiler: Transpiler;
  projectRoot: string;
  dataSource: AppDataSource;
  /** The executor's params: `{ v: 1, objects, timeoutMs? }`. */
  input: unknown;
  authorizationToken: string;
  secrets?: Record<string, string>;
  requestId?: string;
}

export interface MapperRunResult {
  success: boolean;
  /** The MapRunRecord, or undefined when the run itself failed. */
  record?: Record<string, unknown>;
  error?: { message: string; stack?: string };
  stdout?: string[];
  stats?: { memoryUsedBytes: number; executionTimeMs: number };
  duration: number;
}

/**
 * Transpile and run the data source's mapper over the given params, as the
 * system user. Shared by the poll-path dispatch and the direct test.
 */
export async function runMapper(opts: RunMapperOpts): Promise<MapperRunResult> {
  const { dataSource } = opts;
  const startedAt = Date.now();
  const requestId = opts.requestId ?? randomUUID();

  const transpiledPath = await opts.transpiler.transpile(
    dataSource.mapper.path,
  );
  const result = await executeMethod({
    requestId,
    transpiledPath,
    methodExport: dataSource.mapper.export ?? 'default',
    input: opts.input,
    auth: SYSTEM_AUTH,
    databases: opts.databases,
    authorizationToken: opts.authorizationToken,
    apiBaseUrl: getApiBaseUrl(),
    dbWsUrl: getDbWsUrl(),
    projectRoot: opts.projectRoot,
    sessionId: opts.sessionId,
    secrets: opts.secrets,
  });

  // defineMapper executors never throw — a failed run here means infra
  // (transpile error, worker death) or a non-mapper export.
  const output = result.output as Record<string, unknown> | undefined;
  const isRecord =
    result.success &&
    !!output &&
    typeof output === 'object' &&
    output.v === 1 &&
    Array.isArray(output.outcomes);

  return {
    success: isRecord,
    record: isRecord ? output : undefined,
    error: isRecord
      ? undefined
      : (result.error ?? {
          message:
            'mapper returned a non-MapRunRecord value. Is the export a defineMapper() executor?',
        }),
    stdout: result.stdout,
    stats: result.stats,
    duration: Date.now() - startedAt,
  };
}

export interface RunMapperTestOpts {
  appId: string;
  sessionId: string;
  databases: DevSession['databases'];
  transpiler: Transpiler;
  projectRoot: string;
  dataSource: AppDataSource;
  /** `{ key, url, size?, contentType?, etag?, lastModified?, metadata? }` each. */
  objects: unknown[];
  timeoutMs?: number;
}

export interface MapperTestResult {
  success: boolean;
  record?: Record<string, unknown>;
  error?: string;
  stdout?: string[];
  duration: number;
}

/**
 * Run the mapper over caller-supplied objects and return the record. Never
 * throws — failures collapse into `{ success: false, error }`.
 */
export async function runMapperTest(
  opts: RunMapperTestOpts,
): Promise<MapperTestResult> {
  const { dataSource } = opts;
  const startedAt = Date.now();
  const requestId = randomUUID();

  log.info('mapper', 'Mapper test started', {
    dataSource: dataSource.slug,
    mapperPath: dataSource.mapper.path,
    objects: opts.objects.length,
    sessionId: opts.sessionId,
  });

  let result: MapperRunResult;
  try {
    const { authorizationToken, secrets } = await fetchCallbackToken(
      opts.appId,
      opts.sessionId,
    );
    result = await runMapper({
      appId: opts.appId,
      sessionId: opts.sessionId,
      databases: opts.databases,
      transpiler: opts.transpiler,
      projectRoot: opts.projectRoot,
      dataSource,
      input: {
        v: 1,
        objects: opts.objects,
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      },
      authorizationToken,
      secrets,
      requestId,
    });
  } catch (err) {
    result = {
      success: false,
      error: { message: err instanceof Error ? err.message : 'Unknown error' },
      duration: Date.now() - startedAt,
    };
  }

  const duration = Date.now() - startedAt;
  logMapperExecution({
    sessionId: opts.sessionId,
    dataSource: dataSource.slug,
    mapperPath: dataSource.mapper.path,
    requestId,
    objects: opts.objects.length,
    record: result.record,
    error: result.error?.message,
    stdout: result.stdout,
    duration,
  });

  if (!result.success) {
    log.warn('mapper', 'Mapper test failed', {
      dataSource: dataSource.slug,
      error: result.error?.message,
      duration,
      sessionId: opts.sessionId,
    });
    return {
      success: false,
      error: result.error?.message ?? 'Mapper test failed',
      stdout: result.stdout,
      duration,
    };
  }

  log.info('mapper', 'Mapper test complete', {
    dataSource: dataSource.slug,
    objects: opts.objects.length,
    duration,
    sessionId: opts.sessionId,
  });
  return {
    success: true,
    record: result.record,
    stdout: result.stdout,
    duration,
  };
}
