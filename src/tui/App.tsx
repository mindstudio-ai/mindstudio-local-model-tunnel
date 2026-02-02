import React, { useEffect, useCallback, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import {
  Header,
  ProvidersPanel,
  ModelsPanel,
  RequestLog,
  StatusBar,
} from "./components/index.js";
import {
  useConnection,
  useProviders,
  useModels,
  useRequests,
} from "./hooks/index.js";
import { TunnelRunner } from "./TunnelRunner.js";

interface AppProps {
  runner: TunnelRunner;
}

export function App({ runner }: AppProps) {
  const { exit } = useApp();
  const {
    status: connectionStatus,
    environment,
    error: connectionError,
  } = useConnection();
  const { providers, refresh: refreshProviders } = useProviders();
  const { models, refresh: refreshModels } = useModels();
  const { requests, activeCount } = useRequests();
  const [lastKey, setLastKey] = useState<string>("");

  // Start the runner when connected
  useEffect(() => {
    if (connectionStatus === "connected" && models.length > 0) {
      runner.start(models.map((m) => m.name));
    }

    return () => {
      runner.stop();
    };
  }, [connectionStatus, models, runner]);

  // Refresh everything
  const refreshAll = useCallback(async () => {
    await Promise.all([refreshProviders(), refreshModels()]);
  }, [refreshProviders, refreshModels]);

  // Keyboard shortcuts
  useInput((input, key) => {
    // Debug: show what key was pressed
    setLastKey(input || (key.escape ? "ESC" : "?"));

    // Quit on 'q' or Escape
    if (input.toLowerCase() === "q" || key.escape) {
      runner.stop();
      exit();
    }
    // Refresh on 'r'
    if (input.toLowerCase() === "r") {
      refreshAll();
    }
  });

  // Show error state
  if (connectionStatus === "error") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red" bold>
          Connection Error
        </Text>
        <Text color="red">{connectionError}</Text>
        <Box marginTop={1}>
          <Text color="gray">Press </Text>
          <Text color="cyan" bold>
            q
          </Text>
          <Text color="gray"> to exit</Text>
        </Box>
      </Box>
    );
  }

  // Check for no running providers
  const hasRunningProvider = providers.some((p) => p.running);

  if (
    connectionStatus === "connected" &&
    providers.length > 0 &&
    !hasRunningProvider
  ) {
    return (
      <Box flexDirection="column" padding={1}>
        <Header
          connection={connectionStatus}
          environment={environment}
          activeRequests={activeCount}
        />
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow" bold>
            No providers running
          </Text>
          <Text color="gray">Start one of the following:</Text>
          <Text color="white"> Ollama: ollama serve</Text>
          <Text color="white"> LM Studio: Start the local server</Text>
          <Text color="white"> Stable Diffusion: Start AUTOMATIC1111</Text>
        </Box>
        <StatusBar />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Header
        connection={connectionStatus}
        environment={environment}
        activeRequests={activeCount}
      />

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

      {/* Status bar */}
      <StatusBar />
    </Box>
  );
}
