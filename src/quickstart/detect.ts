import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { getStableDiffusionInstallPath, getComfyUIInstallPath } from "../config.js";

const execAsync = promisify(exec);

export interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  installed: boolean;
  running: boolean;
  installable: boolean; // Can we auto-install it?
  warning?: string; // Optional warning to display
}

/**
 * Check if a command exists in PATH
 */
async function commandExists(command: string): Promise<boolean> {
  try {
    const checkCmd = process.platform === "win32" ? "where" : "which";
    await execAsync(`${checkCmd} ${command}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a process is listening on a port
 */
async function isPortOpen(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}`, {
      method: "HEAD",
      signal: AbortSignal.timeout(1000),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect Ollama installation and status
 */
async function detectOllama(): Promise<ProviderInfo> {
  const installed = await commandExists("ollama");
  let running = false;

  if (installed) {
    try {
      const response = await fetch("http://localhost:11434/api/tags", {
        signal: AbortSignal.timeout(1000),
      });
      running = response.ok;
    } catch {
      running = false;
    }
  }

  return {
    id: "ollama",
    name: "Ollama",
    description: "Text generation (llama, mistral, etc.)",
    installed,
    running,
    installable: process.platform !== "win32", // Auto-install on macOS/Linux
  };
}

/**
 * Detect LM Studio installation and status
 */
async function detectLMStudio(): Promise<ProviderInfo> {
  // LM Studio is a GUI app - check common install locations
  let installed = false;

  const possiblePaths = {
    darwin: ["/Applications/LM Studio.app"],
    linux: [
      path.join(os.homedir(), ".local/share/LM Studio"),
      "/opt/lm-studio",
    ],
    win32: [
      path.join(process.env.LOCALAPPDATA || "", "LM Studio"),
      path.join(process.env.PROGRAMFILES || "", "LM Studio"),
    ],
  };

  const paths = possiblePaths[process.platform as keyof typeof possiblePaths] || [];
  for (const p of paths) {
    if (fs.existsSync(p)) {
      installed = true;
      break;
    }
  }

  // Check if server is running
  let running = false;
  try {
    const response = await fetch("http://localhost:1234/v1/models", {
      signal: AbortSignal.timeout(1000),
    });
    running = response.ok;
    if (running) installed = true; // If running, it's definitely installed
  } catch {
    running = false;
  }

  return {
    id: "lmstudio",
    name: "LM Studio",
    description: "Text generation (GUI app)",
    installed,
    running,
    installable: false, // GUI app - can only open download page
  };
}

/**
 * Detect Stable Diffusion Forge installation and status
 */
async function detectStableDiffusion(): Promise<ProviderInfo> {
  // First check the saved install path from config
  const savedPath = getStableDiffusionInstallPath();
  
  // Check common locations for SD Forge (Neo and legacy)
  const possiblePaths = [
    ...(savedPath ? [savedPath] : []), // Check saved path first
    path.join(os.homedir(), "sd-webui-forge-neo"),
    path.join(os.homedir(), "sd-webui-forge-classic"),
    path.join(os.homedir(), "stable-diffusion-webui-forge"),
    path.join(os.homedir(), "sd-forge"),
    path.join(os.homedir(), "Projects", "sd-webui-forge-neo"),
    path.join(os.homedir(), "Code", "sd-webui-forge-neo"),
  ];

  let installed = false;
  for (const p of possiblePaths) {
    // Neo has launch.py; legacy has webui.sh/webui.bat
    if (fs.existsSync(path.join(p, "launch.py")) || fs.existsSync(path.join(p, "webui.sh")) || fs.existsSync(path.join(p, "webui.bat"))) {
      installed = true;
      break;
    }
  }

  // Check if server is running
  let running = false;
  try {
    const response = await fetch("http://127.0.0.1:7860/sdapi/v1/sd-models", {
      signal: AbortSignal.timeout(1000),
    });
    running = response.ok;
    if (running) installed = true;
  } catch {
    running = false;
  }

  // Check prerequisites for installation
  const hasGit = await commandExists("git");
  const hasPython = await commandExists("python3") || await commandExists("python");

  // Check Python version for Forge Neo (requires 3.13+)
  let warning: string | undefined;
  if (hasPython && !running) {
    try {
      const { getPythonVersion, isPythonVersionOk } = await import("./installers.js");
      const pyInfo = await getPythonVersion();
      if (pyInfo && !isPythonVersionOk(pyInfo)) {
        warning = `Python ${pyInfo.version} detected, Forge Neo requires 3.13+`;
      }
    } catch {
      // Ignore import errors
    }
  }

  return {
    id: "stable-diffusion",
    name: "Stable Diffusion Forge Neo",
    description: "Image generation",
    installed,
    running,
    installable: hasGit && hasPython && process.platform !== "win32",
    warning,
  };
}

/**
 * Detect ComfyUI installation and status
 */
async function detectComfyUI(): Promise<ProviderInfo> {
  const savedPath = getComfyUIInstallPath();

  const possiblePaths = [
    ...(savedPath ? [savedPath] : []),
    path.join(os.homedir(), "ComfyUI"),
    path.join(os.homedir(), "comfyui"),
    path.join(os.homedir(), "Projects", "ComfyUI"),
    path.join(os.homedir(), "Code", "ComfyUI"),
  ];

  let installed = false;
  for (const p of possiblePaths) {
    if (fs.existsSync(path.join(p, "main.py")) && fs.existsSync(path.join(p, "requirements.txt"))) {
      installed = true;
      break;
    }
  }

  // Check if server is running
  let running = false;
  try {
    const response = await fetch("http://127.0.0.1:8188/system_stats", {
      signal: AbortSignal.timeout(1000),
    });
    running = response.ok;
    if (running) installed = true;
  } catch {
    running = false;
  }

  const hasGit = await commandExists("git");
  const hasPython = (await commandExists("python3")) || (await commandExists("python"));

  return {
    id: "comfyui",
    name: "ComfyUI",
    description: "Video generation (LTX-Video, Wan2.1)",
    installed,
    running,
    installable: hasGit && hasPython && process.platform !== "win32",
  };
}

/**
 * Detect all providers
 */
export async function detectAllProviders(): Promise<ProviderInfo[]> {
  const [ollama, lmstudio, sd, comfyui] = await Promise.all([
    detectOllama(),
    detectLMStudio(),
    detectStableDiffusion(),
    detectComfyUI(),
  ]);

  return [ollama, lmstudio, sd, comfyui];
}

/**
 * Check prerequisites for installation
 */
export async function checkPrerequisites(): Promise<{
  git: boolean;
  python: boolean;
  curl: boolean;
}> {
  const [git, python3, python, curl] = await Promise.all([
    commandExists("git"),
    commandExists("python3"),
    commandExists("python"),
    commandExists("curl"),
  ]);

  return {
    git,
    python: python3 || python,
    curl,
  };
}
