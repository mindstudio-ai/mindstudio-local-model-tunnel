import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { Header, NavigationMenu } from '../components/index.js';
import type { MenuItem } from '../components/index.js';
import type { ConnectionStatus } from '../types.js';
import { useSetupProviders } from '../hooks/useSetupProviders.js';

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
  const { providers, loading, modelActions, refresh } = useSetupProviders();

  const menuItems = useMemo((): MenuItem[] => {
    if (loading || providers.length === 0) return [
      { id: 'back', label: 'Back', description: 'Return to dashboard' },
    ];

    const items: MenuItem[] = [];

    const statusText = (s: { installed: boolean; running: boolean }) =>
      s.running ? 'Running' : s.installed ? 'Installed (not running)' : 'Not installed';
    const statusIcon = (s: { installed: boolean; running: boolean }) =>
      s.running ? '\u25CF' : s.installed ? '\u25CB' : '\u2717';
    const statusColor = (s: { installed: boolean; running: boolean }) =>
      s.running ? 'green' : s.installed ? 'yellow' : 'gray';

    const ollama = providers.find((p) => p.provider.name === 'ollama');
    const lmstudio = providers.find((p) => p.provider.name === 'lmstudio');
    const sd = providers.find((p) => p.provider.name === 'stable-diffusion');
    const comfyui = providers.find((p) => p.provider.name === 'comfyui');

    if (ollama) {
      items.push({
        id: 'sep-ollama',
        label: `${statusIcon(ollama.status)} ${ollama.provider.displayName} - ${statusText(ollama.status)}`,
        description: '',
        isSeparator: true,
        color: statusColor(ollama.status),
      });
      if (!ollama.status.installed) {
        items.push({
          id: 'install:ollama',
          label: ollama.status.installable
            ? 'Install Ollama (automatic)'
            : 'Download Ollama (opens browser)',
          description: 'Install Ollama for text generation',
        });
      } else if (!ollama.status.running) {
        items.push({
          id: 'start:ollama',
          label: 'Start Ollama server',
          description: 'Start the Ollama server',
        });
      } else {
        items.push({
          id: 'stop:ollama',
          label: 'Stop Ollama server',
          description: 'Stop the running Ollama server',
        });
      }
    }

    if (lmstudio) {
      items.push({
        id: 'sep-lmstudio',
        label: `${statusIcon(lmstudio.status)} ${lmstudio.provider.displayName} - ${statusText(lmstudio.status)}`,
        description: '',
        isSeparator: true,
        color: statusColor(lmstudio.status),
      });
      if (!lmstudio.status.installed) {
        items.push({
          id: 'install:lmstudio',
          label: 'Download LM Studio (opens browser)',
          description: 'Download LM Studio app',
        });
      }
    }

    if (sd) {
      items.push({
        id: 'sep-sd',
        label: `${statusIcon(sd.status)} ${sd.provider.displayName} - ${statusText(sd.status)}`,
        description: '',
        isSeparator: true,
        color: statusColor(sd.status),
      });

      if (sd.status.warning) {
        items.push({
          id: 'fix-python',
          label: 'Install Python 3.13 (required for Forge Neo)',
          description: 'Show Python installation instructions',
        });
      }

      if (!sd.status.installed) {
        if (sd.status.installable) {
          items.push({
            id: 'install:stable-diffusion',
            label: 'Install Stable Diffusion Forge Neo',
            description: 'Clone and set up SD Forge Neo',
          });
        }
      } else if (!sd.status.running) {
        items.push({
          id: 'start:stable-diffusion',
          label: 'Start Stable Diffusion server',
          description: 'Start the SD Forge Neo server',
        });
      } else {
        items.push({
          id: 'stop:stable-diffusion',
          label: 'Stop Stable Diffusion server',
          description: 'Stop the running SD server',
        });
      }

      // SD model download actions
      const sdActions = modelActions.get('stable-diffusion') || [];
      for (const action of sdActions) {
        if (!action.installed && sd.status.installed) {
          items.push({
            id: `download:stable-diffusion:${action.id}`,
            label: `Download default SDXL model (${action.sizeLabel})`,
            description: 'Download sd_xl_base_1.0 from Hugging Face',
          });
        }
      }
    }

    if (comfyui) {
      items.push({
        id: 'sep-comfyui',
        label: `${statusIcon(comfyui.status)} ${comfyui.provider.displayName} - ${statusText(comfyui.status)}`,
        description: '',
        isSeparator: true,
        color: statusColor(comfyui.status),
      });
      if (!comfyui.status.installed) {
        if (comfyui.status.installable) {
          items.push({
            id: 'install:comfyui',
            label: 'Install ComfyUI',
            description: 'Clone and set up ComfyUI for video generation',
          });
        }
      } else if (!comfyui.status.running) {
        items.push({
          id: 'start:comfyui',
          label: 'Start ComfyUI server',
          description: 'Start the ComfyUI server',
        });
      } else {
        // ComfyUI model download actions
        const comfyActions = modelActions.get('comfyui') || [];
        for (const action of comfyActions) {
          if (!action.installed) {
            items.push({
              id: `download:comfyui:${action.id}`,
              label: `Download ${action.label} (${action.sizeLabel})`,
              description: `Download ${action.label} model files`,
            });
          }
        }

        items.push({
          id: 'stop:comfyui',
          label: 'Stop ComfyUI server',
          description: 'Stop the running ComfyUI server',
        });
      }
    }

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
  }, [providers, loading, modelActions]);

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

  return (
    <Box flexDirection="column">
      <Header
        connection={connectionStatus}
        environment={environment}
        activeRequests={activeRequests}
        page="setup"
      />

      {loading && (
        <Box marginTop={1} paddingX={1}>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text> Detecting providers...</Text>
        </Box>
      )}

      <NavigationMenu items={menuItems} onSelect={handleSelect} title="Manage Providers" />
    </Box>
  );
}
