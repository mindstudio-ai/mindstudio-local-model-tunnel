import * as dotenv from 'dotenv';
dotenv.config();

import { getProviderBaseUrl } from '../../config';
import readme from './readme.md';
import type {
  Provider,
  LocalModel,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ProviderSetupStatus,
} from '../types';

interface OMLXModel {
  id: string;
  object?: string;
  owned_by?: string;
}

interface OMLXModelsResponse {
  data: OMLXModel[];
}

class OMLXProvider implements Provider {
  readonly name = 'omlx';
  readonly displayName = 'OMLX';
  readonly description =
    'Local models via OMLX endpoint. Supports text and image inputs.';
  readonly capabilities = ['text', 'image'] as const;
  readonly readme = readme;
  readonly defaultBaseUrl = 'http://localhost:8000/v1';

  // Short caches reduce repeated tunnel round-trips
  private readonly HEALTH_TTL_MS = 3_000;
  private readonly MODELS_TTL_MS = 10_000;

  private healthCache: { value: boolean; expiresAt: number } | null = null;
  private modelsCache: { value: LocalModel[]; expiresAt: number } | null = null;

  // Deduplicate concurrent requests
  private healthInFlight: Promise<boolean> | null = null;
  private modelsInFlight: Promise<LocalModel[]> | null = null;

  get baseUrl(): string {
    return getProviderBaseUrl(this.name, this.defaultBaseUrl).replace(/\/$/, '');
  }

  // Original-compatible: always send Authorization header (even if empty)
  private getHeaders(extra?: Record<string, string>): Record<string, string> {
    const apiKey = process.env.OMLX_API_KEY;
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey ?? ''}`,
      ...(extra ?? {}),
    };
  }

  async isRunning(forceRefresh = false): Promise<boolean> {
    const now = Date.now();

    if (!forceRefresh && this.healthCache && this.healthCache.expiresAt > now) {
      return this.healthCache.value;
    }

    if (!forceRefresh && this.healthInFlight) {
      return this.healthInFlight;
    }

    this.healthInFlight = (async () => {
      try {
        const response = await fetch(`${this.baseUrl}/models`, {
          headers: this.getHeaders(),
        });

        const ok = response.ok;
        this.healthCache = {
          value: ok,
          expiresAt: Date.now() + this.HEALTH_TTL_MS,
        };
        return ok;
      } catch {
        this.healthCache = {
          value: false,
          expiresAt: Date.now() + this.HEALTH_TTL_MS,
        };
        return false;
      } finally {
        this.healthInFlight = null;
      }
    })();

    return this.healthInFlight;
  }

  async discoverModels(forceRefresh = false): Promise<LocalModel[]> {
    const now = Date.now();

    if (!forceRefresh && this.modelsCache && this.modelsCache.expiresAt > now) {
      return this.modelsCache.value;
    }

    if (!forceRefresh && this.modelsInFlight) {
      return this.modelsInFlight;
    }

    this.modelsInFlight = (async () => {
      try {
        const response = await fetch(`${this.baseUrl}/models`, {
          headers: this.getHeaders(),
        });

        if (!response.ok) {
          const empty: LocalModel[] = [];
          this.modelsCache = {
            value: empty,
            expiresAt: Date.now() + this.MODELS_TTL_MS,
          };
          return empty;
        }

        const data = (await response.json()) as OMLXModelsResponse;
        const models: LocalModel[] = (data.data ?? []).map((m) => ({
          name: m.id,
          provider: this.name,
          capability: 'text',
        }));

        this.modelsCache = {
          value: models,
          expiresAt: Date.now() + this.MODELS_TTL_MS,
        };

        return models;
      } catch {
        const empty: LocalModel[] = [];
        this.modelsCache = {
          value: empty,
          expiresAt: Date.now() + this.MODELS_TTL_MS,
        };
        return empty;
      } finally {
        this.modelsInFlight = null;
      }
    })();

    return this.modelsInFlight;
  }

  async detect(): Promise<ProviderSetupStatus> {
    const running = await this.isRunning();
    return { installed: true, running };
  }

  async *chat(
    model: string,
    messages: ChatMessage[],
    options?: ChatOptions,
  ): AsyncGenerator<ChatResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(), 
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: options?.temperature ?? 1.0,
        max_tokens: options?.maxTokens ?? 8192, 
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`OMLX request failed: ${response.status} ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = '';
    let hasYieldedDone = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Incremental parsing to reduce allocations vs split() per chunk
        let nlIndex = buffer.indexOf('\n');
        while (nlIndex !== -1) {
          let line = buffer.slice(0, nlIndex);
          buffer = buffer.slice(nlIndex + 1);

          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (!line.trim() || !line.startsWith('data: ')) {
            nlIndex = buffer.indexOf('\n');
            continue;
          }

          const data = line.slice(6).trim();

          if (data === '[DONE]') {
            if (!hasYieldedDone) {
              yield { content: '', done: true };
              hasYieldedDone = true;
            }
            nlIndex = buffer.indexOf('\n');
            continue;
          }

          try {
            const parsed = JSON.parse(data);
            const content = parsed?.choices?.[0]?.delta?.content;
            if (content) {
              yield { content, done: false };
            }
          } catch {
            // skip malformed JSON lines
          }

          nlIndex = buffer.indexOf('\n');
        }
      }

      // Flush remaining decoder bytes
      const tail = decoder.decode();
      if (tail) buffer += tail;

      if (!hasYieldedDone) {
        yield { content: '', done: true };
      }
    } finally {
      reader.releaseLock();
    }
  }
}

export default new OMLXProvider();
