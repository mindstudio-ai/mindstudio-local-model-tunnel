import { Ollama } from 'ollama';
import { getOllamaBaseUrl } from '../config.js';
import type {
  TextProvider,
  LocalModel,
  ChatMessage,
  ChatOptions,
  ChatResponse,
} from './types.js';

export class OllamaProvider implements TextProvider {
  readonly name = 'ollama' as const;
  readonly displayName = 'Ollama';
  readonly capability = 'text' as const;

  private createClient(): Ollama {
    return new Ollama({ host: getOllamaBaseUrl() });
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
