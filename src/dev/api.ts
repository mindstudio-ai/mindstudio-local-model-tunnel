// Platform API client for dev sessions.
//
// All endpoints are under /_internal/v2/apps/{appId}/dev/.
// Auth: Bearer token (API key) for start, x-dev-session header for everything else.
// The dev session IS a release — sessionId and releaseId are the same UUID.

import { getApiKey, getApiBaseUrl, getUserId } from '../config';
import { log } from './logger';
import type { DevSession, DevRequest, DevResult, SyncSchemaResponse } from './types';

function getHeaders(): Record<string, string> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Not authenticated. Run mindstudio-local to set up.');
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  const userId = getUserId();
  if (userId) {
    headers['x-user-id'] = userId;
  }

  return headers;
}

function getDevHeaders(sessionId: string): Record<string, string> {
  return {
    ...getHeaders(),
    'x-dev-session': sessionId,
  };
}

function basePath(appId: string): string {
  return `${getApiBaseUrl()}/_internal/v2/apps/${appId}/dev`;
}

export async function startDevSession(
  appId: string,
  opts?: {
    branch?: string;
    proxyUrl?: string;
    methods?: Array<{ id: string; export: string; path: string }>;
  },
): Promise<DevSession> {
  const body: Record<string, unknown> = {};
  if (opts?.branch) body.branch = opts.branch;
  if (opts?.proxyUrl) body.proxyUrl = opts.proxyUrl;
  if (opts?.methods) body.methods = opts.methods;

  const start = Date.now();
  log.debug('api POST /dev/manage/start', { appId, branch: opts?.branch, methodCount: opts?.methods?.length });

  const response = await fetch(`${basePath(appId)}/manage/start`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  const duration = Date.now() - start;

  if (!response.ok) {
    const error = await response.text();
    log.error(`api POST /dev/manage/start → ${response.status} (${duration}ms)`, { error });
    throw new Error(`Failed to start dev session: ${response.status} ${error}`);
  }

  const data = (await response.json()) as DevSession;
  log.info(`api POST /dev/manage/start → ${response.status} (${duration}ms)`, { sessionId: data.sessionId, branch: data.branch });
  return data;
}

export async function stopDevSession(
  appId: string,
  sessionId: string,
): Promise<void> {
  const start = Date.now();
  log.debug('api POST /dev/manage/stop', { appId, sessionId });

  const response = await fetch(`${basePath(appId)}/manage/stop`, {
    method: 'POST',
    headers: getDevHeaders(sessionId),
  });

  const duration = Date.now() - start;

  if (!response.ok) {
    const error = await response.text();
    log.error(`api POST /dev/manage/stop → ${response.status} (${duration}ms)`, { error });
    throw new Error(`Failed to stop dev session: ${response.status} ${error}`);
  }

  log.info(`api POST /dev/manage/stop → ${response.status} (${duration}ms)`);
}

export async function pollDevRequest(
  appId: string,
  sessionId: string,
  proxyUrl?: string,
): Promise<DevRequest | null> {
  const url = proxyUrl
    ? `${basePath(appId)}/poll?proxyUrl=${encodeURIComponent(proxyUrl)}`
    : `${basePath(appId)}/poll`;

  const start = Date.now();

  const response = await fetch(url, {
    method: 'GET',
    headers: getDevHeaders(sessionId),
  });

  const duration = Date.now() - start;

  if (response.status === 204) {
    log.debug(`api GET /dev/poll → 204 (${duration}ms)`);
    return null;
  }

  if (!response.ok) {
    const error = await response.text();
    log.error(`api GET /dev/poll → ${response.status} (${duration}ms)`, { error });
    throw new DevPollError(
      `Poll failed: ${response.status} ${error}`,
      response.status,
    );
  }

  const data = (await response.json()) as DevRequest;
  log.info(`api GET /dev/poll → 200 (${duration}ms)`, { requestId: data.requestId, method: data.methodExport });
  return data;
}

export async function submitDevResult(
  appId: string,
  sessionId: string,
  requestId: string,
  result: DevResult,
): Promise<void> {
  const start = Date.now();
  log.debug('api POST /dev/result', { requestId, success: result.success });

  const response = await fetch(`${basePath(appId)}/result/${requestId}`, {
    method: 'POST',
    headers: getDevHeaders(sessionId),
    body: JSON.stringify(result),
  });

  const duration = Date.now() - start;

  if (!response.ok) {
    const error = await response.text();
    log.error(`api POST /dev/result/${requestId} → ${response.status} (${duration}ms)`, { error });
    throw new Error(
      `Result submission failed: ${response.status} ${error}`,
    );
  }

  log.info(`api POST /dev/result → ${response.status} (${duration}ms)`, { requestId, success: result.success });
}

export async function syncSchema(
  appId: string,
  sessionId: string,
  tables: Array<{ name: string; source: string }>,
): Promise<SyncSchemaResponse> {
  const start = Date.now();
  log.debug('api POST /dev/manage/sync-schema', { tableCount: tables.length, names: tables.map((t) => t.name) });

  const response = await fetch(`${basePath(appId)}/manage/sync-schema`, {
    method: 'POST',
    headers: getDevHeaders(sessionId),
    body: JSON.stringify({ tables }),
  });

  const duration = Date.now() - start;

  if (!response.ok) {
    const error = await response.text();
    log.error(`api POST /dev/manage/sync-schema → ${response.status} (${duration}ms)`, { error });
    throw new Error(`Schema sync failed: ${response.status} ${error}`);
  }

  const data = (await response.json()) as SyncSchemaResponse;
  log.info(`api POST /dev/manage/sync-schema → ${response.status} (${duration}ms)`, {
    created: data.created,
    altered: data.altered,
    errors: data.errors,
  });
  return data;
}

/** Custom error class to expose HTTP status code from poll failures. */
export class DevPollError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'DevPollError';
  }
}
