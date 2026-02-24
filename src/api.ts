import { getApiKey, getApiBaseUrl } from './config';

export interface LocalModelRequest {
  id: string;
  organizationId: string;
  modelId: string;
  requestType: 'llm_chat' | 'image_generation' | 'video_generation';
  payload: {
    messages?: Array<{ role: string; content: string }>;
    prompt?: string;
    temperature?: number;
    maxTokens?: number;
    config?: Record<string, unknown>;
  };
  createdAt: number;
}

function getHeaders(): Record<string, string> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Not authenticated. Run: mindstudio-local auth');
  }

  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

export async function pollForRequest(
  modelIds: string[],
): Promise<LocalModelRequest | null> {
  const baseUrl = getApiBaseUrl();
  const modelIdsParam = modelIds.join(',');

  const response = await fetch(
    `${baseUrl}/v1/local-models/poll?modelIds=${encodeURIComponent(modelIdsParam)}`,
    {
      method: 'GET',
      headers: getHeaders(),
    },
  );

  if (response.status === 204) {
    return null;
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Poll failed: ${response.status} ${error}`);
  }
  const data = (await response.json()) as { request: LocalModelRequest };
  return data.request;
}

/**
 * Submit a progress update for a running request.
 * @param type - 'chunk' for streaming text content, 'log' for raw log lines
 */
export async function submitProgress(
  requestId: string,
  content: string,
  type: 'chunk' | 'log' = 'chunk',
): Promise<void> {
  const baseUrl = getApiBaseUrl();

  const response = await fetch(
    `${baseUrl}/v1/local-models/requests/${requestId}/progress`,
    {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ type, content }),
    },
  );

  if (!response.ok) {
    console.warn(`Progress update failed: ${response.status}`);
  }
}


/**
 * Result for text/chat completions
 */
export interface TextResult {
  content?: string;
  usage?: { promptTokens: number; completionTokens: number };
}

/**
 * Result for image generation
 */
export interface ImageResult {
  /** Base64-encoded image data */
  imageBase64: string;
  /** MIME type (e.g., "image/png") */
  mimeType: string;
  /** Seed used for generation */
  seed?: number;
}

/**
 * Result for video generation
 */
export interface VideoResult {
  /** Base64-encoded video data */
  videoBase64: string;
  /** MIME type (e.g., "video/webp", "video/mp4") */
  mimeType: string;
  /** Duration in seconds */
  duration?: number;
  /** Frames per second */
  fps?: number;
  /** Seed used for generation */
  seed?: number;
}

/**
 * Combined result type
 */
export type RequestResult = TextResult | ImageResult | VideoResult;

export async function submitResult(
  requestId: string,
  success: boolean,
  result?: RequestResult,
  error?: string,
): Promise<void> {
  const baseUrl = getApiBaseUrl();

  const response = await fetch(
    `${baseUrl}/v1/local-models/requests/${requestId}/result`,
    {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ success, result, error }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Result submission failed: ${response.status} ${errorText}`,
    );
  }
}

export async function verifyApiKey(): Promise<boolean> {
  const baseUrl = getApiBaseUrl();

  try {
    const response = await fetch(`${baseUrl}/v1/local-models/verify-api-key`, {
      method: 'GET',
      headers: getHeaders(),
    });

    return response.status === 204 || response.ok;
  } catch {
    return false;
  }
}

export type ModelTypeMindStudio =
  | 'llm_chat'
  | 'image_generation'
  | 'video_generation';

export interface SyncModelEntry {
  name: string;
  provider: string;
  type: ModelTypeMindStudio;
  parameters?: unknown[];
}

export async function syncModels(
  models: SyncModelEntry[],
): Promise<void> {
  const baseUrl = getApiBaseUrl();

  const response = await fetch(`${baseUrl}/v1/local-models/models/sync`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ models }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Sync failed: ${response.status} ${errorText}`);
  }
}

export interface SyncedModel {
  id: string;
  name: string;
}

export async function getSyncedModels(): Promise<SyncedModel[]> {
  const baseUrl = getApiBaseUrl();

  const response = await fetch(`${baseUrl}/v1/local-models/models`, {
    method: 'GET',
    headers: getHeaders(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to fetch synced models: ${response.status} ${errorText}`,
    );
  }

  const data = (await response.json()) as { models: SyncedModel[] };
  return data.models;
}

export async function requestDeviceAuth(): Promise<{
  url: string;
  token: string;
}> {
  const baseUrl = getApiBaseUrl();

  const response = await fetch(`${baseUrl}/developer/v2/request-auth-url`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Device auth request failed: ${response.status} ${error}`);
  }

  const data = (await response.json()) as {
    url: string;
    token: string;
  };

  return data;
}

export async function pollDeviceAuth(token: string): Promise<{
  status: 'pending' | 'completed' | 'expired';
  apiKey?: string;
}> {
  const baseUrl = getApiBaseUrl();

  const response = await fetch(`${baseUrl}/developer/v2/poll-auth-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Device auth poll failed: ${response.status} ${error}`);
  }

  const data = (await response.json()) as {
    status: 'pending' | 'completed' | 'expired';
    apiKey?: string;
  };

  return data;
}

export async function disconnectHeartbeat(): Promise<void> {
  const baseUrl = getApiBaseUrl();

  const response = await fetch(`${baseUrl}/v1/local-models/disconnect`, {
    method: 'POST',
    headers: getHeaders(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Heartbeat disconnect failed: ${response.status} ${error}`);
  }
}
