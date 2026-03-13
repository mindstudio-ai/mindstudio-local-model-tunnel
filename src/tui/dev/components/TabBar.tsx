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

  const tabChars = tabSegments.reduce((sum, s) => sum + s.padded.length, 0);
  const hint = ' ←/→ ';
  const remaining = Math.max(0, width - tabChars - hint.length);

  return (
    <Box>
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
