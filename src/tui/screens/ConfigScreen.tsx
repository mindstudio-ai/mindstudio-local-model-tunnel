import React, { useEffect } from "react";
import { Box, Text, useApp } from "ink";
import {
  getConfigPath,
  getEnvironment,
  getEnvironmentInfo,
  getOllamaBaseUrl,
  getLMStudioBaseUrl,
  getStableDiffusionBaseUrl,
} from "../../config.js";
import { LogoString } from "../../helpers.js";

export function ConfigScreen() {
  const { exit } = useApp();

  const environment = getEnvironment();
  const info = getEnvironmentInfo();
  const envColor = environment === "prod" ? "green" : "yellow";
  const envBadge = environment === "prod" ? "PROD" : "LOCAL";

  // Auto-exit after render
  useEffect(() => {
    const timer = setTimeout(() => exit(), 50);
    return () => clearTimeout(timer);
  }, [exit]);

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginTop={1} marginBottom={1}>
        <Text bold>MindStudio Local Tunnel </Text>
        <Text color={envColor} bold>
          [{envBadge}]
        </Text>
      </Box>

      {/* Configuration Section */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="blue"
        paddingX={2}
        paddingY={1}
      >
        <Text bold color="blue">
          Configuration
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Box width={16}>
              <Text color="gray">Config file:</Text>
            </Box>
            <Text>{getConfigPath()}</Text>
          </Box>
          <Box>
            <Box width={16}>
              <Text color="gray">Environment:</Text>
            </Box>
            <Text color={envColor}>{info.current}</Text>
          </Box>
          <Box>
            <Box width={16}>
              <Text color="gray">API URL:</Text>
            </Box>
            <Text>{info.apiBaseUrl}</Text>
          </Box>
          <Box>
            <Box width={16}>
              <Text color="gray">API key:</Text>
            </Box>
            <Text color={info.hasApiKey ? "green" : "yellow"}>
              {info.hasApiKey ? "Set" : "Not set"}
            </Text>
          </Box>
        </Box>
      </Box>

      {/* Provider URLs Section */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        paddingX={2}
        paddingY={1}
        marginTop={1}
      >
        <Text bold color="white">
          Provider URLs
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Box width={18}>
              <Text color="gray">Ollama:</Text>
            </Box>
            <Text>{getOllamaBaseUrl()}</Text>
          </Box>
          <Box>
            <Box width={18}>
              <Text color="gray">LM Studio:</Text>
            </Box>
            <Text>{getLMStudioBaseUrl()}</Text>
          </Box>
          <Box>
            <Box width={18}>
              <Text color="gray">Stable Diffusion:</Text>
            </Box>
            <Text>{getStableDiffusionBaseUrl()}</Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
