// API functions for dev session lifecycle.
// Follows patterns from src/api.ts.

import { getApiKey, getApiBaseUrl, getUserId } from '../config';
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
  branch?: string,
): Promise<DevSession> {
  const response = await fetch(`${basePath(appId)}/manage/start`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(branch ? { branch } : {}),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to start dev session: ${response.status} ${error}`);
  }

  return (await response.json()) as DevSession;
}

export async function stopDevSession(
  appId: string,
  sessionId: string,
): Promise<void> {
  const response = await fetch(`${basePath(appId)}/manage/stop`, {
    method: 'POST',
    headers: getDevHeaders(sessionId),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to stop dev session: ${response.status} ${error}`);
  }
}

export async function pollDevRequest(
  appId: string,
  sessionId: string,
  proxyUrl?: string,
): Promise<DevRequest | null> {
  const url = proxyUrl
    ? `${basePath(appId)}/poll?proxyUrl=${encodeURIComponent(proxyUrl)}`
    : `${basePath(appId)}/poll`;
  const response = await fetch(url, {
    method: 'GET',
    headers: getDevHeaders(sessionId),
  });

  if (response.status === 204) {
    return null;
  }

  if (!response.ok) {
    const error = await response.text();
    throw new DevPollError(
      `Poll failed: ${response.status} ${error}`,
      response.status,
    );
  }

  return (await response.json()) as DevRequest;
}

export async function submitDevResult(
  appId: string,
  sessionId: string,
  requestId: string,
  result: DevResult,
): Promise<void> {
  const response = await fetch(`${basePath(appId)}/result/${requestId}`, {
    method: 'POST',
    headers: getDevHeaders(sessionId),
    body: JSON.stringify(result),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(
      `Result submission failed: ${response.status} ${error}`,
    );
  }
}

export async function syncSchema(
  appId: string,
  sessionId: string,
  tables: Array<{ name: string; source: string }>,
): Promise<SyncSchemaResponse> {
  const response = await fetch(`${basePath(appId)}/manage/sync-schema`, {
    method: 'POST',
    headers: getDevHeaders(sessionId),
    body: JSON.stringify({ tables }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Schema sync failed: ${response.status} ${error}`);
  }

  return (await response.json()) as SyncSchemaResponse;
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
