import React, { useState, useMemo } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import { NavigationMenu, MarkdownText } from '../components';
import type { MenuItem } from '../components';
import { useSetupProviders } from '../hooks/useSetupProviders';
import type { Provider } from '../../providers/types';

interface SetupPageProps {
  onBack: () => void;
}

function ProviderDetailView({
  provider,
  onBack,
}: {
  provider: Provider;
  onBack: () => void;
}) {
  const [scrollOffset, setScrollOffset] = useState(0);
  const { stdout } = useStdout();
  const footerHeight = 7;
  const viewHeight = (stdout?.rows ?? 24) - footerHeight;

  const renderedLines = useMemo(() => {
    return provider.readme.split('\n');
  }, [provider.readme]);

  const maxScroll = Math.max(0, renderedLines.length - viewHeight);

  useInput((input, key) => {
    if (input === 'q' || key.escape || key.return) {
      onBack();
      return;
    }
    if (key.upArrow) {
      setScrollOffset((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setScrollOffset((prev) => Math.min(maxScroll, prev + 1));
    }
  });

  const visibleContent = renderedLines
    .slice(scrollOffset, scrollOffset + viewHeight)
    .join('\n');

  const scrollbar = useMemo(() => {
    if (maxScroll === 0) return null;
    const thumbSize = Math.max(1, Math.round((viewHeight / renderedLines.length) * viewHeight));
    const thumbPos = Math.round((scrollOffset / maxScroll) * (viewHeight - thumbSize));

    return Array.from({ length: viewHeight }, (_, i) =>
      i >= thumbPos && i < thumbPos + thumbSize,
    );
  }, [scrollOffset, maxScroll, viewHeight, renderedLines.length]);

  return (
    <Box flexDirection="column">
      <Box height={viewHeight}>
        <Box flexDirection="column" paddingX={2} paddingY={1} flexGrow={1} overflow="hidden">
          <MarkdownText content={visibleContent} />
        </Box>
        {scrollbar && (
          <Box flexDirection="column">
            {scrollbar.map((isThumb, i) => (
              <Text key={i} color={isThumb ? 'cyan' : 'gray'} dimColor={!isThumb}>
                {isThumb ? '\u2503' : '\u2502'}
              </Text>
            ))}
          </Box>
        )}
      </Box>

      <Box
        flexDirection="column"
        paddingX={1}
        borderStyle="single"
        borderTop
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        borderColor="gray"
      >
        <Box marginTop={1}>
          <Text color="gray" dimColor>Actions</Text>
        </Box>
        <Box>
          <Text color="cyan" bold>{'\u276F'} Back</Text>
          <Text color="gray"> - Return to providers</Text>
        </Box>
        <Box marginTop={1} height={1}>
          <Text color="gray" dimColor wrap="truncate-end">
            Up/Down Scroll {'\u2022'} Enter/q/Esc Back
            {maxScroll > 0 &&
              ` \u2022 ${Math.round((scrollOffset / maxScroll) * 100)}%`}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

export function SetupPage({ onBack }: SetupPageProps) {
  const { providers, loading, refresh } = useSetupProviders();
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  const menuItems = useMemo((): MenuItem[] => {
    const running = providers.filter((p) => p.status.running);
    const installed = providers.filter(
      (p) => p.status.installed && !p.status.running,
    );
    const notInstalled = providers.filter((p) => !p.status.installed);

    const items: MenuItem[] = [];

    if (running.length > 0) {
      items.push({
        id: 'sep-running',
        label: 'Running',
        description: '',
        isSeparator: true,
        color: 'green',
      });
      for (const { provider, status } of running) {
        items.push({
          id: provider.name,
          label: `\u25CF ${provider.displayName}`,
          description: provider.description,
          color: 'green',
        });
      }
    }

    if (installed.length > 0) {
      items.push({
        id: 'sep-installed',
        label: 'Installed',
        description: '',
        isSeparator: true,
        color: 'yellow',
      });
      for (const { provider, status } of installed) {
        items.push({
          id: provider.name,
          label: `\u25CB ${provider.displayName}`,
          description: `${provider.description}${status.warning ? ` (${status.warning})` : ''}`,
          color: 'yellow',
        });
      }
    }

    if (notInstalled.length > 0) {
      items.push({
        id: 'sep-not-installed',
        label: 'Not Installed',
        description: '',
        isSeparator: true,
        color: 'gray',
      });
      for (const { provider } of notInstalled) {
        items.push({
          id: provider.name,
          label: `\u2717 ${provider.displayName}`,
          description: provider.description,
        });
      }
    }

    items.push({
      id: 'sep-actions',
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
  }, [providers]);

  const handleSelect = (id: string) => {
    if (id === 'back') {
      onBack();
      return;
    }
    if (id === 'refresh') {
      refresh();
      return;
    }
    // Must be a provider name
    const found = providers.find((p) => p.provider.name === id);
    if (found) {
      setSelectedProvider(id);
    }
  };

  if (selectedProvider) {
    const found = providers.find((p) => p.provider.name === selectedProvider);
    if (found) {
      return (
        <ProviderDetailView
          provider={found.provider}
          onBack={() => setSelectedProvider(null)}
        />
      );
    }
  }

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

      <NavigationMenu
        items={menuItems}
        onSelect={handleSelect}
        title="Manage Providers"
      />
    </Box>
  );
}
