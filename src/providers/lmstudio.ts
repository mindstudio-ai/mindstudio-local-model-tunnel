import { getLMStudioBaseUrl } from "../config.js";
import type {
  Provider,
  LocalModel,
  ChatMessage,
  ChatOptions,
  ChatResponse,
} from "./types.js";

interface LMStudioModel {
  id: string;
  object: string;
  owned_by: string;
}

interface LMStudioModelsResponse {
  data: LMStudioModel[];
}

export class LMStudioProvider implements Provider {
  readonly name = "lmstudio" as const;
  readonly displayName = "LM Studio";

  private getBaseUrl(): string {
    return getLMStudioBaseUrl();
  }

  async isRunning(): Promise<boolean> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/models`, {
        method: "GET",
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
      }));
    } catch {
      return [];
    }
  }

  async *chat(
    model: string,
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<ChatResponse> {
    const response = await fetch(`${this.getBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
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
      throw new Error("No response body from LM Studio");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          yield { content: "", done: true };
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process SSE lines
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();

          if (!trimmed || !trimmed.startsWith("data: ")) {
            continue;
          }

          const data = trimmed.slice(6); // Remove "data: " prefix

          if (data === "[DONE]") {
            yield { content: "", done: true };
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
            const content = choice?.delta?.content || "";
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
