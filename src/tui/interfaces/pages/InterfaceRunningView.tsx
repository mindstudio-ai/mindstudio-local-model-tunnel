import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { execSync } from 'node:child_process';
import os from 'node:os';
import open from 'open';
import Spinner from 'ink-spinner';
import type { LocalInterfacePhase } from '../hooks/useLocalInterface';

function copyToClipboard(text: string): boolean {
  try {
    if (process.platform === 'darwin') {
      execSync('pbcopy', { input: text });
    } else if (process.platform === 'win32') {
      execSync('clip', { input: text });
    } else {
      execSync('xclip -selection clipboard', { input: text });
    }
    return true;
  } catch {
    return false;
  }
}

interface InterfaceRunningViewProps {
  name: string;
  phase: LocalInterfacePhase;
  outputLines: string[];
  errorMessage: string | null;
  localPath: string | undefined;
  onStop: () => void;
  onBack: () => void;
}

function getPhaseLabel(phase: LocalInterfacePhase): {
  text: string;
  color: string;
  showSpinner: boolean;
} {
  switch (phase) {
    case 'cloning':
      return { text: 'Cloning scaffold...', color: 'cyan', showSpinner: true };
    case 'installing':
      return {
        text: 'Installing dependencies...',
        color: 'cyan',
        showSpinner: true,
      };
    case 'running':
      return { text: 'Dev server running', color: 'green', showSpinner: true };
    case 'error':
      return { text: 'Error', color: 'red', showSpinner: false };
    case 'deleting':
      return {
        text: 'Deleting local copy...',
        color: 'yellow',
        showSpinner: true,
      };
    default:
      return { text: 'Idle', color: 'gray', showSpinner: false };
  }
}

export function InterfaceRunningView({
  name,
  phase,
  outputLines,
  errorMessage,
  localPath,
  onStop,
  onBack,
}: InterfaceRunningViewProps) {
  const { stdout } = useStdout();
  const termHeight = (stdout?.rows ?? 24) - 4;

  const isActive =
    phase === 'cloning' ||
    phase === 'installing' ||
    phase === 'running' ||
    phase === 'deleting';

  const displayPath = localPath?.replace(os.homedir(), '~');

  // Build menu items
  const menuItems = useMemo(() => {
    const items: Array<{ id: string; label: string; copyValue?: string }> = [];
    if (isActive && displayPath) {
      items.push({
        id: 'claude',
        label: 'Copy Claude Code Command',
        copyValue: `cd ${displayPath} && claude`,
      });
      items.push({
        id: 'codex',
        label: 'Copy Codex Command',
        copyValue: `cd ${displayPath} && codex`,
      });
      items.push({ id: 'reveal', label: 'Open Folder' });
    }
    items.push({ id: 'action', label: isActive ? 'Stop' : 'Back' });
    return items;
  }, [isActive, displayPath]);

  const [cursorIndex, setCursorIndex] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => clearTimeout(copiedTimerRef.current);
  }, []);

  // Layout
  const headerHeight = 14;
  const menuHeight = menuItems.length;
  const chromeLines = 7 + menuHeight;
  const logHeight = Math.max(3, termHeight - headerHeight - chromeLines);

  // Auto-follow log tail
  const maxScroll = Math.max(0, outputLines.length - logHeight);
  const effectiveOffset = maxScroll;

  const copyItem = (item: { id: string; copyValue?: string }) => {
    if (!item.copyValue) return;
    const success = copyToClipboard(item.copyValue);
    if (success) {
      setCopiedId(item.id);
      clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopiedId(null), 2000);
    }
  };

  useInput((input, key) => {
    if (key.upArrow) {
      setCursorIndex((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setCursorIndex((prev) => Math.min(menuItems.length - 1, prev + 1));
    } else if (key.return) {
      const item = menuItems[cursorIndex];
      if (!item) return;
      if (item.copyValue) {
        copyItem(item);
      } else if (item.id === 'reveal' && localPath) {
        open(localPath);
      } else if (isActive) {
        onStop();
      } else {
        onBack();
      }
    } else if (input === 'q' || key.escape) {
      if (isActive) {
        onStop();
      } else {
        onBack();
      }
    }
  });

  const visibleLines = outputLines.slice(
    effectiveOffset,
    effectiveOffset + logHeight,
  );

  const phaseInfo = getPhaseLabel(phase);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        <Text bold color="white" underline>
          {name}
        </Text>

        <Box marginTop={1}>
          {phaseInfo.showSpinner && (
            <Text color={phaseInfo.color}>
              <Spinner type="dots" />{' '}
            </Text>
          )}
          <Text color={phaseInfo.color}>{phaseInfo.text}</Text>
        </Box>

        {errorMessage && (
          <Box marginTop={1}>
            <Text color="red">{errorMessage}</Text>
          </Box>
        )}

        <Box marginTop={1} height={logHeight}>
          <Box flexDirection="column" flexGrow={1} overflow="hidden">
            {visibleLines.map((line, i) => (
              <Text key={effectiveOffset + i} wrap="truncate-end" color="gray">
                {line}
              </Text>
            ))}
          </Box>
        </Box>

        <Box marginTop={1} flexDirection="column">
          {menuItems.map((item, i) => {
            const isSelected = i === cursorIndex;
            const isCopied = copiedId === item.id;
            return (
              <Box key={item.id}>
                <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                  {isSelected ? '\u276F' : ' '} {item.label}
                </Text>
                {isCopied && <Text color="green"> {'\u2713'} Copied!</Text>}
              </Box>
            );
          })}
        </Box>

        <Box marginTop={1} height={1}>
          <Text color="gray" wrap="truncate-end">
            Up/Down Navigate {'\u2022'} Enter Select {'\u2022'} q/Esc{' '}
            {isActive ? 'Stop' : 'Back'}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
