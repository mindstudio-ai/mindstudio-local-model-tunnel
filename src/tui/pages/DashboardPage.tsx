import React, { useMemo } from 'react';
import { Box, Text, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import { RequestLog, NavigationMenu } from '../components';
import type { MenuItem } from '../components';
import type { LocalModel } from '../../providers/types';
import type {
  ProviderStatus,
  RequestLogEntry,
} from '../types';
import { useSetupProviders } from '../hooks/useSetupProviders';

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

interface DashboardPageProps {
  providers: ProviderStatus[];
  requests: RequestLogEntry[];
  models: LocalModel[];
  registeredNames: Set<string>;
  modelsLoading?: boolean;
  onNavigate: (id: string) => void;
}

export function DashboardPage({
  providers,
  requests,
  models,
  registeredNames,
  modelsLoading,
  onNavigate,
}: DashboardPageProps) {
  const { stdout } = useStdout();
  const { providers: setupProviders, loading: setupLoading } = useSetupProviders();

  const installedProviders = setupProviders.filter(({ status }) => status.installed);

  const provNameWidth = Math.max(
    ...installedProviders.map((p) => p.provider.displayName.length),
    8,
  );
  const provStatusWidth = 'Local Server Running'.length;

  const allModelNames = new Set(models.map((m) => m.name));
  const unavailableRegistered = [...registeredNames].filter((name) => !allModelNames.has(name));

  const menuItems = useMemo((): MenuItem[] => {
    return [
      {
        id: 'register',
        label: 'Sync Models',
        description: 'Sync models with MindStudio Cloud',
      },
      {
        id: 'refresh',
        label: 'Refresh Providers',
        description: 'Re-detect local AI providers and models',
      },
      {
        id: 'setup',
        label: 'Manage Providers',
        description: 'Manage local AI providers',
      },
      {
        id: 'auth',
        label: 'Re-authenticate',
        description: 'Re-authenticate with MindStudio',
      },
      {
        id: 'quit',
        label: 'Exit',
        description: 'Quit the application',
      },
    ];
  }, []);

  // Compute maxVisible for request log based on terminal height
  const menuHeight = menuItems.length + 7;
  const runningCount = providers.filter((p) => p.running).length;
  const headerHeight =
    8 +
    (runningCount > 0 ? runningCount : 3);
  const termHeight = stdout?.rows ?? 24;
  const availableForLog = termHeight - 4 - headerHeight - menuHeight - 1;
  const maxVisible = Math.max(3, availableForLog - 3);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Providers */}
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        <Text bold color="white" underline>Providers</Text>

        {setupLoading ? (
          <Box marginTop={1}>
            <Text color="cyan"><Spinner type="dots" /></Text>
            <Text> Detecting providers...</Text>
          </Box>
        ) : installedProviders.length === 0 ? (
          <Box marginTop={1} flexDirection="column">
            <Text color="yellow">No providers installed.</Text>
            <Text color="gray">Use "Manage Providers" below to install one.</Text>
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
      </Box>

      {/* Models */}
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        <Text bold color="white" underline>Models</Text>

        {modelsLoading ? (
          <Box marginTop={1}>
            <Text color="cyan"><Spinner type="dots" /></Text>
            <Text> Discovering models...</Text>
          </Box>
        ) : models.length === 0 && unavailableRegistered.length === 0 ? (
          <Box marginTop={1} flexDirection="column">
            <Text color="yellow">No models found.</Text>
            <Text color="gray">Download models using your provider (e.g., ollama pull llama3.2)</Text>
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
                <Text color="gray">Registered but not currently available:</Text>
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

      {/* Request log or empty state */}
      {!providers.some((p) => p.running) && providers.length > 0 ? (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="yellow"
          paddingX={2}
          paddingY={1}
          marginTop={1}
          flexGrow={1}
        >
          <Text bold color="yellow">No providers are running</Text>
          <Box marginTop={1} flexDirection="column">
            <Text>Set up a local AI provider to get started.</Text>
            <Text color="gray" dimColor>Select "Manage Providers" below to install and configure a provider like Ollama.</Text>
          </Box>
        </Box>
      ) : (
        <RequestLog requests={requests} maxVisible={maxVisible} />
      )}

      {/* Bottom: Navigation menu pane */}
      <NavigationMenu items={menuItems} onSelect={onNavigate} />
    </Box>
  );
}
