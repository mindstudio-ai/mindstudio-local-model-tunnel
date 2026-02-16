import chalk from 'chalk';
import ora, { Ora } from 'ora';
import {
  discoverAllModels,
  getProvider,
  isTextProvider,
  isImageProvider,
  isVideoProvider,
  type LocalModel,
  type Provider,
  type TextProvider,
  type ImageProvider,
  type VideoProvider,
} from './providers/index.js';
import {
  pollForRequest,
  submitProgress,
  submitGenerationProgress,
  submitResult,
  LocalModelRequest,
  disconnectHeartbeat,
} from './api.js';
import { displayModels } from './helpers.js';

const LogoString = `
       @@@@@@@       @@@@@@@
      @@@@@@@@@@   @@@@@@@@@@
     @@@@@@@@@@@  @@@@@@@@@@@
    @@@@@@@@@@@@ @@@@@@@@@@@@  @
   @@@@@@@@@@@@ @@@@@@@@@@@@  @@@
  @@@@@@@@@@@@ @@@@@@@@@@@@  @@@@@
 @@@@@@@@@@@@ @@@@@@@@@@@@ @@@@@@@@
@@@@@@@@@@@@ @@@@@@@@@@@@ @@@@@@@@@@
@@@@@@@@@@@  @@@@@@@@@@@  @@@@@@@@@@
@@@@@@@@@@   @@@@@@@@@@   @@@@@@@@@@
 @@@@@@@       @@@@@@@      @@@@@@@ `;

export class LocalModelRunner {
  private isRunning = false;
  private spinner: Ora | null = null;
  private activeRequests = 0;
  private modelProviderMap: Map<string, Provider> = new Map();

  async start(): Promise<void> {
    console.clear();
    console.log(chalk.white(LogoString));
    console.log(chalk.blue('\nMindStudio Local Model Tunnel\n'));

    // Discover available models from all providers
    const models = await discoverAllModels();

    if (models.length === 0) {
      console.log(chalk.yellow('No local models found.'));
      console.log(chalk.white('   Make sure a provider is running:'));
      console.log(chalk.white('   • Ollama: ollama serve'));
      console.log(chalk.white('   • LM Studio: Start the local server'));
      console.log(chalk.white('   • Stable Diffusion: Start AUTOMATIC1111\n'));
      return;
    }

    // Build model -> provider mapping
    this.buildModelProviderMap(models);

    displayModels(models);

    const modelNames = models.map((m) => m.name);

    this.isRunning = true;
    this.spinner = ora({
      text: 'Waiting for requests...',
      color: 'cyan',
    }).start();

    // Handle graceful shutdown
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());

    while (this.isRunning) {
      try {
        await this.poll(modelNames);
      } catch (error) {
        if (this.isRunning) {
          const message =
            error instanceof Error ? error.message : 'Unknown error';
          this.spinner?.fail(chalk.red(`Error: ${message}`));

          // Wait before retrying
          await this.sleep(5000);

          if (this.isRunning) {
            this.spinner = ora({
              text: 'Reconnecting...',
              color: 'cyan',
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
    this.spinner?.stop();
    console.log(chalk.cyan(`\n⚡ Processing: ${request.modelId}`));
    console.log(chalk.gray(`  Request type: ${request.requestType}`));

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

    // Route to appropriate handler based on request type
    switch (request.requestType) {
      case 'llm_chat':
        await this.handleTextRequest(request, provider);
        break;
      case 'image_generation':
        await this.handleImageRequest(request, provider);
        break;
      case 'video_generation':
        await this.handleVideoRequest(request, provider);
        break;
      default:
        console.log(chalk.red(`Unknown request type: ${request.requestType}`));
        await submitResult(
          request.id,
          false,
          undefined,
          `Unknown request type: ${request.requestType}`,
        );
    }

    this.restoreSpinner();
  }

  private async handleTextRequest(
    request: LocalModelRequest,
    provider: Provider,
  ): Promise<void> {
    const startTime = Date.now();

    if (!isTextProvider(provider)) {
      const message = `Provider ${provider.displayName} does not support text generation`;
      console.log(chalk.red(`\nFailed: ${message}\n`));
      await submitResult(request.id, false, undefined, message);
      return;
    }

    try {
      // Build messages for the provider
      const messages = (request.payload.messages || []).map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      }));

      // Stream the response using the provider
      const stream = provider.chat(request.modelId, messages, {
        temperature: request.payload.temperature,
        maxTokens: request.payload.maxTokens,
      });

      let fullContent = '';
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
          process.stdout.write(chalk.white('.'));
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
          `\n✓ Completed in ${duration}s (${fullContent.length} chars)\n`,
        ),
      );
    } catch (error) {
      this.handleRequestError(request, error);
    }
  }

