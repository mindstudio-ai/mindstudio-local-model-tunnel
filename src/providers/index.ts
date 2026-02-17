import { OllamaProvider } from './ollama.js';
import { LMStudioProvider } from './lmstudio.js';
import { StableDiffusionProvider } from './stable-diffusion.js';
import { ComfyUIProvider } from './comfyui.js';
import type {
  Provider,
  TextProvider,
  ImageProvider,
  VideoProvider,
  LocalModel,
  ProviderType,
  ProviderSetupStatus,
  ModelCapability,
} from './types.js';
import { isTextProvider, isImageProvider, isVideoProvider } from './types.js';

export * from './types.js';
export { OllamaProvider } from './ollama.js';
export { LMStudioProvider } from './lmstudio.js';
export { StableDiffusionProvider } from './stable-diffusion.js';
export { ComfyUIProvider } from './comfyui.js';

// Registry of all available providers
export const allProviders: Provider[] = [
  new OllamaProvider(),
  new LMStudioProvider(),
  new StableDiffusionProvider(),
  new ComfyUIProvider(),
];

/**
 * Get a provider instance by name
 */
export function getProvider(name: ProviderType): Provider | undefined {
  return allProviders.find((p) => p.name === name);
}

/**
 * Discover which providers are currently running
 */
export async function discoverRunningProviders(): Promise<Provider[]> {
  const results = await Promise.all(
    allProviders.map(async (provider) => ({
      provider,
      running: await provider.isRunning(),
    })),
  );

  return results.filter((r) => r.running).map((r) => r.provider);
}

/**
 * Discover all models from all running providers
 */
export async function discoverAllModels(): Promise<LocalModel[]> {
  const runningProviders = await discoverRunningProviders();

  const modelArrays = await Promise.all(
    runningProviders.map((p) => p.discoverModels()),
  );

  return modelArrays.flat();
}

/**
 * Check if any provider is running
 */
export async function isAnyProviderRunning(): Promise<boolean> {
  const results = await Promise.all(allProviders.map((p) => p.isRunning()));
  return results.some((r) => r);
}

/**
 * Get provider status for all providers
 */
export async function getProviderStatuses(): Promise<
  Array<{ provider: Provider; running: boolean }>
> {
  return Promise.all(
    allProviders.map(async (provider) => ({
      provider,
      running: await provider.isRunning(),
    })),
  );
}

/**
 * Get all text providers
 */
export function getTextProviders(): TextProvider[] {
  return allProviders.filter(isTextProvider);
}

/**
 * Get all image providers
 */
export function getImageProviders(): ImageProvider[] {
  return allProviders.filter(isImageProvider);
}

/**
 * Get a text provider by name
 */
export function getTextProvider(name: ProviderType): TextProvider | undefined {
  const provider = allProviders.find((p) => p.name === name);
  return provider && isTextProvider(provider) ? provider : undefined;
}

/**
 * Get an image provider by name
 */
export function getImageProvider(
  name: ProviderType,
): ImageProvider | undefined {
  const provider = allProviders.find((p) => p.name === name);
  return provider && isImageProvider(provider) ? provider : undefined;
}

/**
 * Get all video providers
 */
export function getVideoProviders(): VideoProvider[] {
  return allProviders.filter(isVideoProvider);
}

/**
 * Get a video provider by name
 */
export function getVideoProvider(
  name: ProviderType,
): VideoProvider | undefined {
  const provider = allProviders.find((p) => p.name === name);
  return provider && isVideoProvider(provider) ? provider : undefined;
}

/**
 * Discover models filtered by capability
 */
export async function discoverModelsByCapability(
  capability: ModelCapability,
): Promise<LocalModel[]> {
  const runningProviders = await discoverRunningProviders();
  const filteredProviders = runningProviders.filter(
    (p) => p.capability === capability,
  );

  const modelArrays = await Promise.all(
    filteredProviders.map((p) => p.discoverModels()),
  );

  return modelArrays.flat();
}

/**
 * Detect installation/running status for all providers
 */
export async function detectAllProviderStatuses(): Promise<
  Array<{ provider: Provider; status: ProviderSetupStatus }>
> {
  return Promise.all(
    allProviders.map(async (provider) => ({
      provider,
      status: await provider.detect(),
    })),
  );
}

/**
 * Discover all models with their parameter schemas
 * For image providers, fetches available parameters dynamically
 */
export async function discoverAllModelsWithParameters(): Promise<LocalModel[]> {
  const runningProviders = await discoverRunningProviders();

  const modelsWithParams = await Promise.all(
    runningProviders.map(async (provider) => {
      const models = await provider.discoverModels();

      // For image/video providers, fetch parameter schemas
      if (isImageProvider(provider) || isVideoProvider(provider)) {
        const parameters = await provider.getParameterSchemas();
        return models.map((model) => ({
          ...model,
          parameters,
        }));
      }

      return models;
    }),
  );

  return modelsWithParams.flat();
}
