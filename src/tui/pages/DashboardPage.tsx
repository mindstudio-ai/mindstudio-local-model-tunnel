import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { RequestLog, NavigationMenu } from '../components/index.js';
import type { MenuItem } from '../components/index.js';
import type {
  ProviderStatus,
  RequestLogEntry,
  ConnectionStatus,
} from '../types.js';
import { LogoString } from '../../helpers.js';

interface DashboardPageProps {
  providers: ProviderStatus[];
  requests: RequestLogEntry[];
  activeCount: number;
  connectionStatus: ConnectionStatus;
  environment: 'prod' | 'local';
  connectionError: string | null;
  onNavigate: (id: string) => void;
}

export function DashboardPage({
  providers,
  requests,
  connectionStatus,
  environment,
  connectionError,
  onNavigate,
}: DashboardPageProps) {
  const connectionColor =
    connectionStatus === 'connected'
      ? 'green'
      : connectionStatus === 'connecting'
        ? 'yellow'
        : connectionStatus === 'not_authenticated'
          ? 'yellow'
          : 'red';

  const connectionText =
    connectionStatus === 'connected'
      ? 'Connected'
      : connectionStatus === 'connecting'
        ? 'Connecting...'
        : connectionStatus === 'not_authenticated'
          ? 'Not Authenticated'
          : connectionStatus === 'disconnected'
            ? 'Disconnected'
            : 'Error';

  const envBadge = environment === 'prod' ? 'PROD' : 'LOCAL';
  const envColor = environment === 'prod' ? 'green' : 'yellow';

  const menuItems = useMemo((): MenuItem[] => {
    const isConnected = connectionStatus === 'connected';
    const isAuthenticated = connectionStatus !== 'not_authenticated';

    return [
      {
        id: 'models',
        label: 'View Models',
        description: 'View available local models',
      },
      {
        id: 'config',
        label: 'Configuration',
        description: 'View current configuration',
      },
      {
        id: 'auth',
        label: isConnected ? 'Re-authenticate' : 'Authenticate',
        description: isConnected
          ? 'Re-authenticate with MindStudio'
          : 'Authenticate with MindStudio',
      },
      {
        id: 'register',
        label: 'Register Models',
        description: 'Register local models with MindStudio',
        disabled: !isAuthenticated,
        disabledReason: !isAuthenticated ? 'Authenticate first' : undefined,
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
  }, [connectionStatus]);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Top section: Logo | Title + Providers in one bordered box */}
      <Box flexDirection="row" alignItems="center" borderStyle="round" borderColor="cyan" paddingX={1} paddingY={1} width="100%">
        <Box>
          <Text color="cyan">{LogoString}</Text>
        </Box>
        <Box flexDirection="column" marginLeft={4}>
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
          {connectionError && (
            <Text color="red">{connectionError}</Text>
          )}
          <Box marginTop={1} flexDirection="column">
            <Text bold color="white">
              PROVIDERS
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
                  <Text
                    color={running ? 'green' : 'gray'}
                    dimColor={!running}
                  >
                    {running ? 'Running' : 'Stopped'}
                  </Text>
                </Box>
              ))
            )}
            {providers.length > 0 &&
              !providers.some((p) => p.running) && (
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
      <Box marginTop={1}>
        <RequestLog requests={requests} />
      </Box>

      {/* Bottom: Navigation menu pane */}
      <NavigationMenu items={menuItems} onSelect={onNavigate} />
    </Box>
  );
}
