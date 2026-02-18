import ollama from './ollama';
import lmstudio from './lmstudio';
import stableDiffusion from './stable-diffusion';
import comfyui from './comfyui';
import type {
  Provider,
  LocalModel,
  ProviderSetupStatus,
  ModelCapability,
} from './types';

export * from './types';

// Registry of all available providers
export const allProviders: Provider[] = [
  ollama,
  lmstudio,
  stableDiffusion,
  comfyui,
];

/**
 * Get a provider instance by name
 */
export function getProvider(name: string): Provider | undefined {
  return allProviders.find((p) => p.name === name);
}

/**
 * Get all providers that support a given capability
 */
export function getProvidersByCapability(cap: ModelCapability): Provider[] {
  return allProviders.filter((p) => p.capabilities.includes(cap));
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
 * Discover models filtered by capability
 */
export async function discoverModelsByCapability(
  capability: ModelCapability,
): Promise<LocalModel[]> {
  const runningProviders = await discoverRunningProviders();
  const filteredProviders = runningProviders.filter((p) =>
    p.capabilities.includes(capability),
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
 * For providers with getParameterSchemas, fetches available parameters dynamically
 */
export async function discoverAllModelsWithParameters(): Promise<LocalModel[]> {
  const runningProviders = await discoverRunningProviders();

  const modelsWithParams = await Promise.all(
    runningProviders.map(async (provider) => {
      const models = await provider.discoverModels();

      if (typeof provider.getParameterSchemas === 'function') {
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
