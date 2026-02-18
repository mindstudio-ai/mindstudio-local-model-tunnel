/**
 * Workflow registry - maps model filenames to workflow builders.
 */

import {
  buildLtxVideoWorkflow,
  LTX_VIDEO_OUTPUT_NODE,
  LTX_VIDEO_DEFAULTS,
} from './ltx-video';
import {
  buildWan21Workflow,
  WAN21_OUTPUT_NODE,
  WAN21_DEFAULTS,
} from './wan2.1';

export type ModelFamily = 'ltx-video' | 'wan2.1';

export interface WorkflowConfig {
  family: ModelFamily;
  displayName: string;
  /** Build the workflow JSON for ComfyUI's /prompt endpoint */
  buildWorkflow: (params: {
    model: string;
    prompt: string;
    negativePrompt: string;
    width: number;
    height: number;
    numFrames: number;
    fps: number;
    steps: number;
    cfgScale: number;
    seed: number;
  }) => Record<string, unknown>;
  /** Node ID that produces the output (for fetching results from /history) */
  outputNodeId: string;
  /** Default parameters */
  defaults: {
    width: number;
    height: number;
    numFrames: number;
    fps: number;
    steps: number;
    cfgScale: number;
  };
}

/**
 * Known model files and their workflow configurations.
 * Keys are filename patterns (matched case-insensitively).
 */
const MODEL_REGISTRY: Array<{
  /** Pattern to match against model filenames */
  pattern: RegExp;
  config: WorkflowConfig;
}> = [
  // LTX-Video models
  {
    pattern: /ltx[_-]?video/i,
    config: {
      family: 'ltx-video',
      displayName: 'LTX-Video',
      buildWorkflow: (params) =>
        buildLtxVideoWorkflow({
          model: params.model,
          prompt: params.prompt,
          negativePrompt: params.negativePrompt,
          width: params.width,
          height: params.height,
          numFrames: params.numFrames,
          fps: params.fps,
          steps: params.steps,
          cfgScale: params.cfgScale,
          seed: params.seed,
        }),
      outputNodeId: LTX_VIDEO_OUTPUT_NODE,
      defaults: {
        width: LTX_VIDEO_DEFAULTS.width,
        height: LTX_VIDEO_DEFAULTS.height,
        numFrames: LTX_VIDEO_DEFAULTS.numFrames,
        fps: LTX_VIDEO_DEFAULTS.fps,
        steps: LTX_VIDEO_DEFAULTS.steps,
        cfgScale: LTX_VIDEO_DEFAULTS.cfgScale,
      },
    },
  },
  // Wan 2.1 models
  {
    pattern: /wan2[\._]?1/i,
    config: {
      family: 'wan2.1',
      displayName: 'Wan 2.1',
      buildWorkflow: (params) =>
        buildWan21Workflow({
          model: params.model,
          prompt: params.prompt,
          negativePrompt: params.negativePrompt,
          width: params.width,
          height: params.height,
          numFrames: params.numFrames,
          fps: params.fps,
          steps: params.steps,
          cfgScale: params.cfgScale,
          seed: params.seed,
        }),
      outputNodeId: WAN21_OUTPUT_NODE,
      defaults: {
        width: WAN21_DEFAULTS.width,
        height: WAN21_DEFAULTS.height,
        numFrames: WAN21_DEFAULTS.numFrames,
        fps: WAN21_DEFAULTS.fps,
        steps: WAN21_DEFAULTS.steps,
        cfgScale: WAN21_DEFAULTS.cfgScale,
      },
    },
  },
];

/**
 * Find the workflow configuration for a given model filename.
 */
export function getWorkflowForModel(
  modelFilename: string,
): WorkflowConfig | null {
  for (const entry of MODEL_REGISTRY) {
    if (entry.pattern.test(modelFilename)) {
      return entry.config;
    }
  }
  return null;
}

/**
 * Check if a model filename is recognized as a video model.
 */
export function isKnownVideoModel(modelFilename: string): boolean {
  return getWorkflowForModel(modelFilename) !== null;
}

/**
 * Get all supported model families.
 */
export function getSupportedFamilies(): WorkflowConfig[] {
  return MODEL_REGISTRY.map((entry) => entry.config);
}

export { buildLtxVideoWorkflow } from './ltx-video';
export { buildWan21Workflow } from './wan2.1';
