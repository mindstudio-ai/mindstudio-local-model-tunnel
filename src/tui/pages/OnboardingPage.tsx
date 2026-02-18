import React, { useEffect, useCallback, useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import chalk from 'chalk';
import { useAuth } from '../hooks/useAuth';
import { LogoString } from '../components/Header';

interface OnboardingPageProps {
  onComplete: () => void;
}

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

  // Full cycle: fade in + hold + fade out + pause
  const cycleLength = totalChars + 40;

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % cycleLength);
    }, SHIMMER_SPEED);
    return () => clearInterval(interval);
  }, [cycleLength]);

  return useMemo(() => {
    // Map frame to a wave that fades the whole logo in and out
    // Phase 0..totalChars: characters light up one by one (sweep in)
    // Phase totalChars..totalChars+20: hold bright
    // Phase totalChars+20..cycleLength: all fade out together
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
            // Sweep phase: characters light up as the wave passes
            const lag = charIdx;
            const t = sweepPos - lag;
            brightness = t <= 0 ? 0.1 : Math.min(1, t / 8);
          } else if (sweepPos <= holdEnd) {
            // Hold phase: everything bright
            brightness = 1;
          } else {
            // Fade out phase
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

export function OnboardingPage({ onComplete }: OnboardingPageProps) {
  const {
    status: authStatus,
    authUrl,
    timeRemaining,
    startAuth,
    cancel: cancelAuth,
  } = useAuth();
  const shimmerLogo = useShimmerLogo();

  // Auto-navigate to dashboard on success
  useEffect(() => {
    if (authStatus === 'success') {
      const timer = setTimeout(() => onComplete(), 1500);
      return () => clearTimeout(timer);
    }
  }, [authStatus, onComplete]);

  // Clean up auth on unmount
  useEffect(() => {
    return () => cancelAuth();
  }, []);

  const handleAction = useCallback(() => {
    cancelAuth();
    startAuth();
  }, [cancelAuth, startAuth]);

  const canAct =
    authStatus === 'idle' ||
    authStatus === 'expired' ||
    authStatus === 'timeout';

  useInput((_input, key) => {
    if (canAct && !key.ctrl) {
      handleAction();
    }
  });

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexGrow={1} />

      <Box flexDirection="column" alignItems="center">
        <Text>{shimmerLogo}</Text>

        <Box flexDirection="column" alignItems="center" marginTop={2}>
          <Text bold color="white">
            MindStudio Local Tunnel
          </Text>
        </Box>

        <Box flexDirection="column" alignItems="center">
          {authStatus === 'idle' && (
            <>
              <Text color="gray">
                Connect your MindStudio account to get started.
              </Text>
              <Box marginTop={1}>
                <Text color="cyan" bold>
                  Press any key to Connect Account
                </Text>
              </Box>
            </>
          )}

          {(authStatus === 'expired' || authStatus === 'timeout') && (
            <>
              <Text color="red">
                {authStatus === 'expired'
                  ? 'Authorization expired.'
                  : 'Authorization timed out.'}
              </Text>
              <Box marginTop={1}>
                <Text color="cyan" bold>
                  Press any key to Try Again
                </Text>
              </Box>
            </>
          )}

          {authStatus === 'waiting' && (
            <>
              <Box>
                <Text color="cyan">
                  <Spinner type="dots" />
                </Text>
                <Text>
                  {' '}
                  Waiting for browser authorization... ({timeRemaining}s
                  remaining)
                </Text>
              </Box>
              {authUrl && (
                <Box flexDirection="column" alignItems="center" marginTop={1}>
                  <Text color="gray">If browser didn't open, visit:</Text>
                  <Text color="cyan">{authUrl}</Text>
                </Box>
              )}
            </>
          )}

          {authStatus === 'success' && (
            <Text color="green">{'\u2713'} Authenticated!</Text>
          )}
        </Box>
      </Box>

      <Box flexGrow={1} />
    </Box>
  );
}
