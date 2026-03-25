// Platform API client for dev sessions.
//
// All endpoints are under /_internal/v2/apps/{appId}/dev/.
// Auth: Bearer token (API key), plus x-dev-session header for session-scoped endpoints.
// The dev session IS a release — sessionId and releaseId are the same UUID.

import { getApiKey, getApiBaseUrl } from '../config';
import { log } from './logging/logger';
import type { DevSession, DevRequest, DevResult, SyncSchemaResponse } from './config/types';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getHeaders(sessionId?: string): Record<string, string> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Not authenticated. Run mindstudio-local to set up.');
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  if (sessionId) headers['x-dev-session'] = sessionId;

  return headers;
}

function basePath(appId: string): string {
  return `${getApiBaseUrl()}/_internal/v2/apps/${appId}/dev`;
}

/**
 * Generic API request with consistent logging, timing, and error handling.
 * Returns null for 204 responses. Throws on non-ok status.
 */
async function apiRequest<T>(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<T> {
  const start = Date.now();
  const logTag = `${method} ${url.replace(getApiBaseUrl(), '')}`;

  const response = await fetch(url, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const duration = Date.now() - start;

  if (response.status === 204) {
    log.debug(`api ${logTag} → 204 (${duration}ms)`);
    return null as T;
  }

  if (!response.ok) {
    const error = await response.text();
    log.error(`api ${logTag} → ${response.status} (${duration}ms)`, { error });
    throw new ApiError(`${logTag} failed: ${response.status} ${error}`, response.status);
  }

  const data = (await response.json()) as T;
  log.info(`api ${logTag} → ${response.status} (${duration}ms)`);
  return data;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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

  return apiRequest<DevSession>('POST', `${basePath(appId)}/manage/start`, getHeaders(), body);
}

export async function stopDevSession(
  appId: string,
  sessionId: string,
): Promise<void> {
  await apiRequest<void>('POST', `${basePath(appId)}/manage/stop`, getHeaders(sessionId));
}

export async function pollDevRequest(
  appId: string,
  sessionId: string,
  proxyUrl?: string,
): Promise<DevRequest | null> {
  const url = proxyUrl
    ? `${basePath(appId)}/poll?proxyUrl=${encodeURIComponent(proxyUrl)}`
    : `${basePath(appId)}/poll`;

  try {
    return await apiRequest<DevRequest | null>('GET', url, getHeaders(sessionId));
  } catch (err) {
    // Re-throw as DevPollError so the runner can detect session expiry (404)
    if (err instanceof ApiError) {
      throw new DevPollError(err.message, err.statusCode);
    }
    throw err;
  }
}

export async function submitDevResult(
  appId: string,
  sessionId: string,
  requestId: string,
  result: DevResult,
): Promise<void> {
  await apiRequest<void>(
    'POST',
    `${basePath(appId)}/result/${requestId}`,
    getHeaders(sessionId),
    result,
  );
}

export async function syncSchema(
  appId: string,
  sessionId: string,
  tables: Array<{ name: string; source: string }>,
): Promise<SyncSchemaResponse> {
  return apiRequest<SyncSchemaResponse>(
    'POST',
    `${basePath(appId)}/manage/sync-schema`,
    getHeaders(sessionId),
    { tables },
  );
}

export async function resetDevDatabase(
  appId: string,
  sessionId: string,
  mode: 'snapshot' | 'truncate' = 'snapshot',
): Promise<DevSession['databases']> {
  const data = await apiRequest<{ databases: DevSession['databases'] }>(
    'POST',
    `${basePath(appId)}/manage/reset?mode=${mode}`,
    getHeaders(sessionId),
  );
  return data.databases;
}

export async function impersonate(
  appId: string,
  sessionId: string,
  roles: string[] | null,
): Promise<{ roles: string[] | null }> {
  return apiRequest<{ roles: string[] | null }>(
    'POST',
    `${basePath(appId)}/manage/impersonate`,
    getHeaders(sessionId),
    { roles: roles && roles.length > 0 ? roles : null },
  );
}

export async function refreshContext(
  appId: string,
  sessionId: string,
): Promise<Record<string, unknown>> {
  const data = await apiRequest<{ clientContext: Record<string, unknown> }>(
    'POST',
    `${basePath(appId)}/manage/refresh-context`,
    getHeaders(sessionId),
  );
  return data.clientContext;
}

// Fetch a callback token for one-off executions (scenarios, etc.)
// that don't come from the poll loop.
export async function fetchCallbackToken(
  appId: string,
  sessionId: string,
): Promise<string> {
  const data = await apiRequest<{ authorizationToken: string }>(
    'POST',
    `${basePath(appId)}/manage/token`,
    getHeaders(sessionId),
  );
  return data.authorizationToken;
}

export async function getUploadUrl(
  appId: string,
  sessionId: string,
  extension: string,
  contentType: string,
): Promise<{ uploadUrl: string; uploadFields: Record<string, string>; publicUrl: string }> {
  return apiRequest(
    'POST',
    `${basePath(appId)}/manage/upload`,
    getHeaders(sessionId),
    { extension, contentType },
  );
}

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/** API request error with HTTP status code. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Poll-specific error — runner checks statusCode to detect session expiry (404). */
export class DevPollError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'DevPollError';
  }
}
