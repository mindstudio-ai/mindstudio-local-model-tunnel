import React from 'react';
import { Box, Text, useStdout } from 'ink';

export interface Tab {
  id: string;
  label: string;
}

interface TabBarProps {
  tabs: Tab[];
  activeTab: string;
}

export function TabBar({ tabs, activeTab }: TabBarProps) {
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;

  const tabSegments = tabs.map((tab) => {
    const isActive = tab.id === activeTab;
    const padded = ` ${tab.label} `;
    return { tab, isActive, padded };
  });

  const labelText = 'Screen  ';
  const hint = ' ←/→ ';
  const tabChars = tabSegments.reduce((sum, s) => sum + s.padded.length, 0);
  const remaining = Math.max(0, width - tabChars - hint.length - labelText.length);

  return (
    <Box>
      <Text color="gray">{labelText}</Text>
      {tabSegments.map(({ tab, isActive, padded }) => (
        <Text
          key={tab.id}
          bold={isActive}
          color={isActive ? 'white' : '#aaaaaa'}
          backgroundColor={isActive ? 'blueBright' : '#333333'}
        >
          {padded}
        </Text>
      ))}
      <Text color="#666666" backgroundColor="#333333">
        {' '.repeat(remaining)}{hint}
      </Text>
    </Box>
  );
}
