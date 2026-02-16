import React from 'react';
import { Box, Text } from 'ink';
import type { ConnectionStatus, Page } from '../types.js';
import { getConnectionDisplay } from '../helpers.js';
import { LogoString } from '../../helpers.js';

interface HeaderProps {
  connection: ConnectionStatus;
  environment: 'prod' | 'local';
  activeRequests: number;
  page?: Page;
}

const PAGE_LABELS: Record<Page, string> = {
  dashboard: '',
  models: 'Manage Models',
  config: 'Config',
  auth: 'Auth',
  register: 'Register',
};

export function Header({
  connection,
  environment,
  activeRequests,
  page,
}: HeaderProps) {
  const { color: connectionColor, text: connectionText } =
    getConnectionDisplay(connection);

  const breadcrumb = page ? PAGE_LABELS[page] : '';

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
        <Text color={connectionColor}>● {connectionText}</Text>
        {activeRequests > 0 && (
          <Text color="cyan">{activeRequests} active request{activeRequests !== 1 ? 's' : ''}</Text>
        )}
      </Box>
    </Box>
  );
}
