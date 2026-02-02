import React from "react";
import { Box, Text } from "ink";

interface Shortcut {
  key: string;
  label: string;
}

interface StatusBarProps {
  shortcuts?: Shortcut[];
}

const defaultShortcuts: Shortcut[] = [{ key: "Ctrl+C", label: "Force Quit" }];

export function StatusBar({ shortcuts = defaultShortcuts }: StatusBarProps) {
  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1} marginTop={1}>
      {shortcuts.map((shortcut, index) => (
        <Box key={shortcut.key} marginRight={2}>
          <Text color="cyan" bold>
            [{shortcut.key}]
          </Text>
          <Text color="gray"> {shortcut.label}</Text>
          {index < shortcuts.length - 1 && <Text color="gray"> </Text>}
        </Box>
      ))}
    </Box>
  );
}
