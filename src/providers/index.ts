import { OllamaProvider } from "./ollama.js";
import { LMStudioProvider } from "./lmstudio.js";
import type { Provider, LocalModel, ProviderType } from "./types.js";

export * from "./types.js";
export { OllamaProvider } from "./ollama.js";
export { LMStudioProvider } from "./lmstudio.js";

// Registry of all available providers
const allProviders: Provider[] = [
  new OllamaProvider(),
  new LMStudioProvider(),
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
    }))
  );

  return results.filter((r) => r.running).map((r) => r.provider);
}

/**
 * Discover all models from all running providers
 */
export async function discoverAllModels(): Promise<LocalModel[]> {
  const runningProviders = await discoverRunningProviders();

  const modelArrays = await Promise.all(
    runningProviders.map((p) => p.discoverModels())
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
    }))
  );
}
