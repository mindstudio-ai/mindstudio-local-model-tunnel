import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { LocalModel } from '../../providers/types';
import type { ConnectionStatus, ProviderStatus } from '../types';
import { useSetupProviders } from '../hooks/useSetupProviders';

interface SettingsPageProps {
  connectionStatus: ConnectionStatus;
  environment: 'prod' | 'local';
  models: LocalModel[];
  registeredNames: Set<string>;
  modelsLoading?: boolean;
  providers: ProviderStatus[];
}

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
  const { providers: setupProviders, loading: setupLoading } = useSetupProviders();

  // Find registered models not currently available from any running provider
  const allModelNames = new Set(models.map((m) => m.name));
  const unavailableRegistered = [...registeredNames].filter((name) => !allModelNames.has(name));

  // Only show installed providers
  const installedProviders = setupProviders.filter(({ status }) => status.installed);

  // Provider column widths
  const provNameWidth = Math.max(
    ...installedProviders.map((p) => p.provider.displayName.length),
    8,
  );
  const provStatusWidth = 'Local Server Running'.length;

  return (
    <Box flexDirection="column" marginTop={1} paddingX={1}>
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
      ) : installedProviders.length === 0 ? (
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow">No providers installed.</Text>
          <Text color="gray">Use "Manage Providers" from the dashboard to install one.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {installedProviders.map(({ provider, status }) => {
            const url = provider.baseUrl;
            const statusColor = status.running ? 'green' : 'yellow';
            const statusText = status.running
              ? 'Local Server Running'
              : 'Installed (not running)';

            return (
              <Box key={provider.name}>
                <Text color="white">{provider.displayName.padEnd(provNameWidth + 2)}</Text>
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
            const displayProvider = setupProviders.find((p) => p.provider.name === model.provider)?.provider.displayName ?? model.provider;
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
