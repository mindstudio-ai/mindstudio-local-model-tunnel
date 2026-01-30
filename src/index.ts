// Main exports for programmatic use
export { LocalModelRunner } from "./runner.js";
export {
  discoverAllModels,
  discoverRunningProviders,
  getProvider,
  getProviderStatuses,
  isAnyProviderRunning,
  OllamaProvider,
  LMStudioProvider,
  type Provider,
  type LocalModel,
  type ProviderType,
  type ChatMessage,
  type ChatOptions,
  type ChatResponse,
} from "./providers/index.js";
export {
  getApiKey,
  setApiKey,
  clearApiKey,
  getApiBaseUrl,
  setApiBaseUrl,
  getOllamaBaseUrl,
  setOllamaBaseUrl,
  getLMStudioBaseUrl,
  setLMStudioBaseUrl,
  getEnvironment,
  setEnvironment,
  type Environment,
} from "./config.js";
export {
  verifyApiKey,
  pollForRequest,
  submitProgress,
  submitResult,
} from "./api.js";
