import React, { useState, useEffect } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import * as path from "path";
import * as os from "os";
import { detectAllProviders, type ProviderInfo } from "./detect.js";
import {
  installOllama,
  installLMStudio,
  installStableDiffusion,
  pullOllamaModel,
  startOllama,
  hasDefaultSdModel,
  getPythonVersion,
  isPythonVersionOk,
  type InstallProgress,
} from "./installers.js";
import { LogoString } from "../helpers.js";

type Screen =
  | "detecting"
  | "menu"
  | "path-input"
  | "model-download"
  | "installing"
  | "done";

interface MenuItem {
  id: string;
  label: string;
  action: () => Promise<void>;
  disabled?: boolean;
}

export interface QuickstartProps {
  onExternalAction?: (action: string) => void;
}

export function QuickstartScreen({ onExternalAction }: QuickstartProps = {}) {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>("detecting");
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [installProgress, setInstallProgress] =
    useState<InstallProgress | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  // Track what action was completed for context-specific done screen
  const [completedAction, setCompletedAction] = useState<string | null>(null);

  // Path input state for Stable Diffusion
  const defaultSdPath = path.join(os.homedir(), "sd-webui-forge-neo");
  const [sdInstallPath, setSdInstallPath] = useState(defaultSdPath);

  // Model download state for Ollama
  const [modelName, setModelName] = useState("");

  // Track if default SD model already exists
  const [sdModelExists, setSdModelExists] = useState(false);

  // Refresh provider detection and model status
  const refreshProviders = async () => {
    const detected = await detectAllProviders();
    setProviders(detected);
    const modelExists = await hasDefaultSdModel();
    setSdModelExists(modelExists);
  };

  // Navigate to a screen with a clean slate
  const navigateTo = (target: Screen) => {
    // Clear screen + scrollback buffer + reset cursor position
    process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
    setInstallProgress(null);
    setLogs([]);
    setScreen(target);
  };

  // Detect providers on mount
  useEffect(() => {
    async function detect() {
      await refreshProviders();
      setScreen("menu");
    }
    detect();
  }, []);

  // Build menu items based on detected providers
  const menuItems: MenuItem[] = [];

  const ollama = providers.find((p) => p.id === "ollama");
  const lmstudio = providers.find((p) => p.id === "lmstudio");
  const sd = providers.find((p) => p.id === "stable-diffusion");

  if (ollama) {
    if (!ollama.installed) {
      menuItems.push({
        id: "install-ollama",
        label: ollama.installable
          ? "Install Ollama (automatic)"
          : "Download Ollama (opens browser)",
        action: async () => {
          navigateTo("installing");
          await installOllama((progress) => {
            setInstallProgress(progress);
            if (progress.message) {
              setLogs((prev) => [...prev.slice(-10), progress.message]);
            }
          });
          // After install, pull a default model
          setInstallProgress({ stage: "pull", message: "Pulling llama3.2..." });
          await pullOllamaModel("llama3.2", (progress) => {
            setInstallProgress(progress);
            if (progress.message) {
              setLogs((prev) => [...prev.slice(-10), progress.message]);
            }
          });
          setCompletedAction("install-ollama");
          navigateTo("done");
        },
      });
    } else if (!ollama.running) {
      menuItems.push({
        id: "start-ollama",
        label: "Start Ollama server",
        action: async () => {
          navigateTo("installing");
          await startOllama((progress) => {
            setInstallProgress(progress);
          });
          setCompletedAction("start-ollama");
          navigateTo("done");
        },
      });
    } else {
      // Ollama is installed and running - offer to download models and stop
      menuItems.push({
        id: "download-model",
        label: "Download Ollama Models",
        action: async () => {
          setModelName("");
          navigateTo("model-download");
        },
      });
      menuItems.push({
        id: "stop-ollama",
        label: "Stop Ollama server",
        action: async () => {
          if (onExternalAction) {
            onExternalAction("stop-ollama");
          }
          exit();
        },
      });
    }
  }

  if (lmstudio && !lmstudio.installed) {
    menuItems.push({
      id: "install-lmstudio",
      label: "Download LM Studio (opens browser)",
      action: async () => {
        navigateTo("installing");
        await installLMStudio((progress) => {
          setInstallProgress(progress);
        });
        setCompletedAction("install-lmstudio");
        navigateTo("done");
      },
    });
  }

  if (sd) {
    // Show Python version warning/helper if needed
    if (sd.warning) {
      menuItems.push({
        id: "fix-python",
        label: "Install Python 3.13 (required for Forge Neo)",
        action: async () => {
          if (onExternalAction) {
            onExternalAction("fix-python");
          }
          exit();
        },
      });
    }

    if (!sd.installed) {
      menuItems.push({
        id: "install-sd",
        label: sd.installable
          ? "Install Stable Diffusion Forge Neo"
          : "Stable Diffusion (requires git & python)",
        disabled: !sd.installable,
        action: async () => {
          // Show path input screen first
          navigateTo("path-input");
        },
      });
    } else if (!sd.running) {
      // SD is installed but not running - offer to start it
      menuItems.push({
        id: "start-sd",
        label: "Start Stable Diffusion server",
        action: async () => {
          // Pre-flight: check Python version via Ink UI before taking over terminal
          const pyInfo = await getPythonVersion();
          if (!pyInfo) {
            setInstallProgress({
              stage: "error",
              message: "Python not found",
              error:
                "Python is not installed. Forge Neo requires Python 3.13+.\nInstall from https://www.python.org/downloads/",
            });
            setCompletedAction("start-sd");
            navigateTo("done");
            return;
          }
          if (!isPythonVersionOk(pyInfo)) {
            setInstallProgress({
              stage: "error",
              message: `Python ${pyInfo.version} is too old`,
              error: `Forge Neo requires Python 3.13+. You have ${pyInfo.version}.\nUse "Install Python 3.13" from the setup menu for instructions.`,
            });
            setCompletedAction("start-sd");
            navigateTo("done");
            return;
          }

          // Exit Ink completely and signal the outer loop to handle SD launch
          if (onExternalAction) {
            onExternalAction("start-sd");
          }
          exit();
        },
      });
    } else {
      // SD is installed and running - offer to stop it
      menuItems.push({
        id: "stop-sd",
        label: "Stop Stable Diffusion server",
        action: async () => {
          if (onExternalAction) {
            onExternalAction("stop-sd");
          }
          exit();
        },
      });
    }

    // SD is installed and model not yet downloaded - offer to download
    if (sd.installed && !sdModelExists) {
      menuItems.push({
        id: "download-sd-model",
        label: "Download default SDXL model (~6.5 GB)",
        action: async () => {
          if (onExternalAction) {
            onExternalAction("download-sd-model");
          }
          exit();
        },
      });
    }
  }

  // Function to start SD installation with the chosen path
  const startSdInstallation = async () => {
    navigateTo("installing");
    await installStableDiffusion((progress) => {
      setInstallProgress(progress);
      if (progress.message) {
        setLogs((prev) => [...prev.slice(-10), progress.message]);
      }
    }, sdInstallPath);
    setCompletedAction("install-sd");
    navigateTo("done");
  };

  // Function to download an Ollama model
  const startModelDownload = async () => {
    if (!modelName.trim()) return;
    navigateTo("installing");
    await pullOllamaModel(modelName.trim(), (progress) => {
      setInstallProgress(progress);
      if (progress.message) {
        setLogs((prev) => [...prev.slice(-10), progress.message]);
      }
    });
    setCompletedAction("download-model");
    navigateTo("done");
  };

  // Always add exit option
  menuItems.push({
    id: "exit",
    label: "Exit",
    action: async () => {
      exit();
    },
  });

  // Keyboard navigation
  useInput((input, key) => {
    if (screen === "menu") {
      if (key.upArrow) {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      }
      if (key.downArrow) {
        setSelectedIndex((prev) => Math.min(menuItems.length - 1, prev + 1));
      }
      if (key.return) {
        const item = menuItems[selectedIndex];
        if (item && !item.disabled) {
          item.action();
        }
      }
    }
    // Allow escape to go back from path input
    if (screen === "path-input" && key.escape) {
      navigateTo("menu");
      return;
    }
    // Allow escape to go back from model download
    if (screen === "model-download" && key.escape) {
      navigateTo("menu");
      return;
    }
    // Allow Enter to exit from done screen (return to main menu)
    if (screen === "done" && key.return) {
      exit();
      return;
    }
    // Global quit (but not during input screens or done screen)
    if (
      screen !== "path-input" &&
      screen !== "model-download" &&
      screen !== "done" &&
      (input === "q" || key.escape)
    ) {
      exit();
    }
  });

  // Detecting screen
  if (screen === "detecting") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan">{LogoString}</Text>
        <Box marginTop={1}>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text> Detecting installed providers...</Text>
        </Box>
      </Box>
    );
  }

  // Path input screen for Stable Diffusion
  if (screen === "path-input") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan">{LogoString}</Text>
        <Box marginTop={1}>
          <Text bold color="white">
            Install Stable Diffusion Forge Neo
          </Text>
        </Box>

        <Box
          marginTop={1}
          flexDirection="column"
          borderStyle="round"
          borderColor="cyan"
          paddingX={1}
          paddingY={1}
        >
          <Text>Installation path:</Text>
          <Box marginTop={1}>
            <Text color="cyan">&gt; </Text>
            <TextInput
              value={sdInstallPath}
              onChange={setSdInstallPath}
              onSubmit={() => {
                startSdInstallation();
              }}
            />
          </Box>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text color="gray">Enter: Confirm and install</Text>
          <Text color="gray">Esc: Go back</Text>
        </Box>
      </Box>
    );
  }

  // Model download screen for Ollama
  if (screen === "model-download") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan">{LogoString}</Text>
        <Box marginTop={1}>
          <Text bold color="white">
            Download Ollama Model
          </Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text>Browse available models at:</Text>
          <Text color="cyan" bold>
            https://ollama.com/library
          </Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text color="gray">Popular models:</Text>
          <Text color="gray"> llama3.2, mistral, codellama, phi3, gemma2</Text>
        </Box>

        <Box
          marginTop={1}
          flexDirection="column"
          borderStyle="round"
          borderColor="cyan"
          paddingX={1}
          paddingY={1}
        >
          <Text>Enter model name:</Text>
          <Box marginTop={1}>
            <Text color="cyan">&gt; </Text>
            <TextInput
              value={modelName}
              onChange={setModelName}
              placeholder="e.g. llama3.2"
              onSubmit={() => {
                if (modelName.trim()) {
                  startModelDownload();
                }
              }}
            />
          </Box>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text color="gray">Enter: Download model</Text>
          <Text color="gray">Esc: Go back</Text>
        </Box>
      </Box>
    );
  }

  // Installing screen
  if (screen === "installing") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan">{LogoString}</Text>
        <Box marginTop={1}>
          <Text bold color="white">
            Loading...
          </Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          {installProgress && (
            <Box>
              {!installProgress.complete && !installProgress.error && (
                <Text color="cyan">
                  <Spinner type="dots" />{" "}
                </Text>
              )}
              {installProgress.complete && <Text color="green">✓ </Text>}
              {installProgress.error && <Text color="red">✗ </Text>}
              <Text>{installProgress.message}</Text>
            </Box>
          )}
          {installProgress?.error && (
            <Text color="red">Error: {installProgress.error}</Text>
          )}
        </Box>
        {logs.length > 0 && (
          <Box
            marginTop={1}
            flexDirection="column"
            borderStyle="round"
            borderColor="gray"
            paddingX={1}
          >
            {logs.slice(-5).map((log, i) => (
              <Text key={i} color="gray">
                {log}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    );
  }

  // Done screen - context-aware based on completed action
  if (screen === "done") {
    const getDoneMessage = () => {
      switch (completedAction) {
        case "start-ollama":
          return {
            title: "Ollama is now running!",
            description:
              "Ollama server is running in the background on port 11434.",
            nextSteps: [
              "Return to main menu to authenticate or start the tunnel.",
            ],
            note: "Ollama will keep running until you restart your computer or stop it manually.",
          };
        case "stop-ollama":
          return {
            title: "Ollama server stopped!",
            description: "The Ollama server has been shut down.",
            nextSteps: [],
            note: null,
          };
        case "download-model":
          return {
            title: "Model downloaded!",
            description: `The model "${modelName}" has been pulled successfully.`,
            nextSteps: [
              "Return to main menu to register models and start the tunnel.",
            ],
            note: null,
          };
        case "install-ollama":
          return {
            title: "Ollama installed successfully!",
            description:
              "Ollama has been installed and the llama3.2 model has been pulled.",
            nextSteps: [
              "Return to main menu to authenticate and start the tunnel.",
            ],
            note: null,
          };
        case "install-lmstudio":
          return {
            title: "LM Studio download started!",
            description: "The download page has been opened in your browser.",
            nextSteps: [
              "Complete the installation from the downloaded file.",
              "Launch LM Studio and download a model.",
              "Start the local server in LM Studio.",
              "Return to main menu to start the tunnel.",
            ],
            note: null,
          };
        case "install-sd":
          return {
            title: "Stable Diffusion Forge Neo cloned!",
            description: `Repository cloned to: ${sdInstallPath}`,
            nextSteps: [
              'Use "Download default SDXL model" from the setup menu to get a model automatically.',
              'Or download from https://civitai.com/models (filter by "SDXL 1.0").',
              "Then start the server from the setup menu.",
            ],
            note: null,
          };
        case "start-sd":
          // If there was a pre-flight error (Python version), show it
          if (installProgress?.error) {
            return {
              title: installProgress.message,
              description: installProgress.error,
              nextSteps: [
                'Use "Install Python 3.13" from the setup menu for instructions.',
                `If you recently updated Python, delete the old venv: rm -rf ${sdInstallPath}/venv`,
              ],
              note: null,
            };
          }
          return {
            title: "Stable Diffusion server stopped.",
            description: "The server has been shut down.",
            nextSteps: [
              "Return to main menu to start it again or start the tunnel.",
            ],
            note: null,
          };
        case "stop-sd":
          return {
            title: "Stable Diffusion server stopped!",
            description: "The server has been shut down.",
            nextSteps: ["Return to main menu to start it again if needed."],
            note: null,
          };
        default:
          return {
            title: "Setup complete!",
            description: null,
            nextSteps: [
              "Return to main menu to authenticate and start the tunnel.",
            ],
            note: null,
          };
      }
    };

    const msg = getDoneMessage();

    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan">{LogoString}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text color="green" bold>
            {msg.title}
          </Text>
          {msg.description && (
            <Box marginTop={1}>
              <Text color="white">{msg.description}</Text>
            </Box>
          )}
          <Box marginTop={1} flexDirection="column">
            <Text color="white" bold>
              Next steps:
            </Text>
            {msg.nextSteps.map((step, i) => (
              <Text key={i} color="gray">
                {" "}
                {i + 1}. {step}
              </Text>
            ))}
          </Box>
          {msg.note && (
            <Box marginTop={1}>
              <Text color="yellow">Note: {msg.note}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text color="cyan">Press Enter to return to main menu</Text>
          </Box>
        </Box>
      </Box>
    );
  }

  // Menu screen
  const allInstalled = providers.every((p) => p.installed);
  const allRunning = providers
    .filter((p) => p.installed)
    .every((p) => p.running);

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan">{LogoString}</Text>
      <Box marginTop={1}>
        <Text bold color="white">
          Quickstart Setup
        </Text>
      </Box>

      {/* Provider Status */}
      <Box
        marginTop={1}
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
      >
        <Text bold>Provider Status</Text>
        <Box marginTop={1} flexDirection="column">
          {providers.map((provider) => (
            <Box key={provider.id} flexDirection="column">
              <Box>
                <Text
                  color={
                    provider.installed
                      ? provider.running
                        ? "green"
                        : "yellow"
                      : "red"
                  }
                >
                  {provider.installed ? (provider.running ? "●" : "○") : "✗"}
                </Text>
                <Text> {provider.name} - </Text>
                <Text color="gray">
                  {provider.running
                    ? "Running"
                    : provider.installed
                    ? "Installed (not running)"
                    : "Not installed"}
                </Text>
              </Box>
              {provider.warning && (
                <Box>
                  <Text color="yellow">  ⚠ {provider.warning}</Text>
                </Box>
              )}
            </Box>
          ))}
        </Box>
      </Box>

      {/* All good message */}
      {allInstalled && allRunning && (
        <Box marginTop={1}>
          <Text color="green">✓ All providers are installed and running!</Text>
        </Box>
      )}

      {/* Menu */}
      {menuItems.length > 1 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Actions</Text>
          <Box marginTop={1} flexDirection="column">
            {menuItems.map((item, index) => (
              <Box key={item.id}>
                <Text color={index === selectedIndex ? "cyan" : "white"}>
                  {index === selectedIndex ? "❯ " : "  "}
                </Text>
                <Text
                  color={
                    item.disabled
                      ? "gray"
                      : index === selectedIndex
                      ? "cyan"
                      : "white"
                  }
                  dimColor={item.disabled}
                >
                  {item.label}
                </Text>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color="gray">↑↓ Navigate • Enter Select • q Quit</Text>
      </Box>
    </Box>
  );
}
