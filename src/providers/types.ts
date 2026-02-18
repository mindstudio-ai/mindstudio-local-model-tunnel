// Model capability types
export type ModelCapability = 'text' | 'image' | 'video';

// ============================================
// Instruction Types
// ============================================

export interface InstructionStep {
  text: string;
  command?: string;
}

export interface InstructionSet {
  macos?: InstructionStep[];
  linux?: InstructionStep[];
  windows?: InstructionStep[];
}

export interface ProviderInstructions {
  install: InstructionSet;
  start: InstructionSet;
  stop?: InstructionSet;
}

// ============================================
// Parameter Schema Types (for UI configuration)
// ============================================

export interface SelectOption {
  label: string;
  value: string | number | boolean;
}

export interface NumberOptions {
  min?: number;
  max?: number;
  step?: number;
}

export interface BaseParameterSchema {
  variable: string;
  label: string;
  helpText?: string;
}

export interface SelectParameterSchema extends BaseParameterSchema {
  type: 'select';
  defaultValue: string | number | boolean;
  selectOptions: SelectOption[];
}

export interface NumberParameterSchema extends BaseParameterSchema {
  type: 'number';
  defaultValue?: number;
  numberOptions?: NumberOptions;
}

export interface TextParameterSchema extends BaseParameterSchema {
  type: 'text';
  defaultValue?: string;
  placeholder?: string;
}

export interface BooleanParameterSchema extends BaseParameterSchema {
  type: 'boolean';
  defaultValue?: boolean;
}

export type ParameterSchema =
  | SelectParameterSchema
  | NumberParameterSchema
  | TextParameterSchema
  | BooleanParameterSchema;

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
  warning?: string;
}

// ============================================
// Provider Interface
// ============================================

export interface Provider {
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly baseUrl: string;
  readonly capabilities: readonly ModelCapability[];
  readonly instructions: ProviderInstructions;

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
  ): Promise<ImageGenerationResult>;

  generateImageWithProgress?(
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
