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

  get baseUrl(): string {
    return getProviderBaseUrl(this.name, this.defaultBaseUrl).replace(/\/$/, '');
  }

  private getHeaders(): Record<string, string> {
    const apiKey = process.env.OMLX_API_KEY;
    
    // DEBUG LOG: Let's prove the dotenv package worked
    console.log("DEBUG - OMLX API KEY IS:", apiKey); 
    
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    };
  }

  async isRunning(): Promise<boolean> {
    try {
      console.log("DEBUG - Pinging OMLX at:", `${this.baseUrl}/models`); 
      
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      
      console.log("DEBUG - OMLX response status:", response.status); 
      
      return response.ok;
    } catch (error) {
      console.error("DEBUG - OMLX isRunning threw an error:", error); 
      return false;
    }
  }

  async discoverModels(): Promise<LocalModel[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.getHeaders(),
      });
      
      if (!response.ok) {
        return [];
      }
      
      const data = (await response.json()) as OMLXModelsResponse;
      return data.data.map((m) => ({
        name: m.id,
        provider: this.name,
        capability: 'text', 
      }));
    } catch {
      return [];
    }
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
        max_tokens: options?.maxTokens ?? 30000,
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
        const lines = buffer.split(/\r?\n/); 
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;

          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            if (!hasYieldedDone) {
              yield { content: '', done: true };
              hasYieldedDone = true;
            }
            continue;
          }

          try {
            const parsed = JSON.parse(data);
            const choice = parsed.choices?.[0];
            const content = choice?.delta?.content;

            if (content) {
              yield { content, done: false };
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }

      if (!hasYieldedDone) {
        yield { content: '', done: true };
      }
    } finally {
      reader.releaseLock();
    }
  }
}

export default new OMLXProvider();