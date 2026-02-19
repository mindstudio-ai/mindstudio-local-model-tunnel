import * as path from 'path';
import {
  getProviderBaseUrl,
  setProviderBaseUrl,
  getProviderInstallPath,
  setProviderInstallPath,
} from '../../config';
import { discoverWorkflows } from './workflow-discovery';
import { ensureConverterInstalled } from './converter-install';
import { executeWorkflow } from './workflow-executor';
import readme from './readme.md';
import type {
  Provider,
  LocalModel,
  ImageGenerationOptions,
  ImageGenerationResult,
  ImageGenerationProgress,
  VideoGenerationOptions,
  VideoGenerationResult,
  VideoGenerationProgress,
  ProviderSetupStatus,
} from '../types';

// Desktop app uses 8000, CLI default is 8188
const COMFYUI_PORTS = [8000, 8188];

/**
 * ComfyUI provider — discovers user-saved workflows and executes them.
 */
class ComfyUIProvider implements Provider {
  readonly name = 'comfyui';
  readonly displayName = 'ComfyUI';
  readonly description =
    'Run any saved ComfyUI workflow — images, video, and more.';
  readonly capabilities = ['image', 'video'] as const;
  readonly readme = readme;
  readonly defaultBaseUrl = 'http://127.0.0.1:8000';

  get baseUrl(): string {
    return getProviderBaseUrl(this.name, this.defaultBaseUrl);
  }

  private getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Try to reach ComfyUI on the configured URL, then fall back to known ports.
   * Persists whichever URL responds so future calls go direct.
   */
  private async findRunningUrl(): Promise<string | null> {
    // Try configured URL first
    const configured = this.getBaseUrl();
    if (await this.checkUrl(configured)) return configured;

    // Try other known ports
    for (const port of COMFYUI_PORTS) {
      const url = `http://127.0.0.1:${port}`;
      if (url === configured) continue; // Already tried
      if (await this.checkUrl(url)) {
        setProviderBaseUrl(this.name, url);
        return url;
      }
    }

    return null;
  }

  private async checkUrl(url: string): Promise<boolean> {
    try {
      const response = await fetch(`${url}/system_stats`, {
        signal: AbortSignal.timeout(1000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Query the running ComfyUI server for its install path via /internal/folder_paths.
   * Derives the root from the custom_nodes path and persists it for future use.
   */
  private async queryInstallPath(baseUrl: string): Promise<string | null> {
    try {
      const response = await fetch(`${baseUrl}/internal/folder_paths`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) return null;

      const data = (await response.json()) as Record<string, string[]>;
      const customNodesPaths = data.custom_nodes;
      if (!customNodesPaths || customNodesPaths.length === 0) return null;

      // custom_nodes path is like /path/to/ComfyUI/custom_nodes — parent is the install root
      const installPath = path.dirname(customNodesPaths[0]!);
      setProviderInstallPath(this.name, installPath);
      return installPath;
    } catch {
      return null;
    }
  }

  async isRunning(): Promise<boolean> {
    return (await this.findRunningUrl()) !== null;
  }

  async detect(): Promise<ProviderSetupStatus> {
    const runningUrl = await this.findRunningUrl();

    if (runningUrl) {
      // Query the server for its install path and auto-install converter
      const queriedPath = await this.queryInstallPath(runningUrl);
      if (queriedPath) {
        ensureConverterInstalled(queriedPath).catch(() => {});
      }
      return { installed: true, running: true };
    }

    // Offline: use previously saved path
    const savedPath = getProviderInstallPath(this.name);
    return { installed: !!savedPath, running: false };
  }

  /**
   * Discover workflow-based models from user-saved ComfyUI workflows.
   */
  async discoverModels(): Promise<LocalModel[]> {
    const installPath = getProviderInstallPath(this.name) ?? null;
    return discoverWorkflows(this.getBaseUrl(), installPath);
  }

  /**
   * Generate an image using a ComfyUI workflow, with progress tracking.
   */
  async generateImage(
    _model: string,
    _prompt: string,
    options?: ImageGenerationOptions,
    onProgress?: (progress: ImageGenerationProgress) => void,
  ): Promise<ImageGenerationResult> {
    if (!options?.workflow) {
      throw new Error('ComfyUI image generation requires a workflow');
    }

    const result = await executeWorkflow({
      baseUrl: this.getBaseUrl(),
      workflow: options.workflow,
      onProgress: onProgress
        ? (p) => onProgress({ step: p.step, totalSteps: p.totalSteps })
        : undefined,
    });

    return {
      imageBase64: result.dataBase64,
      mimeType: result.mimeType,
    };
  }

  /**
   * Generate a video using a ComfyUI workflow.
   */
  async generateVideo(
    _model: string,
    _prompt: string,
    options?: VideoGenerationOptions,
    onProgress?: (progress: VideoGenerationProgress) => void,
  ): Promise<VideoGenerationResult> {
    if (!options?.workflow) {
      throw new Error('ComfyUI video generation requires a workflow');
    }

    const result = await executeWorkflow({
      baseUrl: this.getBaseUrl(),
      workflow: options.workflow,
      onProgress: onProgress
        ? (p) =>
            onProgress({
              step: p.step,
              totalSteps: p.totalSteps,
              currentNode: p.currentNode,
            })
        : undefined,
    });

    return {
      videoBase64: result.dataBase64,
      mimeType: result.mimeType,
    };
  }
}

export default new ComfyUIProvider();
