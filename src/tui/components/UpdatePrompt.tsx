import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import chalk from 'chalk';
import { LogoString } from './Header';

const SHIMMER_SPEED = 35;

function useShimmerLogo(): string {
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

  const cycleLength = totalChars + 40;

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % cycleLength);
    }, SHIMMER_SPEED);
    return () => clearInterval(interval);
  }, [cycleLength]);

  return useMemo(() => {
    const sweepPos = frame;
    const holdEnd = totalChars + 20;

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

          let brightness: number;
          if (sweepPos <= totalChars) {
            const lag = charIdx;
            const t = sweepPos - lag;
            brightness = t <= 0 ? 0.1 : Math.min(1, t / 8);
          } else if (sweepPos <= holdEnd) {
            brightness = 1;
          } else {
            const fadeProgress = (sweepPos - holdEnd) / (cycleLength - holdEnd);
            brightness = Math.max(0.1, 1 - fadeProgress);
          }

          if (brightness >= 0.9) {
            result += chalk.cyanBright.bold(ch);
          } else if (brightness >= 0.6) {
            result += chalk.cyan(ch);
          } else if (brightness >= 0.3) {
            result += chalk.rgb(0, 100, 120)(ch);
          } else {
            result += chalk.rgb(0, 50, 60)(ch);
          }

          charIdx++;
        }
        return result;
      })
      .join('\n');
  }, [frame, lines, totalChars, cycleLength]);
}

interface UpdatePromptProps {
  currentVersion: string;
  latestVersion: string;
  onChoice: (shouldUpdate: boolean) => void;
}

export function UpdatePrompt({
  currentVersion,
  latestVersion,
  onChoice,
}: UpdatePromptProps) {
  const { stdout } = useStdout();
  const shimmerLogo = useShimmerLogo();

  useInput(() => {
    onChoice(true);
  });

  const termHeight = (stdout?.rows ?? 24) - 4;

  return (
    <Box flexDirection="column" height={termHeight}>
      <Box flexGrow={1} />

      <Box flexDirection="column" alignItems="center">
        <Text>{shimmerLogo}</Text>

        <Box flexDirection="column" alignItems="center" marginTop={2}>
          <Text bold color="white">
            MindStudio Local Tunnel
          </Text>
        </Box>

        <Box flexDirection="column" alignItems="center">
          <Text color="gray">
            Update required {'\u2022'} v{currentVersion} {'\u2192'} v{latestVersion}
          </Text>
          <Box marginTop={1}>
            <Text color="cyan" bold>
              Press any key to update
            </Text>
          </Box>
        </Box>
      </Box>

      <Box flexGrow={1} />
    </Box>
  );
}
