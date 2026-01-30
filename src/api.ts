import { getApiKey, getApiBaseUrl } from "./config.js";

export interface LocalModelRequest {
  id: string;
  organizationId: string;
  modelId: string;
  requestType: "llm_chat" | "image_generation" | "video_generation";
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
    throw new Error("Not authenticated. Run: mindstudio-local auth");
  }

  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

export async function pollForRequest(
  models: string[]
): Promise<LocalModelRequest | null> {
  const baseUrl = getApiBaseUrl();
  const modelsParam = models.join(",");

  const response = await fetch(
    `${baseUrl}/v1/local-models/poll?models=${encodeURIComponent(modelsParam)}`,
    {
      method: "GET",
      headers: getHeaders(),
    }
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

export async function submitProgress(
  requestId: string,
  content: string
): Promise<void> {
  const baseUrl = getApiBaseUrl();

  const response = await fetch(
    `${baseUrl}/v1/local-models/requests/${requestId}/progress`,
    {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ content }),
    }
  );

  if (!response.ok) {
    console.warn(`Progress update failed: ${response.status}`);
  }
}

export async function submitResult(
  requestId: string,
  success: boolean,
  result?: {
    content?: string;
    usage?: { promptTokens: number; completionTokens: number };
  },
  error?: string
): Promise<void> {
  const baseUrl = getApiBaseUrl();

  const response = await fetch(
    `${baseUrl}/v1/local-models/requests/${requestId}/result`,
    {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ success, result, error }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Result submission failed: ${response.status} ${errorText}`
    );
  }
}

export async function verifyApiKey(): Promise<boolean> {
  const baseUrl = getApiBaseUrl();

  try {
    const response = await fetch(`${baseUrl}/v1/local-models/verify-api-key`, {
      method: "GET",
      headers: getHeaders(),
    });

    return response.status === 204 || response.ok;
  } catch {
    return false;
  }
}

export async function registerLocalModel(
  modelName: string,
  provider: string = "ollama"
): Promise<void> {
  const baseUrl = getApiBaseUrl();

  const response = await fetch(`${baseUrl}/v1/local-models/models/create`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ modelName, provider }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Register failed: ${response.status} ${errorText}`);
  }
}

export async function getRegisteredModels(): Promise<string[]> {
  const baseUrl = getApiBaseUrl();

  const response = await fetch(`${baseUrl}/v1/local-models/models`, {
    method: "GET",
    headers: getHeaders(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to fetch registered models: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as { models: string[] };
  return data.models;
}

export async function requestDeviceAuth(): Promise<{
  url: string;
  token: string;
}> {
  const baseUrl = getApiBaseUrl();

  const response = await fetch(`${baseUrl}/developer/v2/request-auth-url`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
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
  status: "pending" | "completed" | "expired";
  apiKey?: string;
}> {
  const baseUrl = getApiBaseUrl();

  const response = await fetch(`${baseUrl}/developer/v2/poll-auth-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Device auth poll failed: ${response.status} ${error}`);
  }

  const data = (await response.json()) as {
    status: "pending" | "completed" | "expired";
    apiKey?: string;
  };

  return data;
}

export async function disconnectHeartbeat(): Promise<void> {
  const baseUrl = getApiBaseUrl();

  const response = await fetch(`${baseUrl}/v1/local-models/disconnect`, {
    method: "POST",
    headers: getHeaders(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Heartbeat disconnect failed: ${response.status} ${error}`);
  }
}
