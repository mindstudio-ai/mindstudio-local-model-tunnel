import chalk from "chalk";
import ora, { Ora } from "ora";
import {
  discoverAllModels,
  getProvider,
  type LocalModel,
  type Provider,
} from "./providers/index.js";
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
  private modelProviderMap: Map<string, Provider> = new Map();

  async start(): Promise<void> {
    console.clear();
    console.log(chalk.blue("\nMindStudio Local Model Tunnel\n"));

    // Discover available models from all providers
    const models = await discoverAllModels();

    if (models.length === 0) {
      console.log(chalk.yellow("No local models found."));
      console.log(chalk.white("   Make sure Ollama or LM Studio is running."));
      console.log(chalk.white("   Ollama: ollama serve"));
      console.log(chalk.white("   LM Studio: Start the local server\n"));
      return;
    }

    // Build model -> provider mapping
    this.buildModelProviderMap(models);

    console.log(chalk.green("✓ Found models:"));
    models.forEach((m) => {
      const size = m.parameterSize
        ? m.parameterSize
        : m.size
        ? `${Math.round(m.size / 1e9)}GB`
        : "";
      const sizeStr = size ? ` (${size})` : "";
      console.log(
        chalk.white(`  • ${m.name}${sizeStr} `) + chalk.blue(`[${m.provider}]`)
      );
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

  private buildModelProviderMap(models: LocalModel[]): void {
    this.modelProviderMap.clear();
    for (const model of models) {
      const provider = getProvider(model.provider);
      if (provider) {
        this.modelProviderMap.set(model.name, provider);
      }
    }
  }

  private async processRequest(request: LocalModelRequest): Promise<void> {
    const startTime = Date.now();

    this.spinner?.stop();
    console.log(chalk.cyan(`\n⚡ Processing: ${request.modelId}`));

    // Find the provider for this model
    const provider = this.modelProviderMap.get(request.modelId);

    if (!provider) {
      const message = `Model ${request.modelId} not found. Is it registered on your local server?`;
      console.log(chalk.red(`\nFailed: ${message}\n`));
      await submitResult(request.id, false, undefined, message);
      this.restoreSpinner();
      return;
    }

    console.log(chalk.gray(`  Using provider: ${provider.displayName}`));

    try {
      // Build messages for the provider
      const messages = (request.payload.messages || []).map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      }));

      // Stream the response using the provider
      const stream = provider.chat(request.modelId, messages, {
        temperature: request.payload.temperature,
        maxTokens: request.payload.maxTokens,
      });

      let fullContent = "";
      let lastProgressUpdate = 0;
      const progressInterval = 100; // Update progress every 100ms max

      for await (const chunk of stream) {
        fullContent += chunk.content;

        // Throttle progress updates
        const now = Date.now();
        if (now - lastProgressUpdate > progressInterval) {
          await submitProgress(request.id, fullContent);
          lastProgressUpdate = now;
        }

        // Show streaming indicator
        if (chunk.content) {
          process.stdout.write(chalk.white("."));
        }
      }

      // Submit final progress
      await submitProgress(request.id, fullContent);

      // Submit result
      await submitResult(request.id, true, {
        content: fullContent,
        usage: {
          promptTokens: 0,
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
        this.restoreSpinner();
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

    this.restoreSpinner();
  }

  private restoreSpinner(): void {
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
