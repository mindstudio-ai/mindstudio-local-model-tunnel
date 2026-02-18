/**
 * Wan2.1 text-to-video workflow template for ComfyUI.
 *
 * Uses ComfyUI's native Wan 2.1 support (no custom nodes required).
 * Diffusion model: wan2.1_t2v_1.3B_fp16.safetensors in models/diffusion_models/
 * Text encoder: umt5_xxl_fp8_e4m3fn_scaled.safetensors in models/text_encoders/
 * VAE: wan_2.1_vae.safetensors in models/vae/
 */

export interface Wan21Params {
  /** Diffusion model filename */
  model: string;
  /** Text encoder filename */
  textEncoder: string;
  /** VAE filename */
  vae: string;
  /** Positive prompt */
  prompt: string;
  /** Negative prompt */
  negativePrompt: string;
  /** Video width */
  width: number;
  /** Video height */
  height: number;
  /** Number of frames to generate */
  numFrames: number;
  /** Frames per second for output */
  fps: number;
  /** Number of sampling steps */
  steps: number;
  /** CFG scale */
  cfgScale: number;
  /** Random seed (-1 for random) */
  seed: number;
}

export const WAN21_DEFAULTS: Wan21Params = {
  model: 'wan2.1_t2v_1.3B_fp16.safetensors',
  textEncoder: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
  vae: 'wan_2.1_vae.safetensors',
  prompt: '',
  negativePrompt: 'worst quality, blurry, distorted',
  width: 480,
  height: 320,
  numFrames: 25,
  fps: 8,
  steps: 20,
  cfgScale: 5.0,
  seed: -1,
};

/**
 * Build a Wan2.1 text-to-video workflow in ComfyUI API format.
 */
export function buildWan21Workflow(
  params: Partial<Wan21Params> & { prompt: string },
): Record<string, unknown> {
  const p = { ...WAN21_DEFAULTS, ...params };
  const seed = p.seed === -1 ? Math.floor(Math.random() * 2 ** 32) : p.seed;

  return {
    // Node 1: Load diffusion model (UNET)
    '1': {
      class_type: 'UNETLoader',
      inputs: {
        unet_name: p.model,
        weight_dtype: 'default',
      },
    },
    // Node 2: Load text encoder (UMT5-XXL)
    '2': {
      class_type: 'CLIPLoader',
      inputs: {
        clip_name: p.textEncoder,
        type: 'wan',
      },
    },
    // Node 3: Load VAE
    '3': {
      class_type: 'VAELoader',
      inputs: {
        vae_name: p.vae,
      },
    },
    // Node 4: Positive prompt encoding
    '4': {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: p.prompt,
        clip: ['2', 0],
      },
    },
    // Node 5: Negative prompt encoding
    '5': {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: p.negativePrompt,
        clip: ['2', 0],
      },
    },
    // Node 6: Empty latent image (for video frames)
    '6': {
      class_type: 'EmptySD3LatentImage',
      inputs: {
        width: p.width,
        height: p.height,
        batch_size: p.numFrames,
      },
    },
    // Node 7: KSampler
    '7': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['4', 0],
        negative: ['5', 0],
        latent_image: ['6', 0],
        seed: seed,
        steps: p.steps,
        cfg: p.cfgScale,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1.0,
      },
    },
    // Node 8: VAE Decode
    '8': {
      class_type: 'VAEDecode',
      inputs: {
        samples: ['7', 0],
        vae: ['3', 0],
      },
    },
    // Node 9: Save as MP4 via VideoHelperSuite
    '9': {
      class_type: 'VHS_VideoCombine',
      inputs: {
        images: ['8', 0],
        frame_rate: p.fps,
        loop_count: 0,
        filename_prefix: 'wan21_output',
        format: 'video/h264-mp4',
        pingpong: false,
        save_output: true,
      },
    },
  };
}

/** Output node ID for fetching results */
export const WAN21_OUTPUT_NODE = '9';
