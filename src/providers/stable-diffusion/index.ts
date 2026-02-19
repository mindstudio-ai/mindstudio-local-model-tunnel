import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getProviderBaseUrl, getProviderInstallPath } from '../../config';
import readme from './readme.md';
import type {
  Provider,
  LocalModel,
  ImageGenerationOptions,
  ImageGenerationResult,
  ImageGenerationProgress,
  ParameterSchema,
  ProviderSetupStatus,
} from '../types';

/**
 * Response from AUTOMATIC1111's /sdapi/v1/sd-models endpoint
 */
interface SDModel {
  title: string;
  model_name: string;
  hash?: string;
  sha256?: string;
  filename: string;
}

/**
 * Response from AUTOMATIC1111's /sdapi/v1/txt2img endpoint
 */
interface Txt2ImgResponse {
  images: string[];
  parameters: Record<string, unknown>;
  info: string;
}

/**
 * Response from AUTOMATIC1111's /sdapi/v1/progress endpoint
 */
interface ProgressResponse {
  progress: number;
  eta_relative: number;
  state: {
    skipped: boolean;
    interrupted: boolean;
    job: string;
    job_count: number;
    job_timestamp: string;
    job_no: number;
    sampling_step: number;
    sampling_steps: number;
  };
  current_image?: string;
  textinfo?: string;
}

/**
 * Response from AUTOMATIC1111's /sdapi/v1/samplers endpoint
 */
interface SDSampler {
  name: string;
  aliases: string[];
  options: Record<string, unknown>;
}

/**
 * Stable Diffusion provider for AUTOMATIC1111 WebUI
 * Default URL: http://127.0.0.1:7860
 */
class StableDiffusionProvider implements Provider {
  readonly name = 'stable-diffusion';
  readonly displayName = 'Stable Diffusion WebUI';
  readonly description = 'Generate images locally using Stable Diffusion checkpoints. Runs as a local web UI.';
  readonly capabilities = ['image'] as const;
  readonly readme = readme;
  readonly defaultBaseUrl = 'http://127.0.0.1:7860';

  get baseUrl(): string {
    return getProviderBaseUrl(this.name, this.defaultBaseUrl);
  }

  private getBaseUrl(): string {
    return this.baseUrl;
  }

