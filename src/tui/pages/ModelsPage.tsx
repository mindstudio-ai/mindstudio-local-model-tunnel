import React from 'react';
import { Box, Text } from 'ink';
import type { LocalModel } from '../../providers/types.js';

interface ModelsPageProps {
  models: LocalModel[];
  registeredNames: Set<string>;
}

function getCapabilityColor(capability: string): string {
  switch (capability) {
    case 'text':
      return 'green';
    case 'image':
      return 'magenta';
    case 'video':
      return 'blue';
    default:
      return 'gray';
  }
}

export function ModelsPage({ models, registeredNames }: ModelsPageProps) {
  const textModels = models.filter((m) => m.capability === 'text');
  const imageModels = models.filter((m) => m.capability === 'image');
  const videoModels = models.filter((m) => m.capability === 'video');

  if (models.length === 0) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="yellow">No models found.</Text>
        <Text color="gray">
          Download models using your provider (e.g., ollama pull llama3.2)
        </Text>
      </Box>
    );
  }

  const renderModelGroup = (
    title: string,
    groupModels: LocalModel[],
    color: string,
  ) => {
    if (groupModels.length === 0) return null;

    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={color}>
          {title} ({groupModels.length})
        </Text>
        {groupModels.map((model) => {
          const isRegistered = registeredNames.has(model.name);
          const dotColor = isRegistered ? color : 'yellow';
          const suffix = isRegistered ? '' : ' (not registered)';

          return (
            <Box key={model.name}>
              <Text color={dotColor}>{isRegistered ? '●' : '○'}</Text>
              <Text> {model.name} </Text>
              <Text color="gray">[{model.provider}]</Text>
              {!isRegistered && <Text color="gray">{suffix}</Text>}
            </Box>
          );
        })}
      </Box>
    );
  };

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="white" underline>
        Local Models
      </Text>
      <Box marginTop={1} flexDirection="column">
        {renderModelGroup('Text Models', textModels, 'green')}
        {renderModelGroup('Image Models', imageModels, 'magenta')}
        {renderModelGroup('Video Models', videoModels, 'blue')}
      </Box>
      <Text color="gray">
        {'● = registered with MindStudio, ○ = not registered'}
      </Text>
    </Box>
  );
}
