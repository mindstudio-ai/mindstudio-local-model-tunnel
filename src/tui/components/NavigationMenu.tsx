import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface MenuItem {
  id: string;
  label: string;
  description: string;
  disabled?: boolean;
  disabledReason?: string;
}

interface NavigationMenuProps {
  items: MenuItem[];
  onSelect: (id: string) => void;
}

export function NavigationMenu({ items, onSelect }: NavigationMenuProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const findNextEnabled = (from: number, direction: 1 | -1): number => {
    let idx = from;
    for (let i = 0; i < items.length; i++) {
      idx = (idx + direction + items.length) % items.length;
      if (!items[idx]!.disabled) return idx;
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
    if (key.upArrow) {
      setSelectedIndex((prev) => findNextEnabled(prev, -1));
    } else if (key.downArrow) {
      setSelectedIndex((prev) => findNextEnabled(prev, 1));
    } else if (key.return) {
      const item = items[selectedIndex];
      if (item && !item.disabled) {
        onSelect(item.id);
      }
    }
  });

  // Fixed height: header + marginBottom + items + marginTop + hint + 2 border lines
  const menuHeight = items.length + 7;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} height={menuHeight} overflow="hidden">
      <Box marginBottom={1}>
        <Text bold underline color="white">Actions</Text>
      </Box>
      <Box flexDirection="column">
        {items.map((item, index) => {
          const isSelected = index === selectedIndex;
          const prefix = isSelected ? '>' : ' ';

          if (item.disabled) {
            return (
              <Box key={item.id}>
                <Text color="gray" wrap="truncate-end">
                  {prefix} {item.label}
                  {item.disabledReason ? ` (${item.disabledReason})` : ''}
                </Text>
              </Box>
            );
          }

          return (
            <Box key={item.id}>
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
        <Text color="gray" dimColor wrap="truncate-end">
          {items.some((i) => i.id === 'back')
            ? 'Up/Down Navigate \u2022 Enter Select \u2022 q/Esc Back'
            : 'Up/Down Navigate \u2022 Enter Select \u2022 q Quit'}
        </Text>
      </Box>
    </Box>
  );
}
