import React from 'react';
import os from 'node:os';
import { Box, Text } from 'ink';
import type { ConnectionStatus, Page } from '../types';
import { createRequire } from 'node:module';

interface HeaderProps {
  connection: ConnectionStatus;
  environment: 'prod' | 'local';
  page?: Page;
  configPath: string;
  connectionError?: string | null;
}

const PAGE_LABELS: Record<Page, string> = {
  dashboard: '',
  register: 'Sync Models',
  setup: 'Manage Providers',
  onboarding: 'Welcome',
};

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

export const LogoString = `      .=+-.     :++.
      *@@@@@+  :%@@@@%:
    .%@@@@@@#..@@@@@@@=
  .*@@@@@@@--@@@@@@@#.**.
  *@@@@@@@.-@@@@@@@@.#@@*
.#@@@@@@@-.@@@@@@@* #@@@@%.
=@@@@@@@-.@@@@@@@#.-@@@@@@+
:@@@@@@:  +@@@@@#. .@@@@@@:
  .++:     .-*-.     .++:`;

const getConnectionDisplay = (status: ConnectionStatus) => {
  switch (status) {
    case 'connected':
      return { color: 'green', text: 'Connected to Cloud' };
    case 'connecting':
      return { color: 'yellow', text: 'Connecting...' };
    case 'not_authenticated':
      return { color: 'yellow', text: 'Not Authenticated' };
    case 'disconnected':
      return { color: 'red', text: 'Disconnected' };
    default:
      return { color: 'red', text: 'Error' };
  }
};

export function Header({
  connection,
  environment,
  page,
  configPath,
  connectionError,
}: HeaderProps) {
  const { color: connectionColor, text: connectionText } =
    getConnectionDisplay(connection);

  const breadcrumb = page ? PAGE_LABELS[page] : '';
  const displayPath = configPath.replace(os.homedir(), '~');

  return (
    <Box
      flexDirection="row"
      alignItems="center"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      paddingY={1}
      width="100%"
    >
      <Box paddingLeft={3}>
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
              <Text color="white" bold>
                {breadcrumb}
              </Text>
            </>
          ) : null}
        </Box>
        <Text color="gray">v{pkg.version}</Text>
        <Text color={connectionColor}>● {connectionText}</Text>
        {connectionError && <Text color="red">{connectionError}</Text>}
        <Text color="gray">Config: {displayPath}</Text>
      </Box>
    </Box>
  );
}
