import { Ollama } from 'ollama';
import { getProviderBaseUrl } from '../../config';
import { commandExists } from '../utils';
import readme from './readme.md';
import type {
  Provider,
  LocalModel,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ProviderSetupStatus,
} from '../types';

class OllamaProvider implements Provider {
  readonly name = 'ollama';
  readonly displayName = 'Ollama';
  readonly description = 'Run open-source LLMs locally via CLI. Supports Llama, Mistral, Gemma, and more.';
  readonly capabilities = ['text'] as const;
  readonly readme = readme;
  readonly defaultBaseUrl = 'http://localhost:11434';

  get baseUrl(): string {
    return getProviderBaseUrl(this.name, this.defaultBaseUrl);
  }

  private createClient(): Ollama {
    return new Ollama({ host: this.baseUrl });
  }

  async isRunning(): Promise<boolean> {
    try {
      const client = this.createClient();
      await client.list();
      return true;
    } catch {
      return false;
    }
  }

  async discoverModels(): Promise<LocalModel[]> {
    try {
      const client = this.createClient();
      const response = await client.list();

      return response.models.map((m) => ({
        name: m.name,
        provider: this.name,
        capability: 'text' as const,
        size: m.size,
        parameterSize: m.details?.parameter_size,
        quantization: m.details?.quantization_level,
      }));
    } catch {
      return [];
    }
  }

  async detect(): Promise<ProviderSetupStatus> {
    const installed = await commandExists('ollama');
    let running = false;

    if (installed) {
      running = await this.isRunning();
    }

    return { installed, running };
  }

  async *chat(
    model: string,
    messages: ChatMessage[],
    options?: ChatOptions,
  ): AsyncGenerator<ChatResponse> {
    const client = this.createClient();

    const stream = await client.chat({
      model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
      options: {
        temperature: options?.temperature,
        num_predict: options?.maxTokens,
      },
    });

    for await (const chunk of stream) {
      yield {
        content: chunk.message.content,
        done: chunk.done,
      };
    }
  }
}

export default new OllamaProvider();
