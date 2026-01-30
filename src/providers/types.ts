export type ProviderType = "ollama" | "lmstudio";

export interface LocalModel {
  name: string;
  provider: ProviderType;
  size?: number;
  parameterSize?: string;
  quantization?: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResponse {
  content: string;
  done: boolean;
}

export interface Provider {
  readonly name: ProviderType;
  readonly displayName: string;

  /**
   * Check if the provider's backend is running and accessible
   */
  isRunning(): Promise<boolean>;

  /**
   * Discover all available models from this provider
   */
  discoverModels(): Promise<LocalModel[]>;

  /**
   * Stream a chat completion
   */
  chat(
    model: string,
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<ChatResponse>;
}
