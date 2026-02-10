import { exec, spawn } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import open from "open";
import {
  setStableDiffusionInstallPath,
  getStableDiffusionInstallPath,
} from "../config.js";
import chalk from "chalk";

export { getStableDiffusionInstallPath };

const execAsync = promisify(exec);

export type InstallProgress = {
  stage: string;
  message: string;
  complete?: boolean;
  error?: string;
};

export type ProgressCallback = (progress: InstallProgress) => void;

/** Minimum Python version required by Forge Neo */
const REQUIRED_PYTHON_MAJOR = 3;
const REQUIRED_PYTHON_MINOR = 13;

type PythonInfo = {
  major: number;
  minor: number;
  patch: number;
  version: string;
  executable: string;
};

/**
 * Try to get Python version info from a specific command.
 */
async function tryPythonCommand(cmd: string): Promise<PythonInfo | null> {
  try {
    const { stdout: versionOut } = await execAsync(`${cmd} --version`);
    const match = versionOut.trim().match(/Python\s+(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;

    const major = parseInt(match[1]);
    const minor = parseInt(match[2]);
    const patch = parseInt(match[3]);
    const version = `${major}.${minor}.${patch}`;

    // Get the actual executable path
    let executable = cmd;
    try {
      const { stdout: exeOut } = await execAsync(
        `${cmd} -c "import sys; print(sys.executable)"`
      );
      executable = exeOut.trim();
    } catch {
      // Fall back to command name
    }

    return { major, minor, patch, version, executable };
  } catch {
    return null;
  }
}

/**
 * Get the best available Python version.
 * Checks multiple candidates and returns the newest one that meets
 * the minimum requirement, or the newest overall if none qualify.
 */
export async function getPythonVersion(): Promise<PythonInfo | null> {
  // Check multiple candidates - versioned commands first (more specific),
  // then generic ones. This handles cases where a venv or older version
  // shadows the newer install on PATH.
  const candidates = [
    "python3.13",
    "python3.14",
    "python3.15",
    "python3",
    "python",
  ];

  const results: PythonInfo[] = [];

  for (const cmd of candidates) {
    const info = await tryPythonCommand(cmd);
    if (info) {
      // If this one meets the requirement, return immediately
      if (isPythonVersionOk(info)) {
        return info;
      }
      results.push(info);
    }
  }

  // No qualifying version found - return the best we have (for error messages)
  if (results.length > 0) {
    results.sort((a, b) => {
      if (a.major !== b.major) return b.major - a.major;
      if (a.minor !== b.minor) return b.minor - a.minor;
      return b.patch - a.patch;
    });
    return results[0];
  }

  return null;
}

/**
 * Check if the installed Python version meets Forge Neo requirements (>= 3.13).
 */
export function isPythonVersionOk(info: {
  major: number;
  minor: number;
}): boolean {
  return (
    info.major > REQUIRED_PYTHON_MAJOR ||
    (info.major === REQUIRED_PYTHON_MAJOR &&
      info.minor >= REQUIRED_PYTHON_MINOR)
  );
}

/**
 * Install Ollama (macOS/Linux only)
 */
export async function installOllama(
  onProgress: ProgressCallback
): Promise<boolean> {
  if (process.platform === "win32") {
    onProgress({
      stage: "error",
      message: "Auto-install not supported on Windows",
      error: "Please download Ollama from https://ollama.com/download",
    });
    await open("https://ollama.com/download");
    return false;
  }

  try {
    onProgress({
      stage: "download",
      message: "Installing Ollama (you may be prompted for your password)...",
    });

    // Use spawn with inherited stdio so user can see and respond to sudo prompt
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        "bash",
        ["-c", "curl -fsSL https://ollama.com/install.sh | sh"],
        {
          stdio: "inherit", // Inherit stdin/stdout/stderr for password prompt
        }
      );

      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Installation exited with code ${code}`));
        }
      });

      proc.on("error", (err) => {
        reject(err);
      });
    });

    onProgress({
      stage: "complete",
      message: "Ollama installed successfully!",
      complete: true,
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    onProgress({
      stage: "error",
      message: "Installation failed",
      error: message,
    });
    return false;
  }
}

/**
 * Pull a model with Ollama
 */
export async function pullOllamaModel(
  model: string,
  onProgress: ProgressCallback
): Promise<boolean> {
  try {
    onProgress({ stage: "pull", message: `Pulling ${model}...` });

    // Use spawn to get real-time output
    return new Promise((resolve) => {
      const proc = spawn("ollama", ["pull", model], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      proc.stdout?.on("data", (data) => {
        const line = data.toString().trim();
        if (line) {
          onProgress({ stage: "pull", message: line });
        }
      });

      proc.stderr?.on("data", (data) => {
        const line = data.toString().trim();
        if (line) {
          onProgress({ stage: "pull", message: line });
        }
      });

      proc.on("close", (code) => {
        if (code === 0) {
          onProgress({
            stage: "complete",
            message: `${model} ready!`,
            complete: true,
          });
          resolve(true);
        } else {
          onProgress({
            stage: "error",
            message: "Pull failed",
            error: `Exit code: ${code}`,
          });
          resolve(false);
        }
      });

      proc.on("error", (error) => {
        onProgress({
          stage: "error",
          message: "Pull failed",
          error: error.message,
        });
        resolve(false);
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    onProgress({ stage: "error", message: "Pull failed", error: message });
    return false;
  }
}

/**
 * Open LM Studio download page
 */
export async function installLMStudio(
  onProgress: ProgressCallback
): Promise<boolean> {
  onProgress({
    stage: "browser",
    message: "Opening LM Studio download page...",
  });
  await open("https://lmstudio.ai/download");
  onProgress({
    stage: "manual",
    message: "Please install LM Studio and enable the local server",
    complete: true,
  });
  return true;
}

/**
 * Install Stable Diffusion Forge
 */
export async function installStableDiffusion(
  onProgress: ProgressCallback,
  installDir?: string
): Promise<boolean> {
  const targetDir = installDir || path.join(os.homedir(), "sd-webui-forge-neo");

  try {
    onProgress({
      stage: "clone",
      message:
        "Cloning Stable Diffusion Forge Neo repository (this may take a while)...",
    });

    // Use spawn with inherited stdio to show git clone progress
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        "git",
        [
          "clone",
          "--progress",
          "--branch",
          "neo",
          "https://github.com/Haoming02/sd-webui-forge-classic.git",
          targetDir,
        ],
        {
          stdio: "inherit", // Show clone progress
        }
      );

      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Git clone exited with code ${code}`));
        }
      });

      proc.on("error", (err) => {
        reject(err);
      });
    });

    // Save the install path to config
    setStableDiffusionInstallPath(targetDir);

    onProgress({
      stage: "complete",
      message: `Installed to ${targetDir}`,
      complete: true,
    });

    onProgress({
      stage: "info",
      message: `To start: cd "${targetDir}" && python launch.py --api`,
    });

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    if (message.includes("already exists") || message.includes("code 128")) {
      // Still save the path even if already installed
      setStableDiffusionInstallPath(targetDir);
      onProgress({
        stage: "complete",
        message: "Already installed!",
        complete: true,
      });
      return true;
    }

    onProgress({
      stage: "error",
      message: "Installation failed",
      error: message,
    });
    return false;
  }
}

