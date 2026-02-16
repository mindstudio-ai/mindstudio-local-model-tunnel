import React from 'react';
import { Box, Text } from 'ink';
import { ProvidersPanel, ModelsPanel, RequestLog } from '../components/index.js';
import type { ProviderStatus, RequestLogEntry } from '../types.js';
import type { LocalModel } from '../../providers/types.js';

interface DashboardPageProps {
  providers: ProviderStatus[];
  models: LocalModel[];
  requests: RequestLogEntry[];
  activeCount: number;
}

export function DashboardPage({
  providers,
  models,
  requests,
  activeCount,
}: DashboardPageProps) {
  const hasRunningProvider = providers.some((p) => p.running);

  if (providers.length > 0 && !hasRunningProvider) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="yellow" bold>
          No providers running
        </Text>
        <Text color="gray">Start one of the following:</Text>
        <Text color="white"> Ollama: ollama serve</Text>
        <Text color="white"> LM Studio: Start the local server</Text>
        <Text color="white"> Stable Diffusion: Start AUTOMATIC1111</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* Main content area */}
      <Box flexDirection="row" marginTop={1}>
        {/* Left column: Providers */}
        <Box width="40%">
          <ProvidersPanel providers={providers} />
        </Box>

        {/* Right column: Models */}
        <Box width="60%" marginLeft={1}>
          <ModelsPanel models={models} />
        </Box>
      </Box>

      {/* Request log */}
      <Box marginTop={1}>
        <RequestLog requests={requests} />
      </Box>
    </Box>
  );
}
