import React from 'react';
import { Box, Text } from 'ink';
import type { LocalModel } from '../../providers/types.js';

interface ModelsPanelProps {
  models: LocalModel[];
}

function getCapabilityBadge(capability: string): {
  text: string;
  color: string;
} {
  switch (capability) {
    case 'text':
      return { text: 'text', color: 'blue' };
    case 'image':
      return { text: 'image', color: 'magenta' };
    case 'video':
      return { text: 'video', color: 'yellow' };
    default:
      return { text: capability, color: 'gray' };
  }
}

function formatModelName(name: string, maxLength: number = 24): string {
  if (name.length <= maxLength) return name;
  return name.slice(0, maxLength - 1) + '…';
}

export function ModelsPanel({ models }: ModelsPanelProps) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
    >
      <Box marginBottom={1}>
        <Text bold color="white">
          MODELS
        </Text>
        <Text color="gray"> ({models.length})</Text>
      </Box>
      {models.length === 0 ? (
        <Text color="gray">No models found</Text>
      ) : (
        models.slice(0, 8).map((model, index) => {
          const badge = getCapabilityBadge(model.capability);
          const isLast = index === Math.min(models.length, 8) - 1;
          const prefix = isLast ? '└─' : '├─';

          return (
            <Box key={model.name}>
              <Text color="gray">{prefix} </Text>
              <Text color="white">{formatModelName(model.name)}</Text>
              <Text> </Text>
              <Text color={badge.color as any}>[{badge.text}]</Text>
            </Box>
          );
        })
      )}
      {models.length > 8 && (
        <Text color="gray"> +{models.length - 8} more</Text>
      )}
    </Box>
  );
}
