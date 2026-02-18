import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { NavigationMenu } from '../components';
import type { MenuItem } from '../components';
import { useSetupProviders } from '../hooks/useSetupProviders';
import type { Provider, InstructionStep } from '../../providers/types';

interface SetupPageProps {
  onBack: () => void;
}

function getPlatformKey(): 'macos' | 'linux' | 'windows' {
  switch (process.platform) {
    case 'darwin': return 'macos';
    case 'win32': return 'windows';
    default: return 'linux';
  }
}

function getInstructionsForState(
  provider: Provider,
  status: { installed: boolean; running: boolean },
): { label: string; steps: InstructionStep[] } | null {
  const platform = getPlatformKey();

  if (!status.installed) {
    const steps = provider.instructions.install[platform];
    if (steps && steps.length > 0) {
      return { label: 'To install:', steps };
    }
    return null;
  }

  if (!status.running) {
    const steps = provider.instructions.start[platform];
    if (steps && steps.length > 0) {
      return { label: 'To start:', steps };
    }
    return null;
  }

  // Running — optionally show stop instructions
  if (provider.instructions.stop) {
    const steps = provider.instructions.stop[platform];
    if (steps && steps.length > 0) {
      return { label: 'To stop:', steps };
    }
  }

  return null;
}

export function SetupPage({
  onBack,
}: SetupPageProps) {
  const { providers, loading, refresh } = useSetupProviders();

  const menuItems = useMemo((): MenuItem[] => {
    return [
      { id: 'refresh', label: 'Refresh', description: 'Re-detect providers' },
      { id: 'back', label: 'Back', description: 'Return to dashboard' },
    ];
  }, []);

  const handleSelect = (id: string) => {
    if (id === 'back') {
      onBack();
      return;
    }
    if (id === 'refresh') {
      refresh();
      return;
    }
  };

  const statusText = (s: { installed: boolean; running: boolean }) =>
    s.running ? 'Running' : s.installed ? 'Installed (not running)' : 'Not installed';
  const statusIcon = (s: { installed: boolean; running: boolean }) =>
    s.running ? '\u25CF' : s.installed ? '\u25CB' : '\u2717';
  const statusColor = (s: { installed: boolean; running: boolean }): string =>
    s.running ? 'green' : s.installed ? 'yellow' : 'gray';

  return (
    <Box flexDirection="column">
      {loading && (
        <Box marginTop={1} paddingX={1}>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text> Detecting providers...</Text>
        </Box>
      )}

      {!loading && providers.map(({ provider, status }) => {
        const info = getInstructionsForState(provider, status);

        return (
          <Box key={provider.name} flexDirection="column" marginTop={1} paddingX={1}>
            <Text color={statusColor(status)}>
              {statusIcon(status)} <Text bold>{provider.displayName}</Text> - {statusText(status)}
            </Text>
            {status.warning && (
              <Text color="yellow">  {status.warning}</Text>
            )}
            {info && (
              <Box flexDirection="column" marginLeft={2} marginTop={0}>
                <Text dimColor>{info.label}</Text>
                {info.steps.map((step, i) => (
                  <Box key={i} flexDirection="column">
                    <Text>  {step.text}</Text>
                    {step.command && (
                      <Text color="cyan">  $ {step.command}</Text>
                    )}
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        );
      })}

      <NavigationMenu items={menuItems} onSelect={handleSelect} title="Manage Providers" />
    </Box>
  );
}
