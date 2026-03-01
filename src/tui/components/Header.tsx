import React, { useState, useEffect, useMemo } from 'react';
import os from 'node:os';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import type { ConnectionStatus } from '../types';
import { createRequire } from 'node:module';

interface HeaderProps {
  connection: ConnectionStatus;
  environment: 'prod' | 'local';
  configPath: string;
  connectionError?: string | null;
  compact?: boolean;
  hasActiveRequest?: boolean;
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

function useActiveShimmerLogo(active: boolean): string | null {
  const [frame, setFrame] = useState(0);

  const lines = useMemo(() => LogoString.split('\n'), []);
  const totalChars = useMemo(() => {
    let count = 0;
    for (const line of lines) {
      for (const ch of line) {
        if (ch !== ' ' && ch !== '\t') count++;
      }
    }
    return count;
  }, [lines]);

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => {
      setFrame((f) => f + 1);
    }, 25);
    return () => clearInterval(interval);
  }, [active]);

  return useMemo(() => {
    if (!active) return null;

    const waveLength = 20;
    let charIdx = 0;

    return lines
      .map((line) => {
        let result = '';
        for (let i = 0; i < line.length; i++) {
          const ch = line[i]!;
          if (ch === ' ' || ch === '\t') {
            result += ch;
            continue;
          }

          const phase = ((charIdx - frame * 0.5) / waveLength) * Math.PI * 2;
          const brightness = 0.65 + 0.35 * Math.sin(phase);

          if (brightness >= 0.85) {
            result += chalk.cyanBright(ch);
          } else if (brightness >= 0.65) {
            result += chalk.cyan(ch);
          } else {
            result += chalk.rgb(0, 140, 160)(ch);
          }

          charIdx++;
        }
        return result;
      })
      .join('\n');
  }, [active, frame, lines, totalChars]);
}

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
  hasActiveRequest,
}: HeaderProps) {
  const { color: connectionColor, text: connectionText } =
    getConnectionDisplay(connection);
  const shimmerLogo = useActiveShimmerLogo(!compact && !!hasActiveRequest);

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
          {shimmerLogo ? (
            <Text>{shimmerLogo}</Text>
          ) : (
            <Text color="cyan">{LogoString}</Text>
          )}
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
        <Text color={connectionColor}>● {connectionText}</Text>
        {connectionError && <Text color="red">{connectionError}</Text>}
        <Text color="gray">
          Config: {configPath.replace(os.homedir(), '~')}
        </Text>
        {!compact && <Text color="gray">v{pkg.version}</Text>}
      </Box>
    </Box>
  );
}
