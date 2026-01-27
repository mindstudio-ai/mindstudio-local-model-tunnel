import chalk from "chalk";
import ora, { Ora } from "ora";
import { createOllamaClient, discoverModels } from "./ollama.js";
import {
  pollForRequest,
  submitProgress,
  submitResult,
  LocalModelRequest,
  disconnectHeartbeat,
} from "./api.js";

export class LocalModelRunner {
  private isRunning = false;
  private spinner: Ora | null = null;
  private activeRequests = 0;

  async start(): Promise<void> {
    console.clear();
    console.log(chalk.blue("\nMindStudio Local Model Tunnel\n"));

    // Discover available models
    const models = await discoverModels();

    if (models.length === 0) {
      console.log(chalk.yellow("No Ollama models found."));
      console.log(chalk.white("   Make sure Ollama is running: ollama serve"));
      console.log(chalk.white("   Pull a model: ollama pull llama3.2\n"));
      return;
    }

    console.log(chalk.green("✓ Found models:"));
    models.forEach((m) => {
      const size = m.parameterSize || `${Math.round(m.size / 1e9)}GB`;
      console.log(chalk.white(`  • ${m.name} (${size})`));
    });
    console.log("");

    const modelNames = models.map((m) => m.name);

    this.isRunning = true;
    this.spinner = ora({
      text: "Waiting for requests...",
      color: "cyan",
    }).start();

    // Handle graceful shutdown
    process.on("SIGINT", () => this.stop());
    process.on("SIGTERM", () => this.stop());

    while (this.isRunning) {
      try {
        await this.poll(modelNames);
      } catch (error) {
        if (this.isRunning) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          this.spinner?.fail(chalk.red(`Error: ${message}`));

          // Wait before retrying
          await this.sleep(5000);

          if (this.isRunning) {
            this.spinner = ora({
              text: "Reconnecting...",
              color: "cyan",
            }).start();
          }
        }
      }
    }
  }

  private async poll(models: string[]): Promise<void> {
    const request = await pollForRequest(models);

    if (!request) {
      return; // Long-poll returned with no request, continue polling
    }

    this.activeRequests++;
    this.updateSpinner();

    // Process request in background (don't await)
    this.processRequest(request).finally(() => {
      this.activeRequests--;
      this.updateSpinner();
    });
  }

  private async processRequest(request: LocalModelRequest): Promise<void> {
    const startTime = Date.now();

    this.spinner?.stop();
    console.log(chalk.cyan(`\n⚡ Processing: ${request.modelId}`));

    try {
      const ollama = await createOllamaClient();

      // Build messages for Ollama
      const messages = request.payload.messages || [];

      // Stream the response
      const stream = await ollama.chat({
        model: request.modelId,
        messages: messages.map((m) => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
        })),
        stream: true,
        options: {
          temperature: request.payload.temperature,
          num_predict: request.payload.maxTokens,
        },
      });

      let fullContent = "";
      let lastProgressUpdate = 0;
      const progressInterval = 100; // Update progress every 100ms max

      for await (const chunk of stream) {
        fullContent += chunk.message.content;

        // Throttle progress updates
        const now = Date.now();
        if (now - lastProgressUpdate > progressInterval) {
          await submitProgress(request.id, fullContent);
          lastProgressUpdate = now;
        }

        // Show streaming indicator
        process.stdout.write(chalk.white("."));
      }

      // Submit final progress
      await submitProgress(request.id, fullContent);

      // Submit result
      await submitResult(request.id, true, {
        content: fullContent,
        usage: {
          promptTokens: 0, // Ollama doesn't always provide this
          completionTokens: 0,
        },
      });

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(
        chalk.green(
          `\n✓ Completed in ${duration}s (${fullContent.length} chars)\n`
        )
      );
    } catch (error) {
      if (error instanceof Error && (error as any).status_code === 404) {
        const message = `Model ${request.modelId} not found. Is it registered on your local server?`;

        console.log(chalk.red(`\nFailed: ${message}\n`));
        await submitResult(request.id, false, undefined, message);
        return;
      }

      let message = error instanceof Error ? error.message : "Unknown error";

      if (message === "fetch failed") {
        message =
          "Failed to connect to the API. Please make sure your local model server is running.";
      }

      console.log(error);
      console.log(chalk.red(`\n✗ Failed: ${message}\n`));

      await submitResult(request.id, false, undefined, message);
    }

    if (this.isRunning) {
      this.spinner = ora({
        text: "Waiting for requests...",
        color: "cyan",
      }).start();
      this.updateSpinner();
    }
  }

  private updateSpinner(): void {
    if (this.spinner && this.isRunning) {
      if (this.activeRequests > 0) {
        this.spinner.text = `Processing ${this.activeRequests} request(s)...`;
      } else {
        this.spinner.text = "Waiting for requests...";
      }
    }
  }

  private async stop(): Promise<void> {
    await disconnectHeartbeat();
    console.log(chalk.yellow("\n\nShutting down...\n"));
    this.isRunning = false;
    this.spinner?.stop();
    process.exit(0);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
