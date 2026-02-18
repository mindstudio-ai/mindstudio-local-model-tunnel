// Main exports for programmatic use
export { TunnelRunner } from './runner';
export {
  requestEvents,
  type RequestStartEvent,
  type RequestProgressEvent,
  type RequestCompleteEvent,
} from './events';
export { sleep, waitForEnter, clearTerminal, LogoString } from './helpers';
export {
  // Discovery functions
  discoverAllModels,
  discoverAllModelsWithParameters,
  discoverModelsByCapability,
  discoverRunningProviders,
  getProvider,
  getProviderStatuses,
  getProvidersByCapability,
  isAnyProviderRunning,
  // Type guards
  isTextProvider,
  isImageProvider,
  isVideoProvider,
  // Types
  type Provider,
  type LocalModel,
  type ModelCapability,
  type ProviderSetupStatus,
  type InstructionStep,
  type InstructionSet,
  type ProviderInstructions,
  type ChatMessage,
  type ChatOptions,
  type ChatResponse,
  type ImageGenerationOptions,
  type ImageGenerationResult,
  type ImageGenerationProgress,
  type VideoGenerationOptions,
  type VideoGenerationResult,
  type VideoGenerationProgress,
  // Parameter schema types
  type ParameterSchema,
  type SelectParameterSchema,
  type NumberParameterSchema,
  type TextParameterSchema,
  type BooleanParameterSchema,
  type SelectOption,
  type NumberOptions,
} from './providers';
export {
  getApiKey,
  setApiKey,
  clearApiKey,
  getApiBaseUrl,
  setApiBaseUrl,
  getEnvironment,
  setEnvironment,
  type Environment,
} from './config';
export {
  verifyApiKey,
  pollForRequest,
  submitProgress,
  submitGenerationProgress,
  submitResult,
  registerLocalModel,
  type TextResult,
  type ImageResult,
  type RequestResult,
  type RegisterModelOptions,
  type ModelTypeMindStudio,
} from './api';
