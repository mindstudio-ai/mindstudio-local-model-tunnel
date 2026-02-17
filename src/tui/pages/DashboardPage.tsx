import React, { useMemo } from 'react';
import { Box, Text, useStdout } from 'ink';
import { RequestLog, NavigationMenu } from '../components/index.js';
import type { MenuItem } from '../components/index.js';
import type {
  ProviderStatus,
  RequestLogEntry,
  ConnectionStatus,
} from '../types.js';
import { getConnectionDisplay } from '../helpers.js';
import { LogoString } from '../../helpers.js';

interface DashboardPageProps {
  providers: ProviderStatus[];
  requests: RequestLogEntry[];
  activeCount: number;
  connectionStatus: ConnectionStatus;
  environment: 'prod' | 'local';
  connectionError: string | null;
  modelCount: number;
  onNavigate: (id: string) => void;
}

export function DashboardPage({
  providers,
  requests,
  activeCount,
  connectionStatus,
  environment,
  connectionError,
  modelCount,
  onNavigate,
}: DashboardPageProps) {
  const { color: connectionColor, text: connectionText } =
    getConnectionDisplay(connectionStatus);

  const { stdout } = useStdout();

  const menuItems = useMemo((): MenuItem[] => {
    return [
      {
        id: 'settings',
        label: 'View Configuration',
        description: 'View tunnel config, providers, and models',
      },
      {
        id: 'setup',
        label: 'Manage Providers',
        description: 'Manage local AI providers',
      },
      {
        id: 'quit',
        label: 'Exit',
        description: 'Quit the application',
      },
    ];
  }, []);

  // Compute maxVisible for request log based on terminal height
  // Header box ~= 8 lines (border + padding + content), menu ~= items + 7, margin = 1
  const menuHeight = menuItems.length + 7;
  const runningCount = providers.filter((p) => p.running).length;
  const headerHeight =
    8 +
    (runningCount > 0 ? runningCount : 3);
  const termHeight = stdout?.rows ?? 24;
  const availableForLog = termHeight - 4 - headerHeight - menuHeight - 1;
  // Reserve 3 lines for the request log header + margin, rest for entries
  const maxVisible = Math.max(3, availableForLog - 3);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Top section: Logo | Title + Providers in one bordered box */}
      <Box
        flexDirection="row"
        alignItems="center"
        borderStyle="round"
        borderColor="cyan"
        paddingX={1}
        paddingY={1}
        width="100%"
      >
        <Box marginLeft={3}>
          <Text color="cyan">{LogoString}</Text>
        </Box>
        <Box flexDirection="column" marginLeft={7}>
          <Box>
            <Text bold color="white">
              MindStudio Local Tunnel
            </Text>
            {environment !== 'prod' && (
              <>
                <Text> </Text>
                <Text color="yellow" bold>
                  [LOCAL]
                </Text>
              </>
            )}
          </Box>
          <Text color={connectionColor}>● {connectionText}</Text>
          {connectionError && <Text color="red">{connectionError}</Text>}
          <Text color="gray">{modelCount} models available</Text>
          <Box marginTop={1} flexDirection="column">
            <Text bold underline color="white">
              Providers
            </Text>
            {providers.length === 0 ? (
              <Text color="gray">Loading...</Text>
            ) : !providers.some((p) => p.running) ? (
              <Box marginTop={1} flexDirection="column">
                <Text color="yellow" bold>
                  No providers running
                </Text>
                <Text color="gray">
                  Start a provider: ollama serve, LM Studio, etc.
                </Text>
              </Box>
            ) : (
              providers.filter(({ running }) => running).map(({ provider }) => (
                <Box key={provider.name}>
                  <Text color="green">●</Text>
                  <Text> </Text>
                  <Text color="white">{provider.displayName}</Text>
                  <Text> </Text>
                  <Text color="green">Running</Text>
                </Box>
              ))
            )}
          </Box>
        </Box>
      </Box>

      {/* Middle: Request log or empty state */}
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
