import React, { useState, useEffect } from "react";
import { Box, Text, useApp } from "ink";
import Spinner from "ink-spinner";
import { verifyApiKey } from "../../api.js";
import { getApiKey, getEnvironment, getEnvironmentInfo } from "../../config.js";
import {
  getProviderStatuses,
  discoverAllModels,
  type LocalModel,
} from "../../providers/index.js";
import type { ProviderStatus } from "../types.js";
import { LogoString } from "../../helpers.js";

type ConnectionStatus = "checking" | "connected" | "invalid" | "not_set";

export function StatusScreen() {
  const { exit } = useApp();
  const [connection, setConnection] = useState<ConnectionStatus>("checking");
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [models, setModels] = useState<LocalModel[]>([]);
  const [loading, setLoading] = useState(true);

  const environment = getEnvironment();
  const info = getEnvironmentInfo();

  useEffect(() => {
    async function loadStatus() {
      // Check API key
      const apiKey = getApiKey();
      if (!apiKey) {
        setConnection("not_set");
      } else {
        const isValid = await verifyApiKey();
        setConnection(isValid ? "connected" : "invalid");
      }

      // Check providers
      const statuses = await getProviderStatuses();
      setProviders(statuses);

      // Discover models
      const discoveredModels = await discoverAllModels();
      setModels(discoveredModels);

      setLoading(false);
    }

    loadStatus();
  }, []);

  // Auto-exit after loading completes
  useEffect(() => {
    if (!loading) {
      const timer = setTimeout(() => exit(), 50);
      return () => clearTimeout(timer);
    }
  }, [loading, exit]);

  const envColor = environment === "prod" ? "green" : "yellow";
  const envBadge = environment === "prod" ? "PROD" : "LOCAL";

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Text color="cyan">{LogoString}</Text>
      <Box marginTop={1} marginBottom={1}>
        <Text bold>MindStudio Local Tunnel </Text>
        <Text color={envColor} bold>
          [{envBadge}]
        </Text>
      </Box>
      <Text color="gray">API: {info.apiBaseUrl}</Text>

      {/* Connection Status */}
      <Box marginTop={1} flexDirection="column">
        <Text bold color="white">
          Connection
        </Text>
        <Box marginTop={1}>
          {connection === "checking" ? (
            <Text color="cyan">
              <Spinner type="dots" /> Checking...
            </Text>
          ) : connection === "connected" ? (
            <Text color="green">● MindStudio: Connected</Text>
          ) : connection === "invalid" ? (
            <Text color="red">● MindStudio: Invalid API key</Text>
          ) : (
            <Text color="yellow">○ MindStudio: Not authenticated</Text>
          )}
        </Box>
      </Box>

      {/* Providers */}
      <Box marginTop={1} flexDirection="column">
        <Text bold color="white">
          Providers
        </Text>
        {loading ? (
          <Text color="cyan">
            <Spinner type="dots" /> Loading...
          </Text>
        ) : (
          <Box flexDirection="column" marginTop={1}>
            {providers.map(({ provider, running }) => (
              <Box key={provider.name}>
                <Text color={running ? "green" : "gray"}>
                  {running ? "●" : "○"} {provider.displayName}:{" "}
                </Text>
                <Text color={running ? "green" : "gray"}>
                  {running ? "Running" : "Not running"}
                </Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {/* Models */}
      {models.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold color="white">
            Models
          </Text>
          <Box flexDirection="column" marginTop={1}>
            {/* Text models */}
            {models.filter((m) => m.capability === "text").length > 0 && (
              <Box flexDirection="column">
                <Text color="green">Text Models</Text>
                {models
                  .filter((m) => m.capability === "text")
                  .map((model) => (
                    <Box key={model.name}>
                      <Text color="green"> ● </Text>
                      <Text>{model.name} </Text>
                      <Text color="gray">[{model.provider}]</Text>
                    </Box>
                  ))}
              </Box>
            )}
            {/* Image models */}
            {models.filter((m) => m.capability === "image").length > 0 && (
              <Box flexDirection="column" marginTop={1}>
                <Text color="magenta">Image Models</Text>
                {models
                  .filter((m) => m.capability === "image")
                  .map((model) => (
                    <Box key={model.name}>
                      <Text color="magenta"> ● </Text>
                      <Text>{model.name} </Text>
                      <Text color="gray">[{model.provider}]</Text>
                    </Box>
                  ))}
              </Box>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}