/**
 * Check if the default SDXL model already exists.
 */
export async function hasDefaultSdModel(): Promise<boolean> {
  const installPath = getStableDiffusionInstallPath();
  if (!installPath) return false;
  const modelFile = path.join(
    installPath,
    "models",
    "Stable-diffusion",
    "sd_xl_base_1.0.safetensors"
  );
  return fs.existsSync(modelFile);
}

/**
 * Download a default SDXL model for Stable Diffusion.
 * Uses wget with progress output (falls back to curl).
 */
export async function downloadSdModel(
  onProgress: ProgressCallback
): Promise<boolean> {
  const installPath = getStableDiffusionInstallPath();

  if (!installPath) {
    onProgress({
      stage: "error",
      message: "Stable Diffusion install path not found",
      error: "Please install Stable Diffusion first",
    });
    return false;
  }

  const modelsDir = path.join(installPath, "models", "Stable-diffusion");
  const modelUrl =
    "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors";
  const modelFile = path.join(modelsDir, "sd_xl_base_1.0.safetensors");

  try {
    // Ensure models directory exists
    fs.mkdirSync(modelsDir, { recursive: true });

    // Check if model already exists
    if (fs.existsSync(modelFile)) {
      onProgress({
        stage: "complete",
        message: "SDXL base model already exists!",
        complete: true,
      });
      return true;
    }

    onProgress({
      stage: "download",
      message: "Downloading SDXL base model (~6.5 GB)...",
    });

    // Check available download tools: wget (better progress on Linux/macOS), curl (everywhere)
    const isWindows = process.platform === "win32";
    const whichCmd = isWindows ? "where" : "which";
    const hasWget = await new Promise<boolean>((resolve) => {
      exec(`${whichCmd} wget`, (error) => resolve(!error));
    });

    return new Promise((resolve) => {
      let proc: ReturnType<typeof spawn>;

      if (hasWget) {
        proc = spawn(
          "wget",
          ["-c", "--show-progress", "-O", modelFile, modelUrl],
          { stdio: "inherit" }
        );
      } else {
        // curl is available on macOS, Linux, and Windows 10+
        proc = spawn(
          "curl",
          ["-L", "-C", "-", "--progress-bar", "-o", modelFile, modelUrl],
          { stdio: "inherit" }
        );
      }

      proc.on("close", (code) => {
        if (code === 0) {
          onProgress({
            stage: "complete",
            message: "SDXL base model downloaded!",
            complete: true,
          });
          resolve(true);
        } else {
          onProgress({
            stage: "error",
            message: "Download failed",
            error: `Exit code ${code}. The model may require accepting the license at huggingface.co first. You can also download manually from Civitai.`,
          });
          // Clean up partial file
          try {
            fs.unlinkSync(modelFile);
          } catch {
            /* ignore */
          }
          resolve(false);
        }
      });

      proc.on("error", (err) => {
        onProgress({
          stage: "error",
          message: "Download failed",
          error: err.message,
        });
        resolve(false);
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    onProgress({
      stage: "error",
      message: "Failed to download model",
      error: message,
    });
    return false;
  }
}

/**
 * Start Stable Diffusion server
 * Note: SD runs in the foreground and takes over the terminal.
 * We start it and poll in the background until it's ready.
 */
export async function startStableDiffusion(
  onProgress: ProgressCallback
): Promise<boolean> {
  const installPath = getStableDiffusionInstallPath();

  if (!installPath) {
    onProgress({
      stage: "error",
      message: "Stable Diffusion install path not found",
      error: "Please install Stable Diffusion first",
    });
    return false;
  }

  try {
    // Check Python version before starting
    const pyInfo = await getPythonVersion();
    if (!pyInfo) {
      onProgress({
        stage: "error",
        message: "Python not found",
        error:
          "Python is not installed. Forge Neo requires Python 3.13+.\nInstall from https://www.python.org/downloads/",
      });
      return false;
    }

    if (!isPythonVersionOk(pyInfo)) {
      onProgress({
        stage: "error",
        message: `Python ${pyInfo.version} is too old`,
        error: `Forge Neo requires Python ${REQUIRED_PYTHON_MAJOR}.${REQUIRED_PYTHON_MINOR}+. You have ${pyInfo.version}.\nInstall Python 3.13 from https://www.python.org/downloads/\nIf using pyenv: pyenv install 3.13.12 && pyenv global 3.13.12\nAfter updating Python, delete the old venv: rm -rf ${installPath}/venv`,
      });
      return false;
    }

    onProgress({
      stage: "start",
      message: `Starting Stable Diffusion server (Python ${pyInfo.version})...`,
    });

    // Small delay to let the message display
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Determine the launch method based on platform
    // Neo fork removed .sh scripts; on Linux/macOS we create/activate venv and run launch.py
    const isWindows = process.platform === "win32";

    // Detect the driver's max CUDA version so we can pick the right PyTorch build.
    // Forge Neo defaults to cu130 which requires very new drivers.
    let cudaEnv: Record<string, string> = {};
    try {
      const { stdout: smiOut } = await execAsync(
        "nvidia-smi --query-gpu=driver_version --format=csv,noheader"
      );
      // nvidia-smi also shows CUDA version in its header; parse from full output
      const { stdout: smiFullOut } = await execAsync("nvidia-smi");
      const cudaMatch = smiFullOut.match(/CUDA Version:\s*(\d+)\.(\d+)/);
      if (cudaMatch) {
        const driverCudaMajor = parseInt(cudaMatch[1]);
        const driverCudaMinor = parseInt(cudaMatch[2]);

        // Map driver CUDA capability to the best compatible PyTorch CUDA build
        // Available PyTorch CUDA builds: cu118, cu121, cu124, cu126, cu128, cu130
        let cuTag: string;
        if (driverCudaMajor >= 13) {
          cuTag = "cu130";
        } else if (driverCudaMajor === 12 && driverCudaMinor >= 8) {
          cuTag = "cu128";
        } else if (driverCudaMajor === 12 && driverCudaMinor >= 6) {
          cuTag = "cu126";
        } else if (driverCudaMajor === 12 && driverCudaMinor >= 4) {
          cuTag = "cu124";
        } else if (driverCudaMajor === 12) {
          cuTag = "cu121";
        } else {
          cuTag = "cu118";
        }

        // Only override if driver doesn't support the default cu130
        if (cuTag !== "cu130") {
          onProgress({
            stage: "start",
            message: `Driver supports CUDA ${driverCudaMajor}.${driverCudaMinor}, using PyTorch with ${cuTag}`,
          });
          const torchIndexUrl = `https://download.pytorch.org/whl/${cuTag}`;
          cudaEnv = {
            TORCH_INDEX_URL: torchIndexUrl,
            TORCH_COMMAND: `pip install torch torchvision --extra-index-url ${torchIndexUrl}`,
          };
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    } catch {
      // nvidia-smi not available or failed - let SD use its defaults
    }

    // Merge CUDA env overrides with current environment
    const env = { ...process.env, ...cudaEnv };

    // If we have CUDA env overrides and an existing venv (Linux/macOS),
    // check if the venv has wrong PyTorch CUDA bindings and needs recreation
    if (!isWindows && cudaEnv.TORCH_INDEX_URL) {
      const venvPythonCheck = path.join(installPath, "venv", "bin", "python");
      if (fs.existsSync(venvPythonCheck)) {
        try {
          const { stdout: torchCheck } = await execAsync(
            `"${venvPythonCheck}" -c "import torch; print(torch.version.cuda or 'none')"`
          );
          const installedCuda = torchCheck.trim();
          const targetCu = cudaEnv.TORCH_INDEX_URL.split("/").pop() || "";
          // e.g. installedCuda="13.0" and targetCu="cu121" -> mismatch
          const installedCuTag =
            "cu" + installedCuda.replace(".", "").replace(/0$/, "");
          if (installedCuTag !== targetCu) {
            onProgress({
              stage: "start",
              message: `Existing venv has PyTorch for CUDA ${installedCuda}, recreating with ${targetCu}...`,
            });
            await new Promise((r) => setTimeout(r, 1000));
            // Remove the old venv so the launch script recreates it
            fs.rmSync(path.join(installPath, "venv"), {
              recursive: true,
              force: true,
            });
          }
        } catch {
          // torch not installed in venv yet - no need to recreate
        }
      }
    }

    // Run in foreground with inherited stdio - SD needs a proper terminal
    // This will block until the server is killed
    return new Promise((resolve) => {
      let proc: ReturnType<typeof spawn>;

      if (isWindows) {
        // Windows: use webui-user.bat which handles venv and launches
        proc = spawn("cmd", ["/c", "webui-user.bat"], {
          cwd: installPath,
          stdio: "inherit",
          env,
        });
      } else {
        // Linux/macOS: create venv if needed using the correct python, activate, and run launch.py
        const venvDir = path.join(installPath, "venv");
        const venvPython = path.join(venvDir, "bin", "python");

        const launchScript = [
          `if [ ! -f "${venvPython}" ]; then`,
          `  echo "Creating virtual environment with Python ${pyInfo.version}..."`,
          `  "${pyInfo.executable}" -m venv "${venvDir}"`,
          `fi`,
          `source "${venvDir}/bin/activate"`,
          `python launch.py --api`,
        ].join("\n");

        proc = spawn("bash", ["-c", launchScript], {
          cwd: installPath,
          stdio: "inherit",
          env,
        });
      }

      // Start polling for server readiness in the background
      const pollForReady = async () => {
        const maxWaitTime = 15 * 60 * 1000; // 15 minutes for first run
        const pollInterval = 5000;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitTime) {
          await new Promise((r) => setTimeout(r, pollInterval));

          try {
            const response = await fetch(
              "http://127.0.0.1:7860/sdapi/v1/sd-models",
              { signal: AbortSignal.timeout(3000) }
            );
            if (response.ok) {
              console.log("\n\n✓ Stable Diffusion server is ready!\n");
              console.log(
                chalk.yellow(
                  "Please leave this terminal running and open another terminal to run mindstudio-local.\n"
                )
              );
              console.log(
                "Press Ctrl+C to stop the server and return to the menu.\n"
              );
              return;
            }
          } catch {
            // Not ready yet
          }
        }
      };

      pollForReady();

      proc.on("close", (code) => {
        if (code === 0) {
          onProgress({
            stage: "complete",
            message: "Stable Diffusion server stopped.",
            complete: true,
          });
          resolve(true);
        } else {
          onProgress({
            stage: "error",
            message: "Stable Diffusion failed to start",
            error: [
              `Process exited with code ${code}. Check the output above for details.`,
              "",
              "Common fixes:",
              `  - Delete the venv and retry: rm -rf ${installPath}/venv`,
              "  - Ensure Python 3.13+ is installed",
              "  - Ensure NVIDIA drivers and CUDA are up to date",
            ].join("\n"),
          });
          resolve(false);
        }
      });

      proc.on("error", (err) => {
        onProgress({
          stage: "error",
          message: "Failed to start",
          error: err.message,
        });
        resolve(false);
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    onProgress({
      stage: "error",
      message: "Failed to start Stable Diffusion",
      error: message,
    });
    return false;
  }
}

/**
 * Run a command that may need elevated privileges (cross-platform)
 */
async function runKillCommand(command: string): Promise<boolean> {
  const isWindows = process.platform === "win32";
  return new Promise((resolve) => {
    let proc: ReturnType<typeof spawn>;
    if (isWindows) {
      proc = spawn("cmd", ["/c", command], { stdio: "inherit" });
    } else {
      proc = spawn("sudo", ["bash", "-c", command], { stdio: "inherit" });
    }
    proc.on("close", (code) => {
      resolve(code === 0 || code === 1); // 1 = no process found, which is OK
    });
    proc.on("error", () => {
      resolve(false);
    });
  });
}

/**
 * Stop Stable Diffusion server
 */
export async function stopStableDiffusion(
  onProgress: ProgressCallback
): Promise<boolean> {
  try {
    onProgress({
      stage: "start",
      message: "Stopping Stable Diffusion server...",
    });

    const isWindows = process.platform === "win32";

    if (!isWindows) {
      onProgress({
        stage: "info",
        message: "You may be prompted for your password...",
      });
    }

    // Kill python processes running webui
    if (isWindows) {
      await runKillCommand(
        'taskkill /F /FI "IMAGENAME eq python.exe" /FI "WINDOWTITLE eq *launch*" 2>nul || exit 0'
      );
      await runKillCommand(
        'taskkill /F /FI "IMAGENAME eq python.exe" /FI "WINDOWTITLE eq *webui*" 2>nul || exit 0'
      );
    } else {
      await runKillCommand("pkill -f 'python.*launch.py' || true");
      await runKillCommand("pkill -f 'python.*webui.py' || true");
      await runKillCommand("pkill -f 'stable-diffusion-webui' || true");
    }

    // Wait for processes to terminate
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Verify it's stopped
    try {
      const response = await fetch("http://127.0.0.1:7860/sdapi/v1/sd-models", {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) {
        onProgress({
          stage: "complete",
          message:
            "Server may still be running. Try killing the process manually.",
          complete: true,
        });
        return false;
      }
    } catch {
      // Connection refused = server is stopped
    }

    onProgress({
      stage: "complete",
      message: "Stable Diffusion server stopped!",
      complete: true,
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    onProgress({ stage: "error", message: "Failed to stop", error: message });
    return false;
  }
}

/**
 * Start Ollama server
 */
export async function startOllama(
  onProgress: ProgressCallback
): Promise<boolean> {
  try {
    onProgress({ stage: "start", message: "Starting Ollama server..." });

    // Start in background
    const proc = spawn("ollama", ["serve"], {
      detached: true,
      stdio: "ignore",
    });
    proc.unref();

    // Wait a moment for it to start
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Check if it's running
    try {
      const response = await fetch("http://localhost:11434/api/tags", {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) {
        onProgress({
          stage: "complete",
          message: "Ollama server started!",
          complete: true,
        });
        return true;
      }
    } catch {
      // Fall through
    }

    onProgress({
      stage: "complete",
      message: "Ollama starting in background...",
      complete: true,
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    onProgress({ stage: "error", message: "Failed to start", error: message });
    return false;
  }
}

/**
 * Stop Ollama server
 */
export async function stopOllama(
  onProgress: ProgressCallback
): Promise<boolean> {
  try {
    onProgress({ stage: "start", message: "Stopping Ollama server..." });

    const isWindows = process.platform === "win32";

    if (!isWindows) {
      onProgress({
        stage: "info",
        message: "You may be prompted for your password...",
      });
    }

    if (isWindows) {
      await runKillCommand("taskkill /F /IM ollama.exe 2>nul || exit 0");
      await runKillCommand(
        'taskkill /F /FI "IMAGENAME eq ollama_runners*" 2>nul || exit 0'
      );
    } else {
      // 1. Try systemctl first (if running as a service)
      await runKillCommand("systemctl stop ollama 2>/dev/null || true");

      // 2. pkill with -f flag to match full command line
      await runKillCommand("pkill -f 'ollama serve' || true");

      // 3. Try killall
      await runKillCommand("killall ollama 2>/dev/null || true");

      // 4. Try pkill without -f
      await runKillCommand("pkill ollama || true");
    }

    // Wait a moment for process to terminate
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Verify it's stopped by checking if the API is still responding
    try {
      const response = await fetch("http://localhost:11434/api/tags", {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) {
        // Still running
        onProgress({
          stage: "complete",
          message:
            "Ollama may still be running. Check with: ps aux | grep ollama",
          complete: true,
        });
        return false;
      }
    } catch {
      // Connection refused = server is stopped
    }

    onProgress({
      stage: "complete",
      message: "Ollama server stopped!",
      complete: true,
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    onProgress({ stage: "error", message: "Failed to stop", error: message });
    return false;
  }
}
