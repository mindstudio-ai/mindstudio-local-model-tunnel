import React from 'react';
import { Box, Text } from 'ink';
import type { ConnectionStatus, Page } from '../types.js';
import { LogoString } from '../../helpers.js';

interface HeaderProps {
  connection: ConnectionStatus;
  environment: 'prod' | 'local';
  activeRequests: number;
  page?: Page;
}

const PAGE_LABELS: Record<Page, string> = {
  dashboard: '',
  models: '> Models',
  config: '> Config',
  auth: '> Auth',
  register: '> Register',
};

export function Header({
  connection,
  environment,
  activeRequests,
  page,
}: HeaderProps) {
  const connectionColor =
    connection === 'connected'
      ? 'green'
      : connection === 'connecting'
        ? 'yellow'
        : connection === 'not_authenticated'
          ? 'yellow'
          : 'red';

  const connectionText =
    connection === 'connected'
      ? 'Connected'
      : connection === 'connecting'
        ? 'Connecting...'
        : connection === 'not_authenticated'
          ? 'Not Authenticated'
          : connection === 'disconnected'
            ? 'Disconnected'
            : 'Error';

  const envBadge = environment === 'prod' ? 'PROD' : 'LOCAL';
  const envColor = environment === 'prod' ? 'green' : 'yellow';

  const breadcrumb = page ? PAGE_LABELS[page] : '';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="cyan">{LogoString}</Text>
      </Box>
      <Box marginTop={1} justifyContent="space-between">
        <Box>
          <Text bold color="white">
            MindStudio Local Tunnel
          </Text>
          <Text> </Text>
          <Text color={envColor} bold>
            [{envBadge}]
          </Text>
          {breadcrumb ? (
            <>
              <Text> </Text>
              <Text color="gray">{breadcrumb}</Text>
            </>
          ) : null}
        </Box>
        <Box>
          <Text color={connectionColor}>● {connectionText}</Text>
          {activeRequests > 0 && (
            <Text color="cyan"> | {activeRequests} active</Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
