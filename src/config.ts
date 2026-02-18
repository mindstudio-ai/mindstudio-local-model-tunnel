import Conf from 'conf';
import os from 'node:os';
import path from 'node:path';

export type Environment = 'prod' | 'local';

interface EnvironmentConfig {
  apiKey?: string;
  apiBaseUrl: string;
}

interface ConfigSchema {
  environment: Environment;
  ollamaBaseUrl: string;
  lmstudioBaseUrl: string;
  stableDiffusionBaseUrl: string;
  stableDiffusionInstallPath?: string;
  comfyuiBaseUrl: string;
  comfyuiInstallPath?: string;
  environments: {
    prod: EnvironmentConfig;
    local: EnvironmentConfig;
  };
}

export const config = new Conf<ConfigSchema>({
  projectName: 'mindstudio-local',
  cwd: path.join(os.homedir(), '.mindstudio-local-tunnel'),
  configName: 'config',
  defaults: {
    environment: 'prod',
    ollamaBaseUrl: 'http://localhost:11434',
    lmstudioBaseUrl: 'http://localhost:1234/v1',
    stableDiffusionBaseUrl: 'http://127.0.0.1:7860',
    comfyuiBaseUrl: 'http://127.0.0.1:8188',
    environments: {
      prod: {
        apiBaseUrl: 'https://api.mindstudio.ai',
      },
      local: {
        apiBaseUrl: 'http://localhost:3129',
      },
    },
  },
});

// Environment management
export function getEnvironment(): Environment {
  return config.get('environment');
}

export function setEnvironment(env: Environment): void {
  config.set('environment', env);
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

export function clearApiKey(): void {
  const env = getEnvironment();
  config.delete(`environments.${env}.apiKey` as keyof ConfigSchema);
}

// API Base URL (per environment)
export function getApiBaseUrl(): string {
  return getEnvConfig().apiBaseUrl;
}

export function setApiBaseUrl(url: string): void {
  setEnvConfig('apiBaseUrl', url);
}

export function getConfigPath(): string {
  return config.path;
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