  async isRunning(): Promise<boolean> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/sdapi/v1/sd-models`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async discoverModels(): Promise<LocalModel[]> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/sdapi/v1/sd-models`);

      if (!response.ok) {
        return [];
      }

      const models = (await response.json()) as SDModel[];

      return models.map((m) => ({
        name: m.model_name,
        provider: this.name,
        capability: 'image' as const,
      }));
    } catch {
      return [];
    }
  }

  async detect(): Promise<ProviderSetupStatus> {
    const savedPath = getProviderInstallPath(this.name);

    const possiblePaths = [
      ...(savedPath ? [savedPath] : []),
      path.join(os.homedir(), 'stable-diffusion-webui'),
      path.join(os.homedir(), 'Projects', 'stable-diffusion-webui'),
      path.join(os.homedir(), 'Code', 'stable-diffusion-webui'),
    ];

    let installed = false;
    for (const p of possiblePaths) {
      if (
        fs.existsSync(path.join(p, 'launch.py')) ||
        fs.existsSync(path.join(p, 'webui.sh')) ||
        fs.existsSync(path.join(p, 'webui.bat'))
      ) {
        installed = true;
        break;
      }
    }

    let running = false;
    try {
      const response = await fetch('http://127.0.0.1:7860/sdapi/v1/sd-models', {
        signal: AbortSignal.timeout(1000),
      });
      running = response.ok;
      if (running) installed = true;
    } catch {
      running = false;
    }

    return { installed, running };
  }

  /**
   * Get the currently loaded model
   */
  async getCurrentModel(): Promise<string | null> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/sdapi/v1/options`);
      if (!response.ok) return null;

      const options = (await response.json()) as {
        sd_model_checkpoint?: string;
      };
      return options.sd_model_checkpoint || null;
    } catch {
      return null;
    }
  }

  /**
   * Switch to a different model
   */
  async setModel(modelName: string): Promise<void> {
    const response = await fetch(`${this.getBaseUrl()}/sdapi/v1/options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sd_model_checkpoint: modelName }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to switch model: ${error}`);
    }
  }

  async generateImage(
    model: string,
    prompt: string,
    options?: ImageGenerationOptions,
    onProgress?: (progress: ImageGenerationProgress) => void,
  ): Promise<ImageGenerationResult> {
    const currentModel = await this.getCurrentModel();
    if (currentModel && !currentModel.includes(model)) {
      await this.setModel(model);
    }

    const payload = {
      prompt,
      negative_prompt: options?.negativePrompt || '',
      steps: options?.steps || 20,
      width: options?.width || 512,
      height: options?.height || 512,
      cfg_scale: options?.cfgScale || 7,
      seed: options?.seed ?? -1,
      sampler_name: options?.sampler || 'Euler a',
    };

    const generatePromise = fetch(`${this.getBaseUrl()}/sdapi/v1/txt2img`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (onProgress) {
      const pollProgress = async () => {
        while (true) {
          try {
            const response = await fetch(
              `${this.getBaseUrl()}/sdapi/v1/progress`,
            );
            if (!response.ok) break;

            const progress = (await response.json()) as ProgressResponse;

            onProgress({
              step: progress.state.sampling_step,
              totalSteps: progress.state.sampling_steps,
              preview: progress.current_image,
            });

            if (progress.progress >= 1.0) break;

            await new Promise((resolve) => setTimeout(resolve, 500));
          } catch {
            break;
          }
        }
      };

      pollProgress().catch(() => {});
    }

    const response = await generatePromise;

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Image generation failed: ${response.status} ${error}`);
    }

    const result = (await response.json()) as Txt2ImgResponse;

    if (!result.images || result.images.length === 0) {
      throw new Error('No images returned from Stable Diffusion');
    }

    let info: Record<string, unknown> = {};
    let seed: number | undefined;
    try {
      info = JSON.parse(result.info);
      seed = typeof info.seed === 'number' ? info.seed : undefined;
    } catch {
      // Ignore parse errors
    }

    return {
      imageBase64: result.images[0],
      mimeType: 'image/png',
      seed,
      info,
    };
  }

  /**
   * Fetch available samplers from the backend
   */
  private async getSamplers(): Promise<string[]> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/sdapi/v1/samplers`);
      if (!response.ok) return this.getDefaultSamplers();

      const samplers = (await response.json()) as SDSampler[];
      return samplers.map((s) => s.name);
    } catch {
      return this.getDefaultSamplers();
    }
  }

  private getDefaultSamplers(): string[] {
    return [
      'Euler a',
      'Euler',
      'LMS',
      'Heun',
      'DPM2',
      'DPM2 a',
      'DPM++ 2S a',
      'DPM++ 2M',
      'DPM++ SDE',
      'DPM fast',
      'DPM adaptive',
      'LMS Karras',
      'DPM2 Karras',
      'DPM2 a Karras',
      'DPM++ 2S a Karras',
      'DPM++ 2M Karras',
      'DPM++ SDE Karras',
      'DDIM',
      'PLMS',
      'UniPC',
    ];
  }

  private generateDimensionOptions(): Array<{ label: string; value: string }> {
    const options: Array<{ label: string; value: string }> = [];
    for (let size = 256; size <= 2048; size += 64) {
      options.push({
        label: `${size}px`,
        value: String(size),
      });
    }
    return options;
  }

  async getParameterSchemas(): Promise<ParameterSchema[]> {
    const samplers = await this.getSamplers();
    const dimensionOptions = this.generateDimensionOptions();

    return [
      {
        type: 'select',
        label: 'Sampler',
        variable: 'sampler',
        helpText: 'The sampling method used for image generation',
        defaultValue: 'Euler a',
        selectOptions: samplers.map((name) => ({
          label: name,
          value: name,
        })),
      },
      {
        type: 'select',
        label: 'Width',
        variable: 'width',
        defaultValue: '512',
        selectOptions: dimensionOptions,
      },
      {
        type: 'select',
        label: 'Height',
        variable: 'height',
        defaultValue: '512',
        selectOptions: dimensionOptions,
      },
      {
        type: 'number',
        label: 'Steps',
        variable: 'steps',
        helpText:
          'Number of denoising steps. More steps = higher quality but slower.',
        defaultValue: '20',
        numberOptions: {
          min: 1,
          max: 150,
          step: 1,
        },
      },
      {
        type: 'number',
        label: 'CFG Scale',
        variable: 'cfgScale',
        helpText:
          'How strongly the image should follow the prompt. Higher = more literal.',
        defaultValue: '7',
        numberOptions: {
          min: 1,
          max: 30,
          step: 0.5,
        },
      },
      {
        type: 'seed',
        label: 'Seed',
        variable: 'seed',
        helpText:
          "A specific value used to guide the 'randomness' of generation. Use -1 for random.",
        defaultValue: '-1',
      },
      {
        type: 'text',
        label: 'Negative Prompt',
        variable: 'negativePrompt',
        helpText: "Things you don't want in the image",
        placeholder: 'blurry, low quality, distorted',
      },
    ];
  }
}

export default new StableDiffusionProvider();
