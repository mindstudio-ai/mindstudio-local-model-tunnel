import React, { useState, useMemo, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import { renderMarkdown } from '../components/MarkdownText';
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
  const termHeight = (stdout?.rows ?? 24) - 4; // matches App's height calc
  const headerHeight = 14; // border(2) + padding(2) + logo(9) + 1
  const footerLines = 6; // border-top(1) + margin(1) + "Actions"(1) + "Back"(1) + margin(1) + hint(1)
  const contentPadding = 2; // paddingY={1}
  const viewHeight = termHeight - headerHeight - footerLines - contentPadding;
  const contentWidth = (stdout?.columns ?? 80) - 4; // 2 padding + 1 scrollbar + 1 margin

  const renderedLines = useMemo(() => {
    const rendered = renderMarkdown(provider.readme, contentWidth);
    return rendered.split('\n');
  }, [provider.readme, contentWidth]);

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
    const thumbSize = Math.max(
      1,
      Math.round((viewHeight / renderedLines.length) * viewHeight),
    );
    const thumbPos = Math.round(
      (scrollOffset / maxScroll) * (viewHeight - thumbSize),
    );

    return Array.from(
      { length: viewHeight },
      (_, i) => i >= thumbPos && i < thumbPos + thumbSize,
    );
  }, [scrollOffset, maxScroll, viewHeight, renderedLines.length]);

  return (
    <Box flexDirection="column">
      <Box height={viewHeight}>
        <Box
          flexDirection="column"
          paddingX={1}
          paddingY={1}
          flexGrow={1}
          overflow="hidden"
        >
          <Text>{visibleContent}</Text>
        </Box>
        {scrollbar && (
          <Box flexDirection="column">
            {scrollbar.map((isThumb, i) => (
              <Text
                key={i}
                color={isThumb ? 'cyan' : 'gray'}
                dimColor={!isThumb}
              >
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
          <Text color="gray">
            Actions
          </Text>
        </Box>
        <Box>
          <Text color="cyan" bold>
            {'\u276F'} Back
          </Text>
          <Text color="gray"> - Return to providers</Text>
        </Box>
        <Box marginTop={1} height={1}>
          <Text color="gray" wrap="truncate-end">
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
  const { providers, loading } = useSetupProviders();
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const running = useMemo(
    () => providers.filter((p) => p.status.running),
    [providers],
  );
  const installed = useMemo(
    () => providers.filter((p) => p.status.installed && !p.status.running),
    [providers],
  );
  const notInstalled = useMemo(
    () => providers.filter((p) => !p.status.installed),
    [providers],
  );
  const allProviders = useMemo(
    () => [...running, ...installed, ...notInstalled],
    [running, installed, notInstalled],
  );

  const totalItems = allProviders.length + 1; // +1 for Back
  const backIndex = allProviders.length;
  const [cursorIndex, setCursorIndex] = useState(backIndex);

  useEffect(() => {
    setCursorIndex(backIndex);
  }, [backIndex]);

  useInput((input, key) => {
    if (selectedProvider) return;
    if (input === 'q' || key.escape) {
      onBack();
      return;
    }
    if (key.upArrow) {
      setCursorIndex((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setCursorIndex((prev) => Math.min(totalItems - 1, prev + 1));
    } else if (key.return) {
      if (cursorIndex === backIndex) {
        onBack();
      } else if (allProviders[cursorIndex]) {
        setSelectedProvider(allProviders[cursorIndex]!.provider.name);
      }
    }
  });

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
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        <Text bold color="white" underline>
          Manage Providers
        </Text>
        <Text color="gray">Select a provider to view its setup guide.</Text>

        {loading ? (
          <Box marginTop={1}>
            <Text color="cyan">
              <Spinner type="dots" />
            </Text>
            <Text> Detecting providers...</Text>
          </Box>
        ) : (
          <Box flexDirection="column" marginTop={1}>
            {running.length > 0 && (
              <>
                <Text bold color="green">
                  Running
                </Text>
                {running.map(({ provider }, i) => {
                  const index = i;
                  const isSelected = index === cursorIndex;
                  return (
                    <Box
                      key={provider.name}
                      flexDirection="column"
                      marginTop={i > 0 ? 1 : 0}
                    >
                      <Box>
                        <Text
                          color={isSelected ? 'cyan' : 'white'}
                          bold={isSelected}
                        >
                          {isSelected ? '\u276F' : ' '} {'\u25CF'}{' '}
                          {provider.displayName}
                        </Text>
                      </Box>
                      <Text color="gray" wrap="wrap">
                        {'   '}
                        {provider.description}
                      </Text>
                    </Box>
                  );
                })}
              </>
            )}
            {installed.length > 0 && (
              <Box
                flexDirection="column"
                marginTop={running.length > 0 ? 1 : 0}
              >
                <Text bold color="yellow">
                  Installed
                </Text>
                {installed.map(({ provider, status }, i) => {
                  const index = running.length + i;
                  const isSelected = index === cursorIndex;
                  return (
                    <Box
                      key={provider.name}
                      flexDirection="column"
                      marginTop={i > 0 ? 1 : 0}
                    >
                      <Box>
                        <Text
                          color={isSelected ? 'cyan' : 'white'}
                          bold={isSelected}
                        >
                          {isSelected ? '\u276F' : ' '} {'\u25CB'}{' '}
                          {provider.displayName}
                        </Text>
                      </Box>
                      <Text color="gray" wrap="wrap">
                        {'   '}
                        {provider.description}
                      </Text>
                    </Box>
                  );
                })}
              </Box>
            )}
            {notInstalled.length > 0 && (
              <Box
                flexDirection="column"
                marginTop={running.length > 0 || installed.length > 0 ? 1 : 0}
              >
                <Text bold color="gray">
                  Not Installed
                </Text>
                {notInstalled.map(({ provider }, i) => {
                  const index = running.length + installed.length + i;
                  const isSelected = index === cursorIndex;
                  return (
                    <Box
                      key={provider.name}
                      flexDirection="column"
                      marginTop={i > 0 ? 1 : 0}
                    >
                      <Box>
                        <Text
                          color={isSelected ? 'cyan' : 'white'}
                          bold={isSelected}
                        >
                          {isSelected ? '\u276F' : ' '} {provider.displayName}
                        </Text>
                      </Box>
                      <Text color="gray" wrap="wrap">
                        {'   '}
                        {provider.description}
                      </Text>
                    </Box>
                  );
                })}
              </Box>
            )}

            {/* Back option */}
            <Box marginTop={1}>
              <Text
                color={cursorIndex === backIndex ? 'cyan' : 'white'}
                bold={cursorIndex === backIndex}
              >
                {cursorIndex === backIndex ? '\u276F' : ' '} Back
              </Text>
            </Box>
          </Box>
        )}

        <Box marginTop={1}>
          <Text color="gray">
            Up/Down Navigate {'\u2022'} Enter Select {'\u2022'} q/Esc Back
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
