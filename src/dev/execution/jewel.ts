/**
 * Dev-tunnel jewel testing.
 *
 * A jewel (`foo.jewel.ts` beside method `foo.ts`) is an agentic shadow
 * companion: given the subject a human was looking at, it proposes the method
 * input it would have submitted. In production, deployed jewels shadow real
 * human invocations and their (proposed, actual) pairs land in the platform's
 * pair ledger. In dev there is no ambient shadowing — dev traffic is
 * synthetic and would pollute the ledger — so jewels are exercised directly
 * via the `test-jewel` command: transpile and run the jewel source (the same
 * machinery scenarios use) against a caller-chosen input, and hand the pair
 * record straight back. Nothing is written to the platform.
 *
 * Two test modes, mirroring the defineJewel executor's params:
 *   { humanInput } — a full shadow-style run: the jewel derives the subject
 *     via its projection, proposes, and grades against humanInput as ground
 *     truth. The record carries a verdict.
 *   { subject }    — an eval run: propose only, ungraded.
 */

import { createHash, randomUUID } from 'node:crypto';

import { executeMethod } from './executor';
import { Transpiler } from './transpiler';
import { fetchCallbackToken } from '../api';
import { getApiBaseUrl, getDbWsUrl } from '../../config';
import { log } from '../logging/logger';
import { logJewelExecution } from '../logging/request-log';
import type { AppMethod, DevSession } from '../config/types';

// Keep in sync with JEWEL_USER_NAMESPACE in youai-api
// (src/common/Db/v2Apps/AppReleasesDao/compilers/jewels.ts) — the jewel's
// identity must be the same deterministic uuidv5(appId) the platform uses.
const JEWEL_USER_NAMESPACE = '9f2d7c8e-3a41-5b96-8d05-6e1c4f7a2b90';

/** RFC 4122 v5 (sha1) — matches the uuid package's v5(name, namespace). */
function uuidv5(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const bytes = createHash('sha1')
    .update(Buffer.concat([ns, Buffer.from(name, 'utf8')]))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function jewelUserIdForApp(appId: string): string {
  return uuidv5(appId, JEWEL_USER_NAMESPACE);
}

export interface RunJewelTestOpts {
  appId: string;
  sessionId: string;
  databases: DevSession['databases'];
  transpiler: Transpiler;
  projectRoot: string;
  /** The method whose jewel to run — must carry a `jewel` manifest entry. */
  method: AppMethod;
  /** Exactly one of humanInput | subject (validated by the caller). */
  humanInput?: unknown;
  subject?: unknown;
}

export interface JewelTestResult {
  /** False only when no pair record could be produced at all. */
  success: boolean;
  /** The JewelPairRecord, or an infra-marker record when the run itself
   *  failed (transpile error, worker death, non-jewel export). */
  pair: Record<string, unknown>;
  stdout?: string[];
  duration: number;
}

/**
 * Transpile and run the method's jewel against the given input, returning
 * the pair record. Never throws — failures collapse into an infra-marker
 * pair record, mirroring the platform's shadow-trigger contract.
 */
export async function runJewelTest(
  opts: RunJewelTestOpts,
): Promise<JewelTestResult> {
  const { method } = opts;
  const jewel = method.jewel!;
  const jewelUserId = jewelUserIdForApp(opts.appId);
  const jewelRequestId = randomUUID();
  const startedAt = Date.now();
  const mode = opts.humanInput !== undefined ? 'shadow' : 'eval';

  log.info('jewel', 'Jewel test started', {
    method: method.id,
    jewelPath: jewel.path,
    mode,
    sessionId: opts.sessionId,
  });

  const infraMarker = (message: string): Record<string, unknown> => ({
    v: 1,
    mode,
    error: { phase: 'infra', message },
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
  });

  let pair: Record<string, unknown>;
  let stdout: string[] | undefined;
  try {
    const { authorizationToken, secrets } = await fetchCallbackToken(
      opts.appId,
      opts.sessionId,
      { jewelDescended: true },
    );
    const transpiledPath = await opts.transpiler.transpile(jewel.path);

    const result = await executeMethod({
      requestId: jewelRequestId,
      transpiledPath,
      methodExport: jewel.export ?? 'default',
      input:
        mode === 'shadow'
          ? { humanInput: opts.humanInput }
          : { subject: opts.subject },
      // The jewel runs as the app's deterministic jewel user with the
      // manifest-declared roles — same identity a deployed shadow runs under.
      auth: {
        userId: jewelUserId,
        roleAssignments: (jewel.roles ?? []).map((roleName) => ({
          userId: jewelUserId,
          roleName,
        })),
      },
      databases: opts.databases,
      authorizationToken,
      apiBaseUrl: getApiBaseUrl(),
      dbWsUrl: getDbWsUrl(),
      projectRoot: opts.projectRoot,
      sessionId: opts.sessionId,
      secrets,
    });
    stdout = result.stdout;

    // defineJewel executors never throw — a failed run here means infra
    // (transpile error, worker death) or a non-jewel export.
    const output = result.output as Record<string, unknown> | undefined;
    if (
      result.success &&
      output &&
      typeof output === 'object' &&
      output.v === 1 &&
      typeof output.mode === 'string'
    ) {
      pair = output;
    } else {
      pair = infraMarker(
        result.error?.message ?? 'jewel returned a non-JewelPairRecord value',
      );
    }
  } catch (err) {
    pair = infraMarker(err instanceof Error ? err.message : 'Unknown error');
  }

  const duration = Date.now() - startedAt;
  const verdict = (pair.verdict as string | undefined) ?? null;
  const error = pair.error as { message?: string } | undefined;

  logJewelExecution({
    sessionId: opts.sessionId,
    methodId: method.id,
    jewelPath: jewel.path,
    jewelRequestId,
    pair,
    stdout,
    duration,
  });

  if (error) {
    log.warn('jewel', 'Jewel test failed', {
      method: method.id,
      error: error.message,
      duration,
      sessionId: opts.sessionId,
    });
  } else {
    log.info('jewel', 'Jewel test complete', {
      method: method.id,
      mode,
      verdict,
      duration,
      sessionId: opts.sessionId,
    });
  }

  return { success: true, pair, stdout, duration };
}
