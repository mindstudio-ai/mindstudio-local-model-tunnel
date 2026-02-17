import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { LocalModel } from '../../providers/types.js';
import type { ConnectionStatus, ProviderStatus } from '../types.js';
import {
  getConfigPath,
  getEnvironmentInfo,
  getOllamaBaseUrl,
  getLMStudioBaseUrl,
  getStableDiffusionBaseUrl,
  getComfyUIBaseUrl,
} from '../../config.js';
import { getConnectionDisplay } from '../helpers.js';
import { useSetupProviders } from '../hooks/useSetupProviders.js';

interface SettingsPageProps {
  connectionStatus: ConnectionStatus;
  environment: 'prod' | 'local';
  models: LocalModel[];
  registeredNames: Set<string>;
  modelsLoading?: boolean;
  providers: ProviderStatus[];
}

const PROVIDER_URL_GETTERS: Record<string, () => string> = {
  ollama: getOllamaBaseUrl,
  lmstudio: getLMStudioBaseUrl,
  'stable-diffusion': getStableDiffusionBaseUrl,
  comfyui: getComfyUIBaseUrl,
};

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
  'stable-diffusion': 'Stable Diffusion',
  comfyui: 'ComfyUI',
};

function getCapabilityLabel(capability: string): { label: string; color: string } {
  switch (capability) {
    case 'text':
      return { label: 'Text Generation', color: 'gray' };
    case 'image':
      return { label: 'Image Generation', color: 'magenta' };
    case 'video':
      return { label: 'Video Generation', color: 'cyan' };
    default:
      return { label: capability, color: 'gray' };
  }
}

export function SettingsPage({
  connectionStatus,
  models,
  registeredNames,
  modelsLoading,
}: SettingsPageProps) {
  const info = getEnvironmentInfo();
  const { color: connColor, text: connText } = getConnectionDisplay(connectionStatus);
  const { providers: setupProviders, loading: setupLoading } = useSetupProviders();

  // Find registered models not currently available from any running provider
  const allModelNames = new Set(models.map((m) => m.name));
  const unavailableRegistered = [...registeredNames].filter((name) => !allModelNames.has(name));

  // Provider column widths
  const provNameWidth = Math.max(
    ...setupProviders.map((p) => p.provider.displayName.length),
    8,
  );
  const provStatusWidth = 'Local Server Running'.length;


  return (
    <Box flexDirection="column" marginTop={1} paddingX={1}>
      {/* Tunnel Configuration */}
      <Text bold color="white" underline>
        Tunnel Configuration
      </Text>
      <Box flexDirection="column" marginTop={1}>
        <Box>
          <Text color="gray">{'Config file:     '}</Text>
          <Text color="white">{getConfigPath()}</Text>
        </Box>
        {info.current !== 'prod' && (
          <Box>
            <Text color="gray">{'Environment:     '}</Text>
            <Text color="yellow" bold>
              LOCAL
            </Text>
          </Box>
        )}
        <Box>
          <Text color="gray">{'API URL:         '}</Text>
          <Text color="white">{info.apiBaseUrl}</Text>
        </Box>
        <Box>
          <Text color="gray">{'API key:         '}</Text>
          <Text color={info.hasApiKey ? 'green' : 'yellow'}>
            {info.hasApiKey ? 'Set' : 'Not set'}
          </Text>
        </Box>
        <Box>
          <Text color="gray">{'Connection:      '}</Text>
          <Text color={connColor}>{connText}</Text>
        </Box>
      </Box>

      {/* Providers */}
      <Box marginTop={1}>
        <Text bold color="white" underline>
          Providers
        </Text>
      </Box>

      {setupLoading ? (
        <Box marginTop={1}>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text> Detecting providers...</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {setupProviders.map(({ provider, status }) => {
            const url = PROVIDER_URL_GETTERS[provider.name]?.() ?? '';
            const notInstalled = !status.installed;
            const statusColor = status.running ? 'green' : status.installed ? 'yellow' : 'gray';
            const statusText = status.running
              ? 'Local Server Running'
              : status.installed
                ? 'Installed (not running)'
                : 'Not installed';

            return (
              <Box key={provider.name}>
                <Text color={notInstalled ? 'gray' : 'white'}>{provider.displayName.padEnd(provNameWidth + 2)}</Text>
                <Text color={statusColor}>{statusText.padEnd(provStatusWidth + 2)}</Text>
                {status.running && <Text color="gray">{url}</Text>}
              </Box>
            );
          })}
        </Box>
      )}

      {/* Models */}
      <Box marginTop={1}>
        <Text bold color="white" underline>
          Models
        </Text>
      </Box>

      {modelsLoading ? (
        <Box marginTop={1}>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text> Discovering models...</Text>
        </Box>
      ) : models.length === 0 && unavailableRegistered.length === 0 ? (
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow">No models found.</Text>
          <Text color="gray">
            Download models using your provider (e.g., ollama pull llama3.2)
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {models.map((model) => {
            const cap = getCapabilityLabel(model.capability);
            const isRegistered = registeredNames.has(model.name);
            const displayProvider = PROVIDER_DISPLAY_NAMES[model.provider] ?? model.provider;
            return (
              <Box key={model.name}>
                <Text color={isRegistered ? 'green' : 'gray'}>{isRegistered ? '\u25CF' : '\u25CB'}</Text>
                <Text color="white">{` ${model.name}`}</Text>
                <Text color="gray">{' - '}</Text>
                <Text color="gray">{displayProvider}</Text>
                <Text color="gray">{' - '}</Text>
                <Text color={cap.color}>{cap.label}</Text>
              </Box>
            );
          })}

          {unavailableRegistered.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="gray">
                Registered but not currently available:
              </Text>
              {unavailableRegistered.map((name) => (
                <Box key={name}>
                  <Text color="gray">{'\u25CB'}</Text>
                  <Text color="gray">{` ${name}`}</Text>
                </Box>
              ))}
            </Box>
          )}

        </Box>
      )}
    </Box>
  );
}
