import React, { useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { useAuth } from '../hooks/useAuth';
import { LogoString } from '../../helpers';

interface OnboardingPageProps {
  onComplete: () => void;
}

export function OnboardingPage({ onComplete }: OnboardingPageProps) {
  const { status: authStatus, authUrl, timeRemaining, startAuth, cancel: cancelAuth } = useAuth();

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

  const canAct = authStatus === 'idle' || authStatus === 'expired' || authStatus === 'timeout';

  useInput((_input, key) => {
    if (canAct && !key.ctrl) {
      handleAction();
    }
  });

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexGrow={1} />

      <Box flexDirection="column" alignItems="center">
        <Text color="cyan">{LogoString}</Text>
        <Text bold color="white">MindStudio Local Tunnel</Text>

        <Box flexDirection="column" alignItems="center" marginTop={1}>
          {authStatus === 'idle' && (
            <>
              <Text color="gray">Connect your MindStudio account to get started.</Text>
              <Box marginTop={1}>
                <Text color="cyan" bold>Press any key to Connect Account</Text>
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
                <Text color="cyan" bold>Press any key to Try Again</Text>
              </Box>
            </>
          )}

          {authStatus === 'waiting' && (
            <>
              <Box>
                <Text color="cyan"><Spinner type="dots" /></Text>
                <Text> Waiting for browser authorization... ({timeRemaining}s remaining)</Text>
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
