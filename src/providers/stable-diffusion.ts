import { getStableDiffusionBaseUrl } from '../config.js';
import type {
  ImageProvider,
  LocalModel,
  ImageGenerationOptions,
  ImageGenerationResult,
  ImageGenerationProgress,
  ParameterSchema,
} from './types.js';

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
  images: string[]; // Base64 encoded images
  parameters: Record<string, unknown>;
  info: string; // JSON string with generation info
}

/**
 * Response from AUTOMATIC1111's /sdapi/v1/progress endpoint
 */
interface ProgressResponse {
  progress: number; // 0.0 to 1.0
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
  current_image?: string; // Base64 preview
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
 * Response from AUTOMATIC1111's /sdapi/v1/upscalers endpoint
 */
interface SDUpscaler {
  name: string;
  model_name: string | null;
  model_path: string | null;
  model_url: string | null;
  scale: number;
}

/**
 * Stable Diffusion provider for AUTOMATIC1111 WebUI
 * Default URL: http://127.0.0.1:7860
 */
export class StableDiffusionProvider implements ImageProvider {
  readonly name = 'stable-diffusion' as const;
  readonly displayName = 'Stable Diffusion';
  readonly capability = 'image' as const;

  private getBaseUrl(): string {
    return getStableDiffusionBaseUrl();
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
  ): Promise<ImageGenerationResult> {
    // Check if we need to switch models
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
      seed: options?.seed ?? -1, // -1 = random
      sampler_name: options?.sampler || 'Euler a',
    };

    const response = await fetch(`${this.getBaseUrl()}/sdapi/v1/txt2img`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Image generation failed: ${response.status} ${error}`);
    }

    const result = (await response.json()) as Txt2ImgResponse;

    if (!result.images || result.images.length === 0) {
      throw new Error('No images returned from Stable Diffusion');
    }

    // Parse generation info
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

  async generateImageWithProgress(
    model: string,
    prompt: string,
    options?: ImageGenerationOptions,
    onProgress?: (progress: ImageGenerationProgress) => void,
  ): Promise<ImageGenerationResult> {
    // Start generation in the background
    const generatePromise = this.generateImage(model, prompt, options);

    // Poll for progress if callback provided
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

            // If progress is complete, stop polling
            if (progress.progress >= 1.0) break;

            // Wait before next poll
            await new Promise((resolve) => setTimeout(resolve, 500));
          } catch {
            break;
          }
        }
      };

      // Run progress polling alongside generation
      pollProgress().catch(() => {});
    }

    return generatePromise;
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

  /**
   * Default samplers if API fetch fails
   */
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

  /**
   * Generate dimension options (256 to 2048 in steps of 64)
   */
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

  /**
   * Get parameter schemas for UI configuration
   * Dynamically discovers available samplers from the backend
   */
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
        defaultValue: 20,
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
        defaultValue: 7,
        numberOptions: {
          min: 1,
          max: 30,
          step: 0.5,
        },
      },
      {
        type: 'number',
        label: 'Seed',
        variable: 'seed',
        helpText:
          "A specific value used to guide the 'randomness' of generation. Use -1 for random.",
        defaultValue: -1,
        numberOptions: {
          min: -1,
          max: 2147483647,
        },
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
