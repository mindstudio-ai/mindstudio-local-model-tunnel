import React, { useEffect } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { useAuth } from '../hooks/useAuth.js';

interface AuthPageProps {
  onComplete: () => void;
}

export function AuthPage({ onComplete }: AuthPageProps) {
  const { status, authUrl, timeRemaining, startAuth, cancel } = useAuth();

  // Start auth flow on mount
  useEffect(() => {
    startAuth();
    return () => cancel();
  }, []);

  // Auto-return to dashboard on success after a delay
  useEffect(() => {
    if (status === 'success') {
      const timer = setTimeout(onComplete, 1500);
      return () => clearTimeout(timer);
    }
  }, [status, onComplete]);

  if (status === 'idle') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="gray">Starting authentication...</Text>
      </Box>
    );
  }

  if (status === 'success') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box>
          <Text color="green">✓ Authenticated successfully!</Text>
        </Box>
        <Text color="gray">Returning to dashboard...</Text>
      </Box>
    );
  }

  if (status === 'expired' || status === 'timeout') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="red">
          {status === 'expired'
            ? 'Authorization expired. Press Escape to go back and try again.'
            : 'Authorization timed out. Press Escape to go back and try again.'}
        </Text>
      </Box>
    );
  }

  // Waiting state
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="white" underline>
        Authentication
      </Text>

      <Box marginTop={1}>
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
        <Text> Waiting for browser authorization... ({timeRemaining}s remaining)</Text>
      </Box>

      {authUrl && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="gray">If browser didn't open, visit:</Text>
          <Text color="cyan">{authUrl}</Text>
        </Box>
      )}
    </Box>
  );
}
