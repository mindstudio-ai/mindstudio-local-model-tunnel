import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';

export interface MenuItem {
  id: string;
  label: string;
  description: string;
  disabled?: boolean;
  disabledReason?: string;
  isSeparator?: boolean;
  color?: string;
}

interface NavigationMenuProps {
  items: MenuItem[];
  onSelect: (id: string) => void;
  title?: string;
}

export function NavigationMenu({ items, onSelect, title }: NavigationMenuProps) {
  const { stdout } = useStdout();
  const compact = (stdout?.rows ?? 24) < 40;

  const getDefaultIndex = () => {
    const backIdx = items.findIndex((i) => i.id === 'back');
    if (backIdx >= 0) return backIdx;
    const firstIdx = items.findIndex((i) => !i.disabled && !i.isSeparator);
    return firstIdx >= 0 ? firstIdx : 0;
  };
  const [selectedIndex, setSelectedIndex] = useState(getDefaultIndex);

  useEffect(() => {
    setSelectedIndex(getDefaultIndex());
  }, [items]);

  const selectableItems = items.filter((i) => !i.isSeparator);

  const findNextEnabled = (from: number, direction: 1 | -1): number => {
    let idx = from;
    for (let i = 0; i < items.length; i++) {
      idx = (idx + direction + items.length) % items.length;
      if (!items[idx]!.disabled && !items[idx]!.isSeparator) return idx;
    }
    return from;
  };

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      const backItem = items.find((i) => i.id === 'back');
      if (backItem) {
        onSelect('back');
      } else if (input === 'q') {
        onSelect('quit');
      }
      return;
    }
    if (key.upArrow || (compact && key.leftArrow)) {
      setSelectedIndex((prev) => findNextEnabled(prev, -1));
    } else if (key.downArrow || (compact && key.rightArrow)) {
      setSelectedIndex((prev) => findNextEnabled(prev, 1));
    } else if (key.return) {
      const item = items[selectedIndex];
      if (item && !item.disabled) {
        onSelect(item.id);
      }
    }
  });

  const hasBack = items.some((i) => i.id === 'back');

  if (compact) {
    const selectedItem = items[selectedIndex];
    return (
      <Box flexDirection="column" paddingX={1} borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} borderColor="gray">
        <Box height={1} overflow="hidden" gap={1}>
          {items.map((item, index) => {
            if (item.isSeparator) return null;
            const isSelected = index === selectedIndex;
            return (
              <Text
                key={item.id}
                color={item.disabled ? 'gray' : isSelected ? 'cyan' : 'white'}
                bold={isSelected}
                wrap="truncate-end"
              >
                {isSelected ? `❯ ${item.label}` : `  ${item.label}`}
              </Text>
            );
          })}
        </Box>
      </Box>
    );
  }

  // Fixed height: header + items + hint + margins
  const separatorExtraLines = items.filter((item, idx) => item.isSeparator && idx > 0).length;
  const menuHeight = items.length + 4 + separatorExtraLines;

  return (
    <Box flexDirection="column" paddingX={1} marginBottom={1} borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} borderColor="gray">
      <Box marginTop={1}>
        <Text color="gray">{title ?? 'Actions'}</Text>
      </Box>
      <Box flexDirection="column">
        {items.map((item, index) => {
          if (item.isSeparator) {
            return (
              <Box key={item.id} marginTop={index > 0 ? 1 : 0}>
                {item.label ? (
                  <Text bold color={item.color ?? 'gray'} wrap="truncate-end">
                    {item.label}
                  </Text>
                ) : null}
              </Box>
            );
          }

          const isSelected = index === selectedIndex;
          const prefix = isSelected ? '❯' : ' ';

          if (item.disabled) {
            return (
              <Box key={item.id} height={1} overflow="hidden">
                <Text color="gray" wrap="truncate-end">
                  {prefix} {item.label}
                  {item.disabledReason ? ` (${item.disabledReason})` : ''}
                </Text>
              </Box>
            );
          }

          return (
            <Box key={item.id} height={1} overflow="hidden">
              <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected} wrap="truncate-end">
                {prefix} {item.label}
              </Text>
              {isSelected && (
                <Text color="gray" wrap="truncate-end"> - {item.description}</Text>
              )}
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1} height={1}>
        <Text color="gray" wrap="truncate-end">
          {hasBack
            ? 'Up/Down Navigate \u2022 Enter Select \u2022 q/Esc Back'
            : 'Up/Down Navigate \u2022 Enter Select \u2022 q Quit'}
        </Text>
      </Box>
    </Box>
  );
}
