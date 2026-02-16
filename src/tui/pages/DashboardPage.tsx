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
        id: 'models',
        label: 'Manage Models',
        description: 'Discover and manage local models',
      },
      {
        id: 'config',
        label: 'Configuration',
        description: 'View current configuration',
      },
      {
        id: 'setup',
        label: 'Setup Providers',
        description: 'Run provider setup wizard',
      },
      {
        id: 'refresh',
        label: 'Refresh',
        description: 'Refresh providers, models, and registration status',
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
  const headerHeight =
    8 +
    providers.length +
    (providers.length > 0 && !providers.some((p) => p.running) ? 3 : 0);
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
            ) : (
              providers.map(({ provider, running }) => (
                <Box key={provider.name}>
                  <Text color={running ? 'green' : 'gray'}>
                    {running ? '●' : '○'}
                  </Text>
                  <Text> </Text>
                  <Text color={running ? 'white' : 'gray'}>
                    {provider.displayName}
                  </Text>
                  <Text> </Text>
                  <Text color={running ? 'green' : 'gray'} dimColor={!running}>
                    {running ? 'Running' : 'Stopped'}
                  </Text>
                </Box>
              ))
            )}
            {providers.length > 0 && !providers.some((p) => p.running) && (
              <Box marginTop={1} flexDirection="column">
                <Text color="yellow" bold>
                  No providers running
                </Text>
                <Text color="gray">
                  Start a provider: ollama serve, LM Studio, etc.
                </Text>
              </Box>
            )}
          </Box>
        </Box>
      </Box>

      {/* Middle: Request log */}
      <RequestLog requests={requests} maxVisible={maxVisible} />

      {/* Bottom: Navigation menu pane */}
      <NavigationMenu items={menuItems} onSelect={onNavigate} />
    </Box>
  );
}
