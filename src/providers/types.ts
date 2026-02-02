// Provider types - text and image generation
export type TextProviderType = "ollama" | "lmstudio";
export type ImageProviderType = "stable-diffusion";
export type ProviderType = TextProviderType | ImageProviderType;

// Model capability types
export type ModelCapability = "text" | "image" | "video";

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
  type: "select";
  defaultValue: string | number | boolean;
  selectOptions: SelectOption[];
}

export interface NumberParameterSchema extends BaseParameterSchema {
  type: "number";
  defaultValue?: number;
  numberOptions?: NumberOptions;
}

export interface TextParameterSchema extends BaseParameterSchema {
  type: "text";
  defaultValue?: string;
  placeholder?: string;
}

export interface BooleanParameterSchema extends BaseParameterSchema {
  type: "boolean";
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
  provider: ProviderType;
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
  role: "user" | "assistant" | "system";
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
// Provider Interfaces
// ============================================

/**
 * Base provider interface - all providers implement this
 */
export interface BaseProvider {
  readonly name: ProviderType;
  readonly displayName: string;
  readonly capability: ModelCapability;

  /**
   * Check if the provider's backend is running and accessible
   */
  isRunning(): Promise<boolean>;

  /**
   * Discover all available models from this provider
   */
  discoverModels(): Promise<LocalModel[]>;
}

/**
 * Text generation provider (LLMs)
 */
export interface TextProvider extends BaseProvider {
  readonly capability: "text";

  /**
   * Stream a chat completion
   */
  chat(
    model: string,
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<ChatResponse>;
}

/**
 * Image generation provider
 */
export interface ImageProvider extends BaseProvider {
  readonly capability: "image";

  /**
   * Generate an image from a prompt
   */
  generateImage(
    model: string,
    prompt: string,
    options?: ImageGenerationOptions
  ): Promise<ImageGenerationResult>;

  /**
   * Generate an image with progress callback (optional)
   */
  generateImageWithProgress?(
    model: string,
    prompt: string,
    options?: ImageGenerationOptions,
    onProgress?: (progress: ImageGenerationProgress) => void
  ): Promise<ImageGenerationResult>;

  /**
   * Get parameter schemas for UI configuration
   * Dynamically discovers available options from the backend
   */
  getParameterSchemas(): Promise<ParameterSchema[]>;
}

/**
 * Union type for all providers
 */
export type Provider = TextProvider | ImageProvider;

/**
 * Type guard for text providers
 */
export function isTextProvider(provider: Provider): provider is TextProvider {
  return provider.capability === "text";
}

/**
 * Type guard for image providers
 */
export function isImageProvider(provider: Provider): provider is ImageProvider {
  return provider.capability === "image";
}
