import React, { useState, useEffect } from "react";
import { Box, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import { getApiKey } from "../../config.js";
import {
  isAnyProviderRunning,
  getProviderStatuses,
} from "../../providers/index.js";
import { LogoString } from "../../helpers.js";
import { ProviderStatus } from "../types.js";

interface MenuItem {
  id: string;
  label: string;
  description: string;
  action: () => void;
  disabled?: boolean;
  disabledReason?: string;
}

interface SystemStatus {
  authenticated: boolean;
  providersRunning: boolean;
  providerCount: number;
}

export function HomeScreen() {
  const { exit } = useApp();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [navigateTo, setNavigateTo] = useState<string | null>(null);
  const [runningProviders, setRunningProviders] = useState<ProviderStatus[]>(
    []
  );

  // Check system status on mount
  useEffect(() => {
    async function checkStatus() {
      const apiKey = getApiKey();
      const providerStatuses = await getProviderStatuses();
      const runningProviders = providerStatuses.filter((p) => p.running);

      setStatus({
        authenticated: !!apiKey,
        providersRunning: runningProviders.length > 0,
        providerCount: runningProviders.length,
      });
      setRunningProviders(runningProviders);
    }
    checkStatus();
  }, []);

  // Build menu items based on status
  const menuItems: MenuItem[] = [];

  // Start tunnel - main action
  menuItems.push({
    id: "start",
    label: "Start Tunnel",
    description: "Launch the MindStudio local model tunnel",
    action: () => setNavigateTo("start"),
    disabled: !status?.authenticated || !status?.providersRunning,
    disabledReason: !status?.authenticated
      ? "Authenticate first"
      : !status?.providersRunning
      ? "No providers running"
      : undefined,
  });

  // Setup wizard
  menuItems.push({
    id: "setup",
    label: "Setup Providers",
    description: "Install and configure local AI providers",
    action: () => setNavigateTo("setup"),
  });

  // Auth
  menuItems.push({
    id: "auth",
    label: status?.authenticated ? "Re-authenticate" : "Authenticate",
    description: status?.authenticated
      ? "Already authenticated - re-authenticate if needed"
      : "Log in to MindStudio",
    action: () => setNavigateTo("auth"),
  });

  // Register models
  menuItems.push({
    id: "register",
    label: "Register Models",
    description: "Register your local models with MindStudio",
    action: () => setNavigateTo("register"),
    disabled: !status?.authenticated,
    disabledReason: "Authenticate first",
  });

  // Models
  menuItems.push({
    id: "models",
    label: "View Models",
    description: "View available local models",
    action: () => setNavigateTo("models"),
  });

  // Config
  menuItems.push({
    id: "config",
    label: "Configuration",
    description: "View current configuration",
    action: () => setNavigateTo("config"),
  });

  // Logout (only show if authenticated)
  if (status?.authenticated) {
    menuItems.push({
      id: "logout",
      label: "Logout",
      description: "Clear all stored credentials and data",
      action: () => setNavigateTo("logout"),
    });
  }

  // Exit
  menuItems.push({
    id: "exit",
    label: "Exit",
    description: "",
    action: () => exit(),
  });

  // Filter to only enabled items for navigation
  const enabledItems = menuItems.filter((item) => !item.disabled);

  useInput((input, key) => {
    if (navigateTo) return; // Don't handle input while navigating

    if (key.upArrow) {
      setSelectedIndex((prev) => {
        let newIndex = prev - 1;
        while (newIndex >= 0 && menuItems[newIndex]?.disabled) {
          newIndex--;
        }
        return newIndex >= 0 ? newIndex : prev;
      });
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => {
        let newIndex = prev + 1;
        while (newIndex < menuItems.length && menuItems[newIndex]?.disabled) {
          newIndex++;
        }
        return newIndex < menuItems.length ? newIndex : prev;
      });
    }
    if (key.return) {
      const item = menuItems[selectedIndex];
      if (item && !item.disabled) {
        item.action();
      }
    }
    if (input === "q" || key.escape) {
      exit();
    }
  });

  // Handle navigation by exiting with a code that cli.ts will interpret
  useEffect(() => {
    if (navigateTo) {
      // We'll use process.env to communicate the next command
      process.env.MINDSTUDIO_NEXT_COMMAND = navigateTo;
      exit();
    }
  }, [navigateTo, exit]);

  // Loading state
  if (!status) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan">{LogoString}</Text>
        <Box marginTop={1}>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text> Checking system status...</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan">{LogoString}</Text>

      <Box marginTop={1} marginBottom={1}>
        <Text bold color="white">
          MindStudio Local Model Tunnel
        </Text>
      </Box>

      {/* Status indicators */}
      <Box marginBottom={1} flexDirection="column">
        <Box>
          <Text color={status.authenticated ? "green" : "yellow"}>
            {status.authenticated ? "●" : "○"}
          </Text>
          <Text color="gray">
            {" "}
            Authentication:{" "}
            {status.authenticated ? "Connected" : "Not authenticated"}
          </Text>
        </Box>
        <Box>
          <Text color={status.providersRunning ? "green" : "yellow"}>
            {status.providersRunning ? "●" : "○"}
          </Text>
          <Text color="gray">
            {" "}
            Providers:{" "}
            {status.providersRunning
              ? `${runningProviders
                  .map((p) => p.provider.displayName)
                  .join(", ")} running`
              : "None running"}
          </Text>
        </Box>
      </Box>

      {/* Menu */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
      >
        {menuItems.map((item, index) => {
          const isSelected = index === selectedIndex;
          const isDisabled = item.disabled;

          return (
            <Box key={item.id}>
              <Text
                color={isDisabled ? "gray" : isSelected ? "cyan" : "white"}
                dimColor={isDisabled}
              >
                {isSelected ? "❯ " : "  "}
                {item.label}
                {isDisabled && item.disabledReason
                  ? ` (${item.disabledReason})`
                  : ""}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Description for selected item */}
      <Box marginTop={1}>
        <Text color="gray">{menuItems[selectedIndex]?.description}</Text>
      </Box>

      {/* Help */}
      <Box marginTop={1}>
        <Text color="gray">↑↓ Navigate • Enter Select • q Quit</Text>
      </Box>
    </Box>
  );
}
