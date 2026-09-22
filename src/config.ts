import Conf from 'conf';
import os from 'node:os';
import path from 'node:path';

export type Environment = 'prod' | 'local';

interface EnvironmentConfig {
  apiKey?: string;
  userId?: string;
  apiBaseUrl: string;
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
  },
  local: {
    apiBaseUrl: 'http://localhost:3129',
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

// Get config for current environment
function getEnvConfig(): EnvironmentConfig {
  const env = getEnvironment();
  return config.get(`environments.${env}`) as EnvironmentConfig;
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

// User ID (per environment)
export function getUserId(): string | undefined {
  return getEnvConfig().userId;
}

export function setUserId(id: string): void {
  setEnvConfig('userId', id);
}

// API Base URL (per environment)
export function getApiBaseUrl(): string {
  return getEnvConfig().apiBaseUrl;
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
