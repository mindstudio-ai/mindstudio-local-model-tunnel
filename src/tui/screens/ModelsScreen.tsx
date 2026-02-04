import React, { useState, useEffect } from "react";
import { Box, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import {
  discoverAllModels,
  getProviderStatuses,
  type LocalModel,
} from "../../providers/index.js";
import { getRegisteredModels } from "../../api.js";
import { getApiKey } from "../../config.js";
import { LogoString } from "../../helpers.js";

export function ModelsScreen() {
  const { exit } = useApp();
  const [models, setModels] = useState<LocalModel[]>([]);
  const [registeredModels, setRegisteredModels] = useState<Set<string>>(
    new Set()
  );
  const [loading, setLoading] = useState(true);
  const [providersRunning, setProvidersRunning] = useState(0);

  useEffect(() => {
    async function loadModels() {
      // Check provider status
      const statuses = await getProviderStatuses();
      const running = statuses.filter((s) => s.running).length;
      setProvidersRunning(running);

      // Discover models
      const discoveredModels = await discoverAllModels();
      setModels(discoveredModels);

      // Get registered models if authenticated
      const apiKey = getApiKey();
      if (apiKey) {
        try {
          const registered = await getRegisteredModels();
          setRegisteredModels(new Set(registered));
        } catch {
          // Ignore errors
        }
      }

      setLoading(false);
    }

    loadModels();
  }, []);

  // Handle keyboard input
  useInput((input, key) => {
    if (input === "q" || key.escape || key.return) {
      exit();
    }
  });

  const textModels = models.filter((m) => m.capability === "text");
  const imageModels = models.filter((m) => m.capability === "image");
  const videoModels = models.filter((m) => m.capability === "video");

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan">{LogoString}</Text>

      <Box marginTop={1} marginBottom={1}>
        <Text bold color="white">
          Local Models
        </Text>
        {loading && (
          <Text color="cyan">
            {" "}
            <Spinner type="dots" />
          </Text>
        )}
      </Box>

      {!loading && providersRunning === 0 && (
        <Box flexDirection="column">
          <Text color="yellow">No providers are running.</Text>
          <Text color="gray">
            Start a provider to see available models.
          </Text>
        </Box>
      )}

      {!loading && providersRunning > 0 && models.length === 0 && (
        <Box flexDirection="column">
          <Text color="yellow">No models found.</Text>
          <Text color="gray">
            Download models using your provider (e.g., ollama pull llama3.2)
          </Text>
        </Box>
      )}

      {/* Text Models */}
      {textModels.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="green" bold>
            Text Models ({textModels.length})
          </Text>
          <Box flexDirection="column" marginLeft={1}>
            {textModels.map((model) => {
              const isRegistered = registeredModels.has(model.name);
              return (
                <Box key={model.name}>
                  <Text color={isRegistered ? "green" : "yellow"}>
                    {isRegistered ? "●" : "○"}{" "}
                  </Text>
                  <Text>{model.name}</Text>
                  <Text color="gray"> [{model.provider}]</Text>
                  {!isRegistered && (
                    <Text color="gray" dimColor>
                      {" "}
                      (not registered)
                    </Text>
                  )}
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      {/* Image Models */}
      {imageModels.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="magenta" bold>
            Image Models ({imageModels.length})
          </Text>
          <Box flexDirection="column" marginLeft={1}>
            {imageModels.map((model) => {
              const isRegistered = registeredModels.has(model.name);
              return (
                <Box key={model.name}>
                  <Text color={isRegistered ? "magenta" : "yellow"}>
                    {isRegistered ? "●" : "○"}{" "}
                  </Text>
                  <Text>{model.name}</Text>
                  <Text color="gray"> [{model.provider}]</Text>
                  {!isRegistered && (
                    <Text color="gray" dimColor>
                      {" "}
                      (not registered)
                    </Text>
                  )}
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      {/* Video Models */}
      {videoModels.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="blue" bold>
            Video Models ({videoModels.length})
          </Text>
          <Box flexDirection="column" marginLeft={1}>
            {videoModels.map((model) => {
              const isRegistered = registeredModels.has(model.name);
              return (
                <Box key={model.name}>
                  <Text color={isRegistered ? "blue" : "yellow"}>
                    {isRegistered ? "●" : "○"}{" "}
                  </Text>
                  <Text>{model.name}</Text>
                  <Text color="gray"> [{model.provider}]</Text>
                  {!isRegistered && (
                    <Text color="gray" dimColor>
                      {" "}
                      (not registered)
                    </Text>
                  )}
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      {/* Summary */}
      {!loading && models.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text color="gray">
            ● = registered with MindStudio, ○ = not registered
          </Text>
        </Box>
      )}

      {/* Help */}
      <Box marginTop={1}>
        <Text color="gray">Press Enter to return to main menu</Text>
      </Box>
    </Box>
  );
}
