import Conf from 'conf';
import os from 'node:os';
import path from 'node:path';

export type Environment = 'prod' | 'local';

interface EnvironmentConfig {
  apiKey?: string;
  userId?: string;
  apiBaseUrl: string;
  dbWsUrl: string;
}

interface ConfigSchema {
  environment: Environment;
  providerBaseUrls: Record<string, string>;
  providerInstallPaths: Record<string, string>;
  localInterfaces: Record<string, string>;
  environments: {
    prod: EnvironmentConfig;
    local: EnvironmentConfig;
  };
}

/**
 * Built-in per-environment defaults.
 *
 * Named separately from the `Conf` `defaults` below because `getEnvConfig` has to apply them per
 * key: `conf`'s own merge is shallow, so a stored `environments` object shadows this one whole.
 */
const DEFAULT_ENVIRONMENTS: Record<Environment, EnvironmentConfig> = {
  prod: {
    apiBaseUrl: 'https://api.mindstudio.ai',
    dbWsUrl: 'wss://api-socket.mindstudio.ai/db',
  },
  local: {
    apiBaseUrl: 'http://localhost:3129',
    dbWsUrl: 'ws://localhost:8888/db',
  },
};

export const config = new Conf<ConfigSchema>({
  projectName: 'mindstudio-local',
  cwd: path.join(os.homedir(), '.mindstudio-local-tunnel'),
  configName: 'config',
  defaults: {
    environment: 'prod',
    providerBaseUrls: {},
    providerInstallPaths: {},
    localInterfaces: {},
    environments: DEFAULT_ENVIRONMENTS,
  },
});

// Environment management
export function getEnvironment(): Environment {
  return config.get('environment');
}

export function setEnvironment(env: Environment): void {
  config.set('environment', env);
}

/**
 * Config for the current environment, with the built-in defaults filled in per key.
 *
 * Per KEY, and that is the whole point. `conf` merges its `defaults` into the stored file
 * SHALLOWLY, so a config.json written before a key existed — which is every config on a machine
 * that has run an older build, and every one the sandbox writes — carries `environments` as a whole
 * object and replaces the default `environments` entirely. Reading `dbWsUrl` off it then gives
 * `undefined` rather than the default it looks like it should give, and the DB-over-WS transport
 * silently degrades to a fetch per database call. Filling in per key is what makes the fallback the
 * doc comments have always promised actually happen.
 */
function getEnvConfig(): EnvironmentConfig {
  const env = getEnvironment();
  const stored = (config.get(`environments.${env}`) ??
    {}) as Partial<EnvironmentConfig>;
  const defaults = (DEFAULT_ENVIRONMENTS[env] ??
    {}) as Partial<EnvironmentConfig>;
  return { ...defaults, ...stored } as EnvironmentConfig;
}

function setEnvConfig(key: keyof EnvironmentConfig, value: string): void {
  const env = getEnvironment();
  config.set(`environments.${env}.${key}`, value);
}

// API Key (per environment)
export function getApiKey(): string | undefined {
  return getEnvConfig().apiKey;
}

export function setApiKey(key: string): void {
  setEnvConfig('apiKey', key);
}

export function clearApiKey(): void {
  const env = getEnvironment();
  config.delete(`environments.${env}.apiKey` as keyof ConfigSchema);
}

// User ID (per environment)
export function getUserId(): string | undefined {
  return getEnvConfig().userId;
}

export function setUserId(id: string): void {
  setEnvConfig('userId', id);
}

export function clearUserId(): void {
  const env = getEnvironment();
  config.delete(`environments.${env}.userId` as keyof ConfigSchema);
}

// API Base URL (per environment)
export function getApiBaseUrl(): string {
  return getEnvConfig().apiBaseUrl;
}

export function setApiBaseUrl(url: string): void {
  setEnvConfig('apiBaseUrl', url);
}

// DB WebSocket URL (per environment). Falls back to the per-env default so existing persisted
// configs (written before this key existed) still resolve — see `getEnvConfig`, which is where the
// per-key fill-in that makes that true actually happens.
export function getDbWsUrl(): string {
  return getEnvConfig().dbWsUrl;
}

export function setDbWsUrl(url: string): void {
  setEnvConfig('dbWsUrl', url);
}

export function getConfigPath(): string {
  return config.path;
}

// Provider helpers
export function getProviderBaseUrl(name: string, defaultUrl: string): string {
  const urls = config.get('providerBaseUrls');
  return urls[name] ?? defaultUrl;
}

export function setProviderBaseUrl(name: string, url: string): void {
  const urls = config.get('providerBaseUrls');
  urls[name] = url;
  config.set('providerBaseUrls', urls);
}

export function getProviderInstallPath(name: string): string | undefined {
  const paths = config.get('providerInstallPaths');
  return paths[name];
}

export function setProviderInstallPath(
  name: string,
  installPath: string,
): void {
  const paths = config.get('providerInstallPaths');
  paths[name] = installPath;
  config.set('providerInstallPaths', paths);
}

// Local interface helpers
export function getLocalInterfacesDir(): string {
  return path.join(os.homedir(), '.mindstudio-local-tunnel', 'interfaces');
}

export function getLocalInterfacePath(key: string): string | undefined {
  const interfaces = config.get('localInterfaces');
  return interfaces[key];
}

export function setLocalInterfacePath(key: string, dirPath: string): void {
  const interfaces = config.get('localInterfaces');
  interfaces[key] = dirPath;
  config.set('localInterfaces', interfaces);
}

export function deleteLocalInterfacePath(key: string): void {
  const interfaces = config.get('localInterfaces');
  delete interfaces[key];
  config.set('localInterfaces', interfaces);
}

// Get all environment info for display
export function getEnvironmentInfo(): {
  current: Environment;
  apiBaseUrl: string;
  hasApiKey: boolean;
} {
  const env = getEnvironment();
  const envConfig = getEnvConfig();
  return {
    current: env,
    apiBaseUrl: envConfig.apiBaseUrl,
    hasApiKey: !!envConfig.apiKey,
  };
}
