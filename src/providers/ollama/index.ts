import { Ollama } from 'ollama';
import { config } from '../../config';
import { commandExists } from '../utils';
import type {
  Provider,
  LocalModel,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ProviderSetupStatus,
  ProviderInstructions,
} from '../types';

const instructions: ProviderInstructions = {
  install: {
    macos: [
      {
        text: 'Install Ollama:',
        command: 'curl -fsSL https://ollama.com/install.sh | sh',
      },
    ],
    linux: [
      {
        text: 'Install Ollama:',
        command: 'curl -fsSL https://ollama.com/install.sh | sh',
      },
    ],
    windows: [
      {
        text: 'Download Ollama from https://ollama.com/download and run the installer.',
      },
    ],
  },
  start: {
    macos: [{ text: 'Start the Ollama server:', command: 'ollama serve' }],
    linux: [{ text: 'Start the Ollama server:', command: 'ollama serve' }],
    windows: [{ text: 'Start the Ollama server:', command: 'ollama serve' }],
  },
  stop: {
    macos: [{ text: 'Stop the Ollama server:', command: 'pkill ollama' }],
    linux: [{ text: 'Stop the Ollama server:', command: 'pkill ollama' }],
    windows: [
      {
        text: 'Stop the Ollama server:',
        command: 'taskkill /F /IM ollama.exe',
      },
    ],
  },
};

class OllamaProvider implements Provider {
  readonly name = 'ollama';
  readonly displayName = 'Ollama';
  readonly description = 'Text generation (llama, mistral, etc.)';
  readonly capabilities = ['text'] as const;
  readonly instructions = instructions;

  get baseUrl(): string {
    return config.get('ollamaBaseUrl');
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