  private async handleImageRequest(
    request: LocalModelRequest,
    provider: Provider,
  ): Promise<void> {
    const startTime = Date.now();

    if (!isImageProvider(provider)) {
      const message = `Provider ${provider.displayName} does not support image generation`;
      console.log(chalk.red(`\nFailed: ${message}\n`));
      await submitResult(request.id, false, undefined, message);
      return;
    }

    try {
      const prompt = request.payload.prompt || '';
      const config = request.payload.config || {};

      console.log(chalk.gray(`  Prompt: "${prompt.slice(0, 50)}..."`));

      // Generate image with progress updates if supported
      let result;
      if (provider.generateImageWithProgress) {
        result = await provider.generateImageWithProgress(
          request.modelId,
          prompt,
          {
            negativePrompt: config.negativePrompt as string | undefined,
            width: config.width as number | undefined,
            height: config.height as number | undefined,
            steps: config.steps as number | undefined,
            cfgScale: config.cfgScale as number | undefined,
            seed: config.seed as number | undefined,
            sampler: config.sampler as string | undefined,
          },
          async (progress) => {
            await submitGenerationProgress(
              request.id,
              progress.step,
              progress.totalSteps,
              progress.preview,
            );
            process.stdout.write(
              chalk.white(
                `\r  Step ${progress.step}/${progress.totalSteps}...`,
              ),
            );
          },
        );
      } else {
        result = await provider.generateImage(request.modelId, prompt, {
          negativePrompt: config.negativePrompt as string | undefined,
          width: config.width as number | undefined,
          height: config.height as number | undefined,
          steps: config.steps as number | undefined,
          cfgScale: config.cfgScale as number | undefined,
          seed: config.seed as number | undefined,
          sampler: config.sampler as string | undefined,
        });
      }

      // Submit result with image data
      await submitResult(request.id, true, {
        imageBase64: result.imageBase64,
        mimeType: result.mimeType,
        seed: result.seed,
      });

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      const sizeKB = Math.round((result.imageBase64.length * 3) / 4 / 1024);
      console.log(
        chalk.green(`\n✓ Generated image in ${duration}s (${sizeKB}KB)\n`),
      );
    } catch (error) {
      this.handleRequestError(request, error);
    }
  }

  private async handleVideoRequest(
    request: LocalModelRequest,
    provider: Provider,
  ): Promise<void> {
    const startTime = Date.now();

    if (!isVideoProvider(provider)) {
      const message = `Provider ${provider.displayName} does not support video generation`;
      console.log(chalk.red(`\nFailed: ${message}\n`));
      await submitResult(request.id, false, undefined, message);
      return;
    }

    try {
      const prompt = request.payload.prompt || '';
      const config = request.payload.config || {};

      console.log(chalk.gray(`  Prompt: "${prompt.slice(0, 50)}..."`));

      const result = await provider.generateVideo(
        request.modelId,
        prompt,
        {
          negativePrompt: config.negativePrompt as string | undefined,
          width: config.width as number | undefined,
          height: config.height as number | undefined,
          numFrames: config.numFrames as number | undefined,
          fps: config.fps as number | undefined,
          steps: config.steps as number | undefined,
          cfgScale: config.cfgScale as number | undefined,
          seed: config.seed as number | undefined,
        },
        async (progress) => {
          await submitGenerationProgress(
            request.id,
            progress.step,
            progress.totalSteps,
          );
          process.stdout.write(
            chalk.white(`\r  Step ${progress.step}/${progress.totalSteps}...`),
          );
        },
      );

      // Submit result with video data
      await submitResult(request.id, true, {
        videoBase64: result.videoBase64,
        mimeType: result.mimeType,
        duration: result.duration,
        fps: result.fps,
        seed: result.seed,
      });

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      const sizeMB = Math.round(
        (result.videoBase64.length * 3) / 4 / 1024 / 1024,
      );
      console.log(
        chalk.green(
          `\n✓ Generated video in ${duration}s (${sizeMB}MB, ${result.duration?.toFixed(1) || '?'}s @ ${result.fps || '?'}fps)\n`,
        ),
      );
    } catch (error) {
      this.handleRequestError(request, error);
    }
  }

  private async handleRequestError(
    request: LocalModelRequest,
    error: unknown,
  ): Promise<void> {
    if (error instanceof Error && (error as any).status_code === 404) {
      const message = `Model ${request.modelId} not found. Is it registered on your local server?`;
      console.log(chalk.red(`\nFailed: ${message}\n`));
      await submitResult(request.id, false, undefined, message);
      return;
    }

    let message = error instanceof Error ? error.message : 'Unknown error';

    if (message === 'fetch failed') {
      message =
        'Failed to connect to the API. Please make sure your local model server is running.';
    }

    console.log(error);
    console.log(chalk.red(`\n✗ Failed: ${message}\n`));

    await submitResult(request.id, false, undefined, message);
  }

  private restoreSpinner(): void {
    if (this.isRunning) {
      this.spinner = ora({
        text: 'Waiting for requests...',
        color: 'cyan',
      }).start();
      this.updateSpinner();
    }
  }

  private updateSpinner(): void {
    if (this.spinner && this.isRunning) {
      if (this.activeRequests > 0) {
        this.spinner.text = `Processing ${this.activeRequests} request(s)...`;
      } else {
        this.spinner.text = 'Waiting for requests...';
      }
    }
  }

  private async stop(): Promise<void> {
    await disconnectHeartbeat();
    console.log(chalk.yellow('\n\nShutting down...\n'));
    this.isRunning = false;
    this.spinner?.stop();
    process.exit(0);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
