import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { LocalModel } from '../../providers/types.js';

interface ModelsPageProps {
  models: LocalModel[];
  registeredNames: Set<string>;
  loading?: boolean;
}

function getCapabilityBadge(capability: string): { label: string; color: string } {
  switch (capability) {
    case 'text':
      return { label: 'text', color: 'green' };
    case 'image':
      return { label: 'image', color: 'magenta' };
    case 'video':
      return { label: 'video', color: 'blue' };
    default:
      return { label: capability, color: 'gray' };
  }
}

export function ModelsPage({ models, registeredNames, loading }: ModelsPageProps) {
  if (loading) {
    return (
      <Box flexDirection="column" marginTop={1} paddingX={1}>
        <Text bold color="white" underline>
          Manage Models
        </Text>
        <Box marginTop={1}>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text> Discovering local models...</Text>
        </Box>
      </Box>
    );
  }

  if (models.length === 0) {
    return (
      <Box flexDirection="column" marginTop={1} paddingX={1}>
        <Text bold color="white" underline>
          Manage Models
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow">No models found.</Text>
          <Text color="gray">
            Download models using your provider (e.g., ollama pull llama3.2)
          </Text>
        </Box>
      </Box>
    );
  }

  const registered = models.filter((m) => registeredNames.has(m.name));
  const unregistered = models.filter((m) => !registeredNames.has(m.name));

  return (
    <Box flexDirection="column" marginTop={1} paddingX={1}>
      <Text bold color="white" underline>
        Manage Models
      </Text>

      {registered.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="green">
            Registered ({registered.length})
          </Text>
          {registered.map((model) => {
            const badge = getCapabilityBadge(model.capability);
            return (
              <Box key={model.name}>
                <Text color="green">●</Text>
                <Text> {model.name} </Text>
                <Text color="gray">[{model.provider}] </Text>
                <Text color={badge.color}>{badge.label}</Text>
              </Box>
            );
          })}
        </Box>
      )}

      {unregistered.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="yellow">
            Not Registered ({unregistered.length})
          </Text>
          {unregistered.map((model) => {
            const badge = getCapabilityBadge(model.capability);
            return (
              <Box key={model.name}>
                <Text color="yellow">○</Text>
                <Text> {model.name} </Text>
                <Text color="gray">[{model.provider}] </Text>
                <Text color={badge.color}>{badge.label}</Text>
              </Box>
            );
          })}
        </Box>
      )}

      {unregistered.length === 0 && registered.length > 0 && (
        <Box marginTop={1}>
          <Text color="green">All models registered with MindStudio.</Text>
        </Box>
      )}
    </Box>
  );
}
