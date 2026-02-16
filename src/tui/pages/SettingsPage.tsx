import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { LocalModel } from '../../providers/types.js';
import {
  getConfigPath,
  getEnvironmentInfo,
  getOllamaBaseUrl,
  getLMStudioBaseUrl,
  getStableDiffusionBaseUrl,
  getComfyUIBaseUrl,
} from '../../config.js';

interface SettingsPageProps {
  models: LocalModel[];
  registeredNames: Set<string>;
  modelsLoading?: boolean;
  runningProviders?: Set<string>;
}

const PROVIDER_URLS: Array<{ id: string; label: string; getUrl: () => string }> = [
  { id: 'ollama', label: 'Ollama:            ', getUrl: getOllamaBaseUrl },
  { id: 'lmstudio', label: 'LM Studio:         ', getUrl: getLMStudioBaseUrl },
  { id: 'stable-diffusion', label: 'Stable Diffusion:  ', getUrl: getStableDiffusionBaseUrl },
  { id: 'comfyui', label: 'ComfyUI:           ', getUrl: getComfyUIBaseUrl },
];

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

export function SettingsPage({ models, registeredNames, modelsLoading, runningProviders }: SettingsPageProps) {
  const info = getEnvironmentInfo();
  const envBadge = info.current === 'prod' ? 'PROD' : 'LOCAL';
  const envColor = info.current === 'prod' ? 'green' : 'yellow';

  const visibleProviders = runningProviders
    ? PROVIDER_URLS.filter((p) => runningProviders.has(p.id))
    : PROVIDER_URLS;

  const registered = models.filter((m) => registeredNames.has(m.name));
  const unregistered = models.filter((m) => !registeredNames.has(m.name));

  return (
    <Box flexDirection="column" marginTop={1} paddingX={1}>
      {/* Configuration section */}
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

      {visibleProviders.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold underline color="white">
            Provider URLs
          </Text>
          {visibleProviders.map((p) => (
            <Box key={p.id}>
              <Text color="gray">{p.label}</Text>
              <Text color="white">{p.getUrl()}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Models section */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="white" underline>
          Models
        </Text>

        {modelsLoading ? (
          <Box marginTop={1}>
            <Text color="cyan">
              <Spinner type="dots" />
            </Text>
            <Text> Discovering local models...</Text>
          </Box>
        ) : models.length === 0 ? (
          <Box marginTop={1} flexDirection="column">
            <Text color="yellow">No models found.</Text>
            <Text color="gray">
              Download models using your provider (e.g., ollama pull llama3.2)
            </Text>
          </Box>
        ) : (
          <>
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
          </>
        )}
      </Box>
    </Box>
  );
}
