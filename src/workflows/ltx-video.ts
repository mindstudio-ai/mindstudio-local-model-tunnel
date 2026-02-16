/**
 * LTX-Video text-to-video workflow template for ComfyUI.
 *
 * Based on the official ComfyUI LTX-Video example workflow.
 * The checkpoint contains the MODEL + VAE but NOT the text encoder.
 * A separate CLIPLoader with type "ltxv" loads the T5-XXL text encoder.
 *
 * Model: ltx-video-2b-v0.9.5.safetensors in models/checkpoints/
 * Text encoder: t5xxl_fp16.safetensors in models/text_encoders/
 */

export interface LtxVideoParams {
  /** Model checkpoint filename (in models/checkpoints/) */
  model: string;
  /** Text encoder filename (in models/text_encoders/) */
  textEncoder: string;
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

export const LTX_VIDEO_DEFAULTS: LtxVideoParams = {
  model: 'ltx-video-2b-v0.9.5.safetensors',
  textEncoder: 't5xxl_fp16.safetensors',
  prompt: '',
  negativePrompt:
    'worst quality, blurry, distorted, disfigured, motion smear, motion artifacts',
  width: 512,
  height: 320,
  numFrames: 41,
  fps: 8,
  steps: 20,
  cfgScale: 3.0,
  seed: -1,
};

/**
 * Build an LTX-Video text-to-video workflow in ComfyUI API format.
 * Follows the official ComfyUI example workflow structure.
 */
export function buildLtxVideoWorkflow(
  params: Partial<LtxVideoParams> & { prompt: string },
): Record<string, unknown> {
  const p = { ...LTX_VIDEO_DEFAULTS, ...params };
  const seed = p.seed === -1 ? Math.floor(Math.random() * 2 ** 32) : p.seed;

  return {
    // Node 1: Load checkpoint (MODEL + VAE, CLIP output unused)
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: {
        ckpt_name: p.model,
      },
    },
    // Node 2: Load text encoder (T5-XXL) separately
    '2': {
      class_type: 'CLIPLoader',
      inputs: {
        clip_name: p.textEncoder,
        type: 'ltxv',
      },
    },
    // Node 3: Positive prompt encoding (CLIP from CLIPLoader, NOT from checkpoint)
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: p.prompt,
        clip: ['2', 0],
      },
    },
    // Node 4: Negative prompt encoding
    '4': {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: p.negativePrompt,
        clip: ['2', 0],
      },
    },
    // Node 5: Empty latent video
    '5': {
      class_type: 'EmptyLTXVLatentVideo',
      inputs: {
        width: p.width,
        height: p.height,
        length: p.numFrames,
        batch_size: 1,
      },
    },
    // Node 6: KSampler
    '6': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['3', 0],
        negative: ['4', 0],
        latent_image: ['5', 0],
        seed: seed,
        steps: p.steps,
        cfg: p.cfgScale,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1.0,
      },
    },
    // Node 7: VAE Decode (VAE from checkpoint, slot 2)
    '7': {
      class_type: 'VAEDecode',
      inputs: {
        samples: ['6', 0],
        vae: ['1', 2],
      },
    },
    // Node 8: Save as MP4 via VideoHelperSuite
    '8': {
      class_type: 'VHS_VideoCombine',
      inputs: {
        images: ['7', 0],
        frame_rate: p.fps,
        loop_count: 0,
        filename_prefix: 'ltxv_output',
        format: 'video/h264-mp4',
        pingpong: false,
        save_output: true,
      },
    },
  };
}

/** Output node ID for fetching results */
export const LTX_VIDEO_OUTPUT_NODE = '8';
