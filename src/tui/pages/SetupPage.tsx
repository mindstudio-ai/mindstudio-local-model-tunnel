import React, { useMemo } from 'react';
import { Box, Text, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import { Header, NavigationMenu } from '../components/index.js';
import type { MenuItem } from '../components/index.js';
import type { ConnectionStatus } from '../types.js';
import { useSetupProviders } from '../hooks/useSetupProviders.js';
import type { ProviderInfo } from '../../quickstart/detect.js';

interface SetupPageProps {
  connectionStatus: ConnectionStatus;
  environment: 'prod' | 'local';
  activeRequests: number;
  onExternalAction: (action: string) => void;
  onBack: () => void;
}

export function SetupPage({
  connectionStatus,
  environment,
  activeRequests,
  onExternalAction,
  onBack,
}: SetupPageProps) {
  const { providers, loading, sdModelExists, comfyModelStatus, refresh } =
    useSetupProviders();
  const { stdout } = useStdout();
  const termHeight = (stdout?.rows ?? 24) - 4;

  const menuItems = useMemo((): MenuItem[] => {
    if (loading || providers.length === 0) return [
      { id: 'back', label: 'Back', description: 'Return to dashboard' },
    ];

    const items: MenuItem[] = [];

    const ollama = providers.find((p) => p.id === 'ollama');
    const lmstudio = providers.find((p) => p.id === 'lmstudio');
    const sd = providers.find((p) => p.id === 'stable-diffusion');
    const comfyui = providers.find((p) => p.id === 'comfyui');

    // --- Text Generation ---
    const hasTextItems =
      (ollama && (!ollama.installed || ollama.running)) ||
      (lmstudio && !lmstudio.installed);

    if (hasTextItems) {
      items.push({
        id: 'sep-text',
        label: 'Text Generation',
        description: '',
        isSeparator: true,
      });
    }

    if (ollama) {
      if (!ollama.installed) {
        items.push({
          id: 'install-ollama',
          label: ollama.installable
            ? 'Install Ollama (automatic)'
            : 'Download Ollama (opens browser)',
          description: 'Install Ollama for text generation',
        });
      } else if (ollama.running) {
        items.push({
          id: 'stop-ollama',
          label: 'Stop Ollama server',
          description: 'Stop the running Ollama server',
        });
      }
    }

    if (lmstudio && !lmstudio.installed) {
      items.push({
        id: 'install-lmstudio',
        label: 'Download LM Studio (opens browser)',
        description: 'Download LM Studio app',
      });
    }

    // --- Image Generation ---
    const hasImageItems = sd != null;
    if (hasImageItems) {
      items.push({
        id: 'sep-image',
        label: 'Image Generation',
        description: '',
        isSeparator: true,
      });
    }

    if (sd) {
      if (sd.warning) {
        items.push({
          id: 'fix-python',
          label: 'Install Python 3.13 (required for Forge Neo)',
          description: 'Show Python installation instructions',
        });
      }

      if (!sd.installed) {
        if (sd.installable) {
          items.push({
            id: 'install-sd',
            label: 'Install Stable Diffusion Forge Neo',
            description: 'Clone and set up SD Forge Neo',
          });
        }
      } else if (!sd.running) {
        items.push({
          id: 'start-sd',
          label: 'Start Stable Diffusion server',
          description: 'Start the SD Forge Neo server',
        });
      } else {
        items.push({
          id: 'stop-sd',
          label: 'Stop Stable Diffusion server',
          description: 'Stop the running SD server',
        });
      }

      if (sd.installed && !sdModelExists) {
        items.push({
          id: 'download-sd-model',
          label: 'Download default SDXL model (~6.5 GB)',
          description: 'Download sd_xl_base_1.0 from Hugging Face',
        });
      }
    }

    // --- Video Generation ---
    const hasVideoItems = comfyui != null;
    if (hasVideoItems) {
      items.push({
        id: 'sep-video',
        label: 'Video Generation',
        description: '',
        isSeparator: true,
      });
    }

    if (comfyui) {
      if (!comfyui.installed) {
        if (comfyui.installable) {
          items.push({
            id: 'install-comfyui',
            label: 'Install ComfyUI',
            description: 'Clone and set up ComfyUI for video generation',
          });
        }
      } else if (!comfyui.running) {
        items.push({
          id: 'start-comfyui',
          label: 'Start ComfyUI server',
          description: 'Start the ComfyUI server',
        });
      } else {
        for (const model of comfyModelStatus) {
          if (!model.installed) {
            items.push({
              id: `download-comfyui-model:${model.id}`,
              label: `Download ${model.label} (${model.totalSize})`,
              description: `Download ${model.label} model files`,
            });
          }
        }

        items.push({
          id: 'stop-comfyui',
          label: 'Stop ComfyUI server',
          description: 'Stop the running ComfyUI server',
        });
      }
    }

    // --- General ---
    items.push({
      id: 'sep-general',
      label: '',
      description: '',
      isSeparator: true,
    });
    items.push({
      id: 'refresh',
      label: 'Refresh',
      description: 'Re-detect providers',
    });
    items.push({
      id: 'back',
      label: 'Back',
      description: 'Return to dashboard',
    });

    return items;
  }, [providers, loading, sdModelExists, comfyModelStatus]);

  const handleSelect = (id: string) => {
    if (id === 'back') {
      onBack();
      return;
    }
    if (id === 'refresh') {
      refresh();
      return;
    }
    // All other actions are external
    onExternalAction(id);
  };

  // Provider status groups
  const providerGroups: Array<{ label: string; ids: string[] }> = [
    { label: 'Text', ids: ['ollama', 'lmstudio'] },
    { label: 'Image', ids: ['stable-diffusion'] },
    { label: 'Video', ids: ['comfyui'] },
  ];

  return (
    <Box flexDirection="column" height={termHeight}>
      <Header
        connection={connectionStatus}
        environment={environment}
        activeRequests={activeRequests}
        page="setup"
      />

      {/* Provider Status */}
      <Box flexDirection="column" marginTop={1} paddingX={1}>
        <Text bold color="white" underline>
          Provider Status
        </Text>
        {loading ? (
          <Box marginTop={1}>
            <Text color="cyan">
              <Spinner type="dots" />
            </Text>
            <Text> Detecting providers...</Text>
          </Box>
        ) : (
          providerGroups.map((group) => {
            const groupProviders = providers.filter((p) =>
              group.ids.includes(p.id),
            );
            if (groupProviders.length === 0) return null;
            return (
              <Box key={group.label} marginTop={1} flexDirection="column">
                <Text color="gray" dimColor>
                  {group.label}
                </Text>
                {groupProviders.map((provider: ProviderInfo) => (
                  <Box key={provider.id} flexDirection="column">
                    <Box>
                      <Text
                        color={
                          provider.installed
                            ? provider.running
                              ? 'green'
                              : 'yellow'
                            : 'red'
                        }
                      >
                        {provider.installed
                          ? provider.running
                            ? '\u25CF'
                            : '\u25CB'
                          : '\u2717'}
                      </Text>
                      <Text> {provider.name} - </Text>
                      <Text color="gray">
                        {provider.running
                          ? 'Running'
                          : provider.installed
                            ? 'Installed (not running)'
                            : 'Not installed'}
                      </Text>
                    </Box>
                    {provider.warning && (
                      <Box>
                        <Text color="yellow"> \u26A0 {provider.warning}</Text>
                      </Box>
                    )}
                  </Box>
                ))}
              </Box>
            );
          })
        )}
      </Box>

      <Box flexGrow={1} />

      <NavigationMenu items={menuItems} onSelect={handleSelect} />
    </Box>
  );
}
