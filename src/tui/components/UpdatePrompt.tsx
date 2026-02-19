import React from 'react';
import { Box, Text, useInput } from 'ink';

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
  useInput((input) => {
    if (input.toLowerCase() === 'y') {
      onChoice(true);
    } else {
      onChoice(false);
    }
  });

  return (
    <Box flexDirection="column" paddingY={1} paddingX={2}>
      <Text>
        <Text color="yellow" bold>
          Update available:
        </Text>
        <Text>
          {' '}
          v{currentVersion} {'\u2192'} v{latestVersion}
        </Text>
      </Text>
      <Box marginTop={1}>
        <Text>
          Press <Text bold color="cyan">y</Text> to update, any other key to
          skip
        </Text>
      </Box>
    </Box>
  );
}
