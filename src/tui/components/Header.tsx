import React from 'react';
import os from 'node:os';
import { Box, Text } from 'ink';
import type { ConnectionStatus, Page } from '../types';
import { getConnectionDisplay } from '../helpers';
import { LogoString } from '../../helpers';

interface HeaderProps {
  connection: ConnectionStatus;
  environment: 'prod' | 'local';
  activeRequests: number;
  page?: Page;
  version: string;
  configPath: string;
  connectionError?: string | null;
}

const PAGE_LABELS: Record<Page, string> = {
  dashboard: '',
  auth: 'Authentication',
  register: 'Sync Models',
  setup: 'Manage Providers',
  onboarding: 'Welcome',
};

export function Header({
  connection,
  environment,
  activeRequests,
  page,
  version,
  configPath,
  connectionError,
}: HeaderProps) {
  const { color: connectionColor, text: connectionText } =
    getConnectionDisplay(connection);

  const breadcrumb = page ? PAGE_LABELS[page] : '';
  const displayPath = configPath.replace(os.homedir(), '~');

  return (
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
          {breadcrumb ? (
            <>
              <Text color="gray"> {'>'} </Text>
              <Text color="white" bold>{breadcrumb}</Text>
            </>
          ) : null}
        </Box>
        <Text color="gray">v{version}</Text>
        <Text color={connectionColor}>● {connectionText}</Text>
        {connectionError && <Text color="red">{connectionError}</Text>}
        {activeRequests > 0 && (
          <Text color="cyan">{activeRequests} active request{activeRequests !== 1 ? 's' : ''}</Text>
        )}
        <Text color="gray">Config: {displayPath}</Text>
      </Box>
    </Box>
  );
}
