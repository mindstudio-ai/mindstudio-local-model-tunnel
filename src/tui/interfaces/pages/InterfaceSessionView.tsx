import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import os from 'node:os';
import open from 'open';
import type { InterfaceItem, ScriptItem } from './InterfacesPage';

interface InterfaceSessionViewProps {
  item: InterfaceItem | ScriptItem;
  onStart: () => void;
  onDelete: () => void;
  onBack: () => void;
  hasLocalCopy: boolean;
  localPath: string | undefined;
}

export function InterfaceSessionView({
  item,
  onStart,
  onDelete,
  onBack,
  hasLocalCopy,
  localPath,
}: InterfaceSessionViewProps) {
  const menuItems: Array<{ id: string; label: string }> = [
    { id: 'start', label: 'Start Locally' },
  ];
  if (hasLocalCopy) {
    menuItems.push({ id: 'reveal', label: 'Open Folder' });
    menuItems.push({ id: 'delete', label: 'Delete Local Copy' });
  }
  menuItems.push({ id: 'back', label: 'Back' });

  const [cursorIndex, setCursorIndex] = useState(0);

  useEffect(() => {
    setCursorIndex(0);
  }, [hasLocalCopy]);

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      onBack();
      return;
    }
    if (key.upArrow) {
      setCursorIndex((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setCursorIndex((prev) => Math.min(menuItems.length - 1, prev + 1));
    } else if (key.return) {
      const selected = menuItems[cursorIndex];
      if (!selected) return;
      switch (selected.id) {
        case 'start':
          onStart();
          break;
        case 'reveal':
          if (localPath) {
            open(localPath);
          }
          break;
        case 'delete':
          onDelete();
          break;
        case 'back':
          onBack();
          break;
      }
    }
  });

  const name = `${item.step.workflowName} - ${item.step.displayName}`;
  const displayPath = localPath?.replace(os.homedir(), '~');

  let sessionInfo: string | null = null;
  if (item.kind === 'interface') {
    const hotUpdateDomain = item.step.spaEditorSession?.hotUpdateDomain ?? '';
    sessionInfo =
      hotUpdateDomain.replace(/^https?:\/\//, '').split('.')[0] || null;
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        <Text bold color="white" underline>
          {name}
        </Text>

        <Box marginTop={1} flexDirection="column">
          {sessionInfo && <Text color="gray">Session: {sessionInfo}</Text>}
          {hasLocalCopy && localPath ? (
            <>
              <Text color="green">Local copy exists</Text>
              <Text color="gray">Path: {displayPath}</Text>
            </>
          ) : (
            <Text color="yellow">
              No local copy. &quot;Start Locally&quot; will clone the scaffold
              and install dependencies.
            </Text>
          )}
        </Box>

        <Box marginTop={1} flexDirection="column">
          {menuItems.map((menuItem, i) => {
            const isSelected = i === cursorIndex;
            return (
              <Text
                key={menuItem.id}
                color={isSelected ? 'cyan' : 'white'}
                bold={isSelected}
              >
                {isSelected ? '\u276F' : ' '} {menuItem.label}
              </Text>
            );
          })}
        </Box>

        <Box marginTop={1}>
          <Text color="gray">
            Up/Down Navigate {'\u2022'} Enter Select {'\u2022'} q/Esc Back
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
