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
  installComfyUI,
  installComfyUICustomNodes,
  pullOllamaModel,
  startOllama,
  hasDefaultSdModel,
  hasComfyUIModel,
  getComfyUIModelStatus,
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
  | "model-guide"
  | "installing"
  | "done";

type MenuCategory = "text" | "image" | "video" | "general";

interface MenuItem {
  id: string;
  label: string;
  action: () => Promise<void>;
  disabled?: boolean;
  category: MenuCategory;
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

  // ComfyUI state
  const defaultComfyPath = path.join(os.homedir(), "ComfyUI");
  const [comfyInstallPath, setComfyInstallPath] = useState(defaultComfyPath);
  const [comfyModelStatus, setComfyModelStatus] = useState<
    Array<{ id: string; label: string; installed: boolean; totalSize: string }>
  >([]);

  // Refresh provider detection and model status
  const refreshProviders = async () => {
    const detected = await detectAllProviders();
    setProviders(detected);
    const modelExists = await hasDefaultSdModel();
    setSdModelExists(modelExists);
    setComfyModelStatus(getComfyUIModelStatus());
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

  // --- Text providers (Ollama, LM Studio) ---
  if (ollama) {
    if (!ollama.installed) {
      menuItems.push({
        id: "install-ollama",
        category: "text",
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
        category: "text",
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
        category: "text",
        label: "Download Ollama Models",
        action: async () => {
          setModelName("");
          navigateTo("model-download");
        },
      });
      menuItems.push({
        id: "stop-ollama",
        category: "text",
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
      category: "text",
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

  // --- Image providers (Stable Diffusion) ---
  if (sd) {
    if (sd.warning) {
      menuItems.push({
        id: "fix-python",
        category: "image",
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
        category: "image",
        label: sd.installable
          ? "Install Stable Diffusion Forge Neo"
          : "Stable Diffusion (requires git & python)",
        disabled: !sd.installable,
        action: async () => {
          navigateTo("path-input");
        },
      });
    } else if (!sd.running) {
      menuItems.push({
        id: "start-sd",
        category: "image",
        label: "Start Stable Diffusion server",
        action: async () => {
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

          if (onExternalAction) {
            onExternalAction("start-sd");
          }
          exit();
        },
      });
    } else {
      menuItems.push({
        id: "stop-sd",
        category: "image",
        label: "Stop Stable Diffusion server",
        action: async () => {
          if (onExternalAction) {
            onExternalAction("stop-sd");
          }
          exit();
        },
      });
    }

    if (sd.installed && !sdModelExists) {
      menuItems.push({
        id: "download-sd-model",
        category: "image",
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

  // --- Video providers (ComfyUI) ---
  const comfyui = providers.find((p) => p.id === "comfyui");
  if (comfyui) {
    if (!comfyui.installed) {
      menuItems.push({
        id: "install-comfyui",
        category: "video",
        label: comfyui.installable
          ? "Install ComfyUI"
          : "ComfyUI (requires git & python)",
        disabled: !comfyui.installable,
        action: async () => {
          navigateTo("installing");
          setInstallProgress({
            stage: "start",
            message: "Installing ComfyUI...",
          });

          const success = await installComfyUI(comfyInstallPath, (progress) => {
            setInstallProgress(progress);
            if (progress.message) {
              setLogs((prev) => [...prev.slice(-10), progress.message]);
            }
          });

          if (success) {
            setInstallProgress({
              stage: "start",
              message: "Installing LTX-Video custom nodes...",
            });
            await installComfyUICustomNodes((progress) => {
              setInstallProgress(progress);
              if (progress.message) {
                setLogs((prev) => [...prev.slice(-10), progress.message]);
              }
            });
          }

          setCompletedAction("install-comfyui");
          navigateTo("done");
        },
      });
    } else if (!comfyui.running) {
      menuItems.push({
        id: "start-comfyui",
        category: "video",
        label: "Start ComfyUI server",
        action: async () => {
          if (onExternalAction) {
            onExternalAction("start-comfyui");
          }
          exit();
        },
      });
    } else {
      for (const model of comfyModelStatus) {
        if (!model.installed) {
          menuItems.push({
            id: `download-comfyui-${model.id}`,
            category: "video",
            label: `Download ${model.label} (${model.totalSize})`,
            action: async () => {
              if (onExternalAction) {
                onExternalAction(`download-comfyui-model:${model.id}`);
              }
              exit();
            },
          });
        }
      }

      menuItems.push({
        id: "stop-comfyui",
        category: "video",
        label: "Stop ComfyUI server",
        action: async () => {
          if (onExternalAction) {
            onExternalAction("stop-comfyui");
          }
          exit();
        },
      });
    }
  }

  // --- General ---
  menuItems.push({
    id: "model-guide",
    category: "general",
    label: "How to Add Your Own Models",
    action: async () => {
      navigateTo("model-guide");
    },
  });

  menuItems.push({
    id: "exit",
    category: "general",
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
    // Allow escape or Enter to go back from model guide
    if (screen === "model-guide" && (key.escape || key.return)) {
      navigateTo("menu");
      return;
    }
    // Allow Enter to exit from done screen (return to main menu)
    if (screen === "done" && key.return) {
      exit();
      return;
    }
    // Global quit (but not during input screens, done screen, or guide)
    if (
      screen !== "path-input" &&
      screen !== "model-download" &&
      screen !== "model-guide" &&
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

  // Model guide screen
  if (screen === "model-guide") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan">{LogoString}</Text>
        <Box marginTop={1}>
          <Text bold color="white">
            How to Add Your Own Models
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
          <Text bold>Text Models (Ollama)</Text>
          <Box marginTop={1} flexDirection="column">
            <Text color="gray">
              Browse models at{" "}
              <Text color="cyan">https://ollama.com/library</Text>
            </Text>
            <Text color="gray">Download via the setup menu or run:</Text>
            <Text color="white"> ollama pull {"<model-name>"}</Text>
          </Box>
        </Box>

        <Box
          marginTop={1}
          flexDirection="column"
          borderStyle="round"
          borderColor="cyan"
          paddingX={1}
          paddingY={1}
        >
          <Text bold>Image Models (Stable Diffusion)</Text>
          <Box marginTop={1} flexDirection="column">
            <Text color="gray">
              Download <Text color="white">.safetensors</Text> files from{" "}
              <Text color="cyan">https://civitai.com</Text>
            </Text>
            <Text color="gray">
              Filter by <Text color="white">SDXL 1.0</Text> for best
              compatibility.
            </Text>
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text color="gray">Place them in:</Text>
            <Text color="white"> {sdInstallPath}/models/Stable-diffusion/</Text>
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text color="gray">
              Restart the SD server to pick up new models.
            </Text>
          </Box>
        </Box>

        <Box
          marginTop={1}
          flexDirection="column"
          borderStyle="round"
          borderColor="cyan"
          paddingX={1}
          paddingY={1}
        >
          <Text bold>Video Models (ComfyUI)</Text>
          <Box marginTop={1} flexDirection="column">
            <Text color="gray">
              Download models from{" "}
              <Text color="cyan">https://huggingface.co</Text>{" "}
              and place in the folders below.
            </Text>
            <Text color="gray">
              Models marked with * can be auto-downloaded from the setup menu.
            </Text>
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Text bold color="white">LTX-Video</Text>
            <Text color="gray">  * ltx-video-2b-v0.9.5.safetensors  <Text color="white">checkpoints/</Text>  <Text color="gray">(~6 GB)</Text></Text>
            <Text color="gray">  * t5xxl_fp16.safetensors             <Text color="white">text_encoders/</Text> <Text color="gray">(~10 GB)</Text></Text>
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Text bold color="white">Wan 2.1 Text-to-Video</Text>
            <Text color="gray">  * wan2.1_t2v_1.3B_fp16.safetensors  <Text color="white">diffusion_models/</Text> <Text color="gray">(~2.6 GB)</Text></Text>
            <Text color="gray">    wan2.1_t2v_14B_fp16.safetensors   <Text color="white">diffusion_models/</Text> <Text color="gray">(~28 GB)</Text></Text>
            <Text color="gray">  * umt5_xxl_fp8_e4m3fn_scaled        <Text color="white">text_encoders/</Text>    <Text color="gray">(~5 GB, shared)</Text></Text>
            <Text color="gray">  * wan_2.1_vae.safetensors            <Text color="white">vae/</Text>              <Text color="gray">(~0.3 GB, shared)</Text></Text>
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Text color="gray">
              All folders are relative to: <Text color="white">{comfyInstallPath}/models/</Text>
            </Text>
            <Text color="gray">
              The 14B model uses the same text encoder and VAE as the 1.3B.
            </Text>
            <Text color="gray">
              Restart the ComfyUI server to pick up new models.
            </Text>
          </Box>
        </Box>

        <Box marginTop={1}>
          <Text color="gray">Press Esc or Enter to go back</Text>
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
            note: `To add your own models, download .safetensors files from https://civitai.com and place them in:\n  ${sdInstallPath}/models/Stable-diffusion/`,
          };
        case "install-comfyui":
          return {
            title: "ComfyUI installed!",
            description: `Installed to: ${comfyInstallPath}`,
            nextSteps: [
              "Start the ComfyUI server from the setup menu.",
              "Download a video model (LTX-Video or Wan 2.1) once the server is running.",
              "Then start the tunnel to connect to MindStudio.",
            ],
            note: [
              "LTX-Video custom nodes have been installed for best compatibility.",
              "",
              "To add your own video models, download .safetensors files from https://huggingface.co and place them in:",
              `  Checkpoints:       ${comfyInstallPath}/models/checkpoints/`,
              `  Diffusion models:  ${comfyInstallPath}/models/diffusion_models/`,
              `  Text encoders:     ${comfyInstallPath}/models/text_encoders/`,
              `  VAE:               ${comfyInstallPath}/models/vae/`,
            ].join("\n"),
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
        {[
          { label: "Text", ids: ["ollama", "lmstudio"] },
          { label: "Image", ids: ["stable-diffusion"] },
          { label: "Video", ids: ["comfyui"] },
        ].map((group) => {
          const groupProviders = providers.filter((p) =>
            group.ids.includes(p.id)
          );
          if (groupProviders.length === 0) return null;
          return (
            <Box key={group.label} marginTop={1} flexDirection="column">
              <Text color="gray" dimColor>
                {group.label}
              </Text>
              {groupProviders.map((provider) => (
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
                      {provider.installed
                        ? provider.running
                          ? "●"
                          : "○"
                        : "✗"}
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
                      <Text color="yellow"> ⚠ {provider.warning}</Text>
                    </Box>
                  )}
                </Box>
              ))}
            </Box>
          );
        })}
      </Box>

      {/* macOS compatibility note */}
      {process.platform === "darwin" && (
        <Box marginTop={1}>
          <Text color="yellow">
            ⚠ macOS: Stable Diffusion and ComfyUI may have compatibility issues
            due to limited CUDA support. GPU acceleration requires Apple Silicon
            with MPS.
          </Text>
        </Box>
      )}

      {/* All good message */}
      {allInstalled && allRunning && (
        <Box marginTop={1}>
          <Text color="green">✓ All providers are installed and running!</Text>
        </Box>
      )}

      {/* Categorized Menu */}
      {menuItems.length > 1 &&
        (() => {
          const categoryOrder: MenuCategory[] = [
            "text",
            "image",
            "video",
            "general",
          ];
          const categoryLabels: Record<MenuCategory, string> = {
            text: "Text Generation",
            image: "Image Generation",
            video: "Video Generation",
            general: "",
          };
          const categoryIcons: Record<MenuCategory, string> = {
            text: "💬",
            image: "🎨",
            video: "🎬",
            general: "",
          };

          // Only show categories that have items
          const activeCategories = categoryOrder.filter((cat) =>
            menuItems.some((item) => item.category === cat)
          );

          // Track the global index for selection
          let globalIndex = 0;

          return (
            <Box marginTop={1} flexDirection="column">
              {activeCategories.map((cat, catIdx) => {
                const items = menuItems.filter((item) => item.category === cat);
                const startIdx = globalIndex;
                globalIndex += items.length;

                return (
                  <Box
                    key={cat}
                    flexDirection="column"
                    marginTop={catIdx > 0 ? 1 : 0}
                  >
                    {cat !== "general" && (
                      <Text bold color="gray">
                        {categoryIcons[cat]} {categoryLabels[cat]}
                      </Text>
                    )}
                    {items.map((item, i) => {
                      const idx = startIdx + i;
                      return (
                        <Box key={item.id}>
                          <Text
                            color={idx === selectedIndex ? "cyan" : "white"}
                          >
                            {idx === selectedIndex ? " ❯ " : "   "}
                          </Text>
                          <Text
                            color={
                              item.disabled
                                ? "gray"
                                : idx === selectedIndex
                                ? "cyan"
                                : "white"
                            }
                            dimColor={item.disabled}
                          >
                            {item.label}
                          </Text>
                        </Box>
                      );
                    })}
                  </Box>
                );
              })}
            </Box>
          );
        })()}

      {/* Add your own models tips */}
      {(sd?.installed || comfyui?.installed) && (
        <Box
          marginTop={1}
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
        >
          <Text bold color="gray">
            Add Your Own Models
          </Text>
          {sd?.installed && (
            <Box marginTop={1} flexDirection="column">
              <Text color="gray">
                Image models (.safetensors) from{" "}
                <Text color="cyan">https://civitai.com</Text>
              </Text>
              <Text color="gray">
                {" "}
                Place in:{" "}
                <Text color="white">
                  {sdInstallPath}/models/Stable-diffusion/
                </Text>
              </Text>
            </Box>
          )}
          {comfyui?.installed && (
            <Box marginTop={1} flexDirection="column">
              <Text color="gray">
                Video models (.safetensors) from{" "}
                <Text color="cyan">https://huggingface.co</Text>
              </Text>
              <Text color="gray">
                {" "}
                Checkpoints:{" "}
                <Text color="white">
                  {comfyInstallPath}/models/checkpoints/
                </Text>
              </Text>
              <Text color="gray">
                {" "}
                Diffusion models:{" "}
                <Text color="white">
                  {comfyInstallPath}/models/diffusion_models/
                </Text>
              </Text>
            </Box>
          )}
        </Box>
      )}

      <Box marginTop={1}>
        <Text color="gray">↑↓ Navigate • Enter Select • q Quit</Text>
      </Box>
    </Box>
  );
}
