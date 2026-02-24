import React from 'react';
import os from 'node:os';
import { Box, Text } from 'ink';
import type { ConnectionStatus } from '../types';
import { createRequire } from 'node:module';

interface HeaderProps {
  connection: ConnectionStatus;
  environment: 'prod' | 'local';
  configPath: string;
  connectionError?: string | null;
  compact?: boolean;
}

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

export const LogoString = `       .=+-.     :++.
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
  configPath,
  connectionError,
  compact,
}: HeaderProps) {
  const { color: connectionColor, text: connectionText } =
    getConnectionDisplay(connection);

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
      {!compact && (
        <Box paddingLeft={3}>
          <Text color="cyan">{LogoString}</Text>
        </Box>
      )}
      <Box flexDirection="column" marginLeft={compact ? 0 : 4}>
        <Box>
          <Text bold color="white">
            MindStudio Local Tunnel
          </Text>
          {compact && <Text color="gray"> v{pkg.version}</Text>}
          {environment !== 'prod' && (
            <>
              <Text> </Text>
              <Text color="yellow" bold>
                [LOCAL]
              </Text>
            </>
          )}
        </Box>
        {!compact && <Text color="gray">v{pkg.version}</Text>}
        <Text color={connectionColor}>● {connectionText}</Text>
        {connectionError && <Text color="red">{connectionError}</Text>}
        <Text color="gray">
          Config: {configPath.replace(os.homedir(), '~')}
        </Text>
      </Box>
    </Box>
  );
}
