import {
  pollForRequest,
  submitProgress,
  submitResult,
  disconnectHeartbeat,
  type LocalModelRequest,
} from './api';
import {
  getProvider,
  discoverAllModels,
  type Provider,
  type LocalModel,
} from './providers';
import { requestEvents } from './events';

/**
 * TunnelRunner handles the polling and request processing loop.
 * It emits events that listeners (TUI or simple chalk output) can subscribe to.
 */
export class TunnelRunner {
  private isRunning = false;
  private modelProviderMap: Map<string, Provider> = new Map();
  private modelIds: string[] = [];

  /**
   * Start with a pre-discovered list of synced model IDs.
   * Used by the TUI, which discovers models itself.
   */
  async start(modelIds: string[]): Promise<void> {
    if (this.isRunning) return;

    this.modelIds = modelIds;
    this.isRunning = true;

    // Build model -> provider mapping
    const allModels = await discoverAllModels();
    this.buildModelProviderMap(allModels);

    // Start polling loop
    this.pollLoop();
  }

  stop(): void {
    this.isRunning = false;
    disconnectHeartbeat().catch(() => {});
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

  private async pollLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        const request = await pollForRequest(this.modelIds);
        if (request) {
          // Process request in background
          this.processRequest(request);
        }
      } catch (error) {
        // Wait before retrying on error
        await this.sleep(5000);
      }
    }
  }

  private async processRequest(request: LocalModelRequest): Promise<void> {
    const startTime = Date.now();

    // Emit start event
    requestEvents.emitStart({
      id: request.id,
      modelId: request.modelId,
      requestType: request.requestType,
      timestamp: startTime,
    });

    const provider = this.modelProviderMap.get(request.modelId);

    if (!provider) {
      const error = `Model ${request.modelId} not found`;
      await submitResult(request.id, false, undefined, error);
      requestEvents.emitComplete({
        id: request.id,
        success: false,
        duration: Date.now() - startTime,
        error,
      });
      return;
    }

    try {
      switch (request.requestType) {
        case 'llm_chat':
          await this.handleTextRequest(request, provider, startTime);
          break;
        case 'image_generation':
          await this.handleImageRequest(request, provider, startTime);
          break;
        case 'video_generation':
          await this.handleVideoRequest(request, provider, startTime);
          break;
        default:
          throw new Error(`Unsupported request type: ${request.requestType}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await submitResult(request.id, false, undefined, message);
      requestEvents.emitComplete({
        id: request.id,
        success: false,
        duration: Date.now() - startTime,
        error: message,
      });
    }
  }

  private async handleTextRequest(
    request: LocalModelRequest,
    provider: Provider,
    startTime: number,
  ): Promise<void> {
    if (!provider.chat) {
      throw new Error(`Provider does not support text generation`);
    }

    const messages = (request.payload.messages || []).map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    }));

    const stream = provider.chat(request.modelId, messages, {
      temperature: request.payload.temperature,
      maxTokens: request.payload.maxTokens,
    });

    let fullContent = '';
    let lastProgressUpdate = 0;
    const progressInterval = 100;

    for await (const chunk of stream) {
      fullContent += chunk.content;

      const now = Date.now();
      if (now - lastProgressUpdate > progressInterval) {
        await submitProgress(request.id, fullContent);
        requestEvents.emitProgress({
          id: request.id,
          content: fullContent,
        });
        lastProgressUpdate = now;
      }
    }

    await submitProgress(request.id, fullContent);
    await submitResult(request.id, true, {
      content: fullContent,
      usage: { promptTokens: 0, completionTokens: 0 },
    });

    requestEvents.emitComplete({
      id: request.id,
      success: true,
      duration: Date.now() - startTime,
      result: { chars: fullContent.length },
    });
  }

  private async handleImageRequest(
    request: LocalModelRequest,
    provider: Provider,
    startTime: number,
  ): Promise<void> {
    if (!provider.generateImage) {
      throw new Error(`Provider does not support image generation`);
    }

    const prompt = request.payload.prompt || '';
    const config = request.payload.config || {};

    const result = await provider.generateImage(
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
        workflow: config.workflow as Record<string, unknown> | undefined,
      },
      async (progress) => {
        await submitProgress(
          request.id,
          `Step ${progress.step}/${progress.totalSteps}`,
          'log',
        );
        requestEvents.emitProgress({
          id: request.id,
          step: progress.step,
          totalSteps: progress.totalSteps,
        });
      },
    );

    await submitResult(request.id, true, {
      imageBase64: result.imageBase64,
      mimeType: result.mimeType,
      seed: result.seed,
    });

    const imageSize = Math.round((result.imageBase64.length * 3) / 4);

    requestEvents.emitComplete({
      id: request.id,
      success: true,
      duration: Date.now() - startTime,
      result: { imageSize },
    });
  }

  private async handleVideoRequest(
    request: LocalModelRequest,
    provider: Provider,
    startTime: number,
  ): Promise<void> {
    if (!provider.generateVideo) {
      throw new Error(`Provider does not support video generation`);
    }

    const prompt = request.payload.prompt || '';
    const config = request.payload.config || {};

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
        workflow: config.workflow as Record<string, unknown> | undefined,
      },
      async (progress) => {
        await submitProgress(
          request.id,
          `Step ${progress.step}/${progress.totalSteps}`,
          'log',
        );
        requestEvents.emitProgress({
          id: request.id,
          step: progress.step,
          totalSteps: progress.totalSteps,
        });
      },
    );

    await submitResult(request.id, true, {
      videoBase64: result.videoBase64,
      mimeType: result.mimeType,
      duration: result.duration,
      fps: result.fps,
      seed: result.seed,
    });

    const videoSize = Math.round((result.videoBase64.length * 3) / 4);

    requestEvents.emitComplete({
      id: request.id,
      success: true,
      duration: Date.now() - startTime,
      result: { videoSize },
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
