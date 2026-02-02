import React from "react";
import { Box, Text } from "ink";
import type { ConnectionStatus } from "../types.js";
import { LogoString } from "../../helpers.js";

interface HeaderProps {
  connection: ConnectionStatus;
  environment: "prod" | "local";
  activeRequests: number;
}

export function Header({
  connection,
  environment,
  activeRequests,
}: HeaderProps) {
  const connectionColor =
    connection === "connected"
      ? "green"
      : connection === "connecting"
      ? "yellow"
      : "red";

  const connectionText =
    connection === "connected"
      ? "Connected"
      : connection === "connecting"
      ? "Connecting..."
      : connection === "disconnected"
      ? "Disconnected"
      : "Error";

  const envBadge = environment === "prod" ? "PROD" : "LOCAL";
  const envColor = environment === "prod" ? "green" : "yellow";

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="cyan">{LogoString}</Text>
      </Box>
      <Box marginTop={1} justifyContent="space-between">
        <Box>
          <Text bold color="white">
            MindStudio Local Tunnel
          </Text>
          <Text> </Text>
          <Text color={envColor} bold>
            [{envBadge}]
          </Text>
        </Box>
        <Box>
          <Text color={connectionColor}>● {connectionText}</Text>
          {activeRequests > 0 && (
            <Text color="cyan"> | {activeRequests} active</Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
