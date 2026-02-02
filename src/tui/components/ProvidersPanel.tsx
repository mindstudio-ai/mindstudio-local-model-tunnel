import React from "react";
import { Box, Text } from "ink";
import type { ProviderStatus } from "../types.js";

interface ProvidersPanelProps {
  providers: ProviderStatus[];
}

export function ProvidersPanel({ providers }: ProvidersPanelProps) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="white">
          PROVIDERS
        </Text>
      </Box>
      {providers.length === 0 ? (
        <Text color="gray">Loading...</Text>
      ) : (
        providers.map(({ provider, running }) => (
          <Box key={provider.name}>
            <Text color={running ? "green" : "gray"}>
              {running ? "●" : "○"}
            </Text>
            <Text> </Text>
            <Text color={running ? "white" : "gray"}>
              {provider.displayName}
            </Text>
            <Text color="gray"> </Text>
            <Text color={running ? "green" : "gray"} dimColor={!running}>
              {running ? "Running" : "Stopped"}
            </Text>
          </Box>
        ))
      )}
    </Box>
  );
}
