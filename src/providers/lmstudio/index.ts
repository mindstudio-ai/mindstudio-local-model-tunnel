import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
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

interface LMStudioModel {
  id: string;
  object: string;
  owned_by: string;
}

interface LMStudioModelsResponse {
  data: LMStudioModel[];
}

class LMStudioProvider implements Provider {
  readonly name = 'lmstudio';
  readonly displayName = 'LM Studio';
  readonly description = 'Desktop app for running LLMs locally with a visual interface. No terminal required.';
  readonly capabilities = ['text'] as const;
  readonly readme = readme;
  readonly defaultBaseUrl = 'http://localhost:1234/v1';

  get baseUrl(): string {
    return getProviderBaseUrl(this.name, this.defaultBaseUrl);
  }

  private getBaseUrl(): string {
    return this.baseUrl;
  }

  async isRunning(): Promise<boolean> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/models`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async discoverModels(): Promise<LocalModel[]> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/models`);

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as LMStudioModelsResponse;

      return data.data.map((m) => ({
        name: m.id,
        provider: this.name,
        capability: 'text' as const,
      }));
    } catch {
      return [];
    }
  }

  async detect(): Promise<ProviderSetupStatus> {
    let installed = false;

    const possiblePaths = {
      darwin: ['/Applications/LM Studio.app'],
      linux: [
        path.join(os.homedir(), '.local/share/LM Studio'),
        '/opt/lm-studio',
      ],
      win32: [
        path.join(process.env.LOCALAPPDATA || '', 'LM Studio'),
        path.join(process.env.PROGRAMFILES || '', 'LM Studio'),
      ],
    };

    const paths =
      possiblePaths[process.platform as keyof typeof possiblePaths] || [];
    for (const p of paths) {
      if (fs.existsSync(p)) {
        installed = true;
        break;
      }
    }

    let running = false;
    try {
      const response = await fetch('http://localhost:1234/v1/models', {
        signal: AbortSignal.timeout(1000),
      });
      running = response.ok;
      if (running) installed = true;
    } catch {
      running = false;
    }

    return { installed, running };
  }

  async *chat(
    model: string,
    messages: ChatMessage[],
    options?: ChatOptions,
  ): AsyncGenerator<ChatResponse> {
    const response = await fetch(`${this.getBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        stream: true,
        temperature: options?.temperature,
        max_tokens: options?.maxTokens,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LM Studio request failed: ${response.status} ${error}`);
    }

    if (!response.body) {
      throw new Error('No response body from LM Studio');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          yield { content: '', done: true };
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();

          if (!trimmed || !trimmed.startsWith('data: ')) {
            continue;
          }

          const data = trimmed.slice(6);

          if (data === '[DONE]') {
            yield { content: '', done: true };
            return;
          }

          try {
            const parsed = JSON.parse(data) as {
              choices: Array<{
                delta?: { content?: string };
                finish_reason?: string | null;
              }>;
            };

            const choice = parsed.choices[0];
            const content = choice?.delta?.content || '';
            const isDone = choice?.finish_reason !== null;

            if (content) {
              yield { content, done: isDone };
            }
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

export default new LMStudioProvider();
