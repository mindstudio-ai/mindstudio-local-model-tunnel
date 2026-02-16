import React from 'react';
import { Box, Text } from 'ink';
import {
  getConfigPath,
  getEnvironmentInfo,
  getOllamaBaseUrl,
  getLMStudioBaseUrl,
  getStableDiffusionBaseUrl,
  getComfyUIBaseUrl,
} from '../../config.js';

export function ConfigPage() {
  const info = getEnvironmentInfo();
  const envBadge = info.current === 'prod' ? 'PROD' : 'LOCAL';
  const envColor = info.current === 'prod' ? 'green' : 'yellow';

  return (
    <Box flexDirection="column" marginTop={1} paddingX={1}>
      <Text bold color="white" underline>
        Configuration
      </Text>

      <Box flexDirection="column" marginTop={1}>
        <Box>
          <Text color="gray">{'Config file:     '}</Text>
          <Text color="white">{getConfigPath()}</Text>
        </Box>
        <Box>
          <Text color="gray">{'Environment:     '}</Text>
          <Text color={envColor} bold>
            {envBadge}
          </Text>
        </Box>
        <Box>
          <Text color="gray">{'API URL:         '}</Text>
          <Text color="white">{info.apiBaseUrl}</Text>
        </Box>
        <Box>
          <Text color="gray">{'API key:         '}</Text>
          <Text color={info.hasApiKey ? 'green' : 'yellow'}>
            {info.hasApiKey ? 'Set' : 'Not set'}
          </Text>
        </Box>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold underline color="white">
          Provider URLs
        </Text>
        <Box>
          <Text color="gray">{'Ollama:            '}</Text>
          <Text color="white">{getOllamaBaseUrl()}</Text>
        </Box>
        <Box>
          <Text color="gray">{'LM Studio:         '}</Text>
          <Text color="white">{getLMStudioBaseUrl()}</Text>
        </Box>
        <Box>
          <Text color="gray">{'Stable Diffusion:  '}</Text>
          <Text color="white">{getStableDiffusionBaseUrl()}</Text>
        </Box>
        <Box>
          <Text color="gray">{'ComfyUI:           '}</Text>
          <Text color="white">{getComfyUIBaseUrl()}</Text>
        </Box>
      </Box>
    </Box>
  );
}
