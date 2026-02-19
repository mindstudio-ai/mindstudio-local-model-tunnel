// Model capability types
export type ModelCapability = 'text' | 'image' | 'video';

// ============================================
// Parameter Schema Types (for UI configuration)
// ============================================

export interface SelectOption {
  label?: string;
  value: string;
}

export interface NumberOptions {
  min: number;
  max: number;
  step?: number;
}

export interface LorasOptions {
  maxItems?: number;
  civitBaseModelName?: string;
  civitBaseModelNameImageAlt?: string;
}

export interface BaseParameterSchema {
  variable: string;
  label: string;
  helpText?: string;
  defaultValue?: string;
}

export interface TextParameterSchema extends BaseParameterSchema {
  type: 'text';
  placeholder?: string;
}

export interface PromptParameterSchema extends BaseParameterSchema {
  type: 'prompt';
  placeholder?: string;
}

export interface ImageUrlParameterSchema extends BaseParameterSchema {
  type: 'imageUrl';
}

export interface VideoUrlParameterSchema extends BaseParameterSchema {
  type: 'videoUrl';
}

export interface SelectParameterSchema extends BaseParameterSchema {
  type: 'select';
  selectOptions: SelectOption[];
  allowCustomValue?: boolean;
}

export interface NumberParameterSchema extends BaseParameterSchema {
  type: 'number';
  numberOptions?: NumberOptions;
}

export interface TextArrayParameterSchema extends BaseParameterSchema {
  type: 'textArray';
}

export interface ImageUrlArrayParameterSchema extends BaseParameterSchema {
  type: 'imageUrlArray';
}

export interface ToggleGroupParameterSchema extends BaseParameterSchema {
  type: 'toggleGroup';
  toggleGroupOptions: SelectOption[];
  isBooleanValue?: boolean;
}

export interface LorasParameterSchema extends BaseParameterSchema {
  type: 'loras';
  lorasOptions?: LorasOptions;
}

export interface SeedParameterSchema extends BaseParameterSchema {
  type: 'seed';
}

export interface ComfyWorkflowOptions {
  availableWorkflows: Array<{
    name: string;
    workflow: Record<string, unknown>;
  }>;
}

export interface ComfyWorkflowParameterSchema extends BaseParameterSchema {
  type: 'comfyWorkflow';
  comfyWorkflowOptions: ComfyWorkflowOptions;
}

export type ParameterSchema =
  | TextParameterSchema
  | PromptParameterSchema
  | ImageUrlParameterSchema
  | VideoUrlParameterSchema
  | SelectParameterSchema
  | NumberParameterSchema
  | TextArrayParameterSchema
  | ImageUrlArrayParameterSchema
  | ToggleGroupParameterSchema
  | LorasParameterSchema
  | SeedParameterSchema
  | ComfyWorkflowParameterSchema;

// ============================================
// Model Types
// ============================================

export interface LocalModel {
  name: string;
  provider: string;
  capability: ModelCapability;
  size?: number;
  parameterSize?: string;
  quantization?: string;
  /** Parameter schemas for UI configuration */
  parameters?: ParameterSchema[];
  /** Optional hint shown in the TUI (e.g. "restart required") — not synced as a model */
  statusHint?: string;
}

// ============================================
// Text Generation Types
// ============================================

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResponse {
  content: string;
  done: boolean;
}

// ============================================
// Image Generation Types
// ============================================

export interface ImageGenerationOptions {
  negativePrompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfgScale?: number;
  seed?: number;
  sampler?: string;
  workflow?: Record<string, unknown>;
}

export interface ImageGenerationResult {
  /** Base64-encoded image data */
  imageBase64: string;
  /** MIME type (e.g., "image/png") */
  mimeType: string;
  /** Seed used for generation (for reproducibility) */
  seed?: number;
  /** Generation info/metadata */
  info?: Record<string, unknown>;
}

export interface ImageGenerationProgress {
  /** Current step */
  step: number;
  /** Total steps */
  totalSteps: number;
  /** Optional preview image (base64) */
  preview?: string;
}

// ============================================
// Video Generation Types
// ============================================

export interface VideoGenerationOptions {
  negativePrompt?: string;
  width?: number;
  height?: number;
  numFrames?: number;
  fps?: number;
  steps?: number;
  cfgScale?: number;
  seed?: number;
  workflow?: Record<string, unknown>;
}

export interface VideoGenerationResult {
  /** Base64-encoded video data */
  videoBase64: string;
  /** MIME type (e.g., "video/webp", "video/mp4") */
  mimeType: string;
  /** Duration in seconds */
  duration?: number;
  /** Frames per second */
  fps?: number;
  /** Seed used for generation (for reproducibility) */
  seed?: number;
  /** Generation info/metadata */
  info?: Record<string, unknown>;
}

export interface VideoGenerationProgress {
  /** Current step */
  step: number;
  /** Total steps */
  totalSteps: number;
  /** Current node being executed */
  currentNode?: string;
}

// ============================================
// Provider Status
// ============================================

export interface ProviderSetupStatus {
  installed: boolean;
  running: boolean;
}

// ============================================
// Provider Interface
// ============================================

export interface Provider {
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly defaultBaseUrl: string;
  readonly baseUrl: string;
  readonly capabilities: readonly ModelCapability[];
  readonly readme: string;

  isRunning(): Promise<boolean>;
  detect(): Promise<ProviderSetupStatus>;
  discoverModels(): Promise<LocalModel[]>;

  // Optional generation methods — present based on capabilities
  chat?(
    model: string,
    messages: ChatMessage[],
    options?: ChatOptions,
  ): AsyncGenerator<ChatResponse>;

  generateImage?(
    model: string,
    prompt: string,
    options?: ImageGenerationOptions,
    onProgress?: (progress: ImageGenerationProgress) => void,
  ): Promise<ImageGenerationResult>;

  generateVideo?(
    model: string,
    prompt: string,
    options?: VideoGenerationOptions,
    onProgress?: (progress: VideoGenerationProgress) => void,
  ): Promise<VideoGenerationResult>;

  getParameterSchemas?(): Promise<ParameterSchema[]>;
}

// ============================================
// Type Guards (method-existence based)
// ============================================

export function isTextProvider(p: Provider): boolean {
  return typeof p.chat === 'function';
}

export function isImageProvider(p: Provider): boolean {
  return typeof p.generateImage === 'function';
}

export function isVideoProvider(p: Provider): boolean {
  return typeof p.generateVideo === 'function';
}
