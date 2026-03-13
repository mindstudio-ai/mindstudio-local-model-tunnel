import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

interface DevPortPromptProps {
  onSubmit: (port: number) => void;
  onSkip: () => void;
}

export function DevPortPrompt({ onSubmit, onSkip }: DevPortPromptProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (input: string) => {
    const trimmed = input.trim();

    if (trimmed === '' || trimmed === 'skip') {
      onSkip();
      return;
    }

    const port = parseInt(trimmed, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      setError('Enter a valid port number (1-65535) or "skip"');
      return;
    }

    onSubmit(port);
  };

  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      <Text color="yellow">
        No devPort found in your web interface config.
      </Text>
      <Text color="gray">
        What port is your local dev server running on?
      </Text>
      <Text color="gray" dimColor>
        Type &quot;skip&quot; for backend-only mode (no frontend proxying).
      </Text>
      <Box marginTop={1}>
        <Text color="cyan">Port: </Text>
        <TextInput
          value={value}
          onChange={(val) => {
            setValue(val);
            setError(null);
          }}
          onSubmit={handleSubmit}
          placeholder="5173"
        />
      </Box>
      {error && (
        <Text color="red">{error}</Text>
      )}
    </Box>
  );
}
