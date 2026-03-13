import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { DevRequestLogEntry } from '../../../dev/types';

interface DevRequestLogProps {
  requests: DevRequestLogEntry[];
  maxVisible?: number;
}

export function DevRequestLog({
  requests,
  maxVisible = 10,
}: DevRequestLogProps) {
  if (requests.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        <Text bold color="white" underline>
          Request Log
        </Text>
        <Text color="gray"> Waiting for requests...</Text>
      </Box>
    );
  }

  // Show most recent requests, prioritizing active ones
  const active = requests.filter((r) => r.status === 'processing');
  const completed = requests.filter((r) => r.status !== 'processing');
  const recent = completed.slice(-Math.max(0, maxVisible - active.length));
  const visible = [...recent, ...active].slice(-maxVisible);

  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      <Text bold color="white" underline>
        Request Log
      </Text>
      {visible.map((entry) => (
        <RequestEntry key={entry.id} entry={entry} />
      ))}
    </Box>
  );
}

function RequestEntry({ entry }: { entry: DevRequestLogEntry }) {
  const methodLabel = entry.method ?? 'unknown';

  if (entry.status === 'processing') {
    const elapsed = Math.round((Date.now() - entry.startTime) / 1000);
    return (
      <Box gap={1}>
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
        <Text>{methodLabel}</Text>
        <Text color="gray">{elapsed}s</Text>
      </Box>
    );
  }

  if (entry.status === 'failed') {
    const errorLines = (entry.error ?? 'Unknown error').split('\n').slice(0, 4);
    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text color="red">✖</Text>
          <Text>{methodLabel}</Text>
          {entry.duration != null && <Text color="gray">{entry.duration}ms</Text>}
        </Box>
        {errorLines.map((line, i) => (
          <Text key={i} color="red" wrap="truncate">{'  '}{line}</Text>
        ))}
      </Box>
    );
  }

  // Completed
  const duration = entry.duration != null ? `${entry.duration}ms` : '';
  return (
    <Box gap={1}>
      <Text color="green">✓</Text>
      <Text>{methodLabel}</Text>
      <Text color="gray">{duration}</Text>
    </Box>
  );
}
