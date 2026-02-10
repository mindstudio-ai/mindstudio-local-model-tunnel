import { exec, spawn } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as os from "os";
import open from "open";
import {
  setStableDiffusionInstallPath,
  getStableDiffusionInstallPath,
} from "../config.js";

const execAsync = promisify(exec);

export type InstallProgress = {
  stage: string;
  message: string;
  complete?: boolean;
  error?: string;
};

export type ProgressCallback = (progress: InstallProgress) => void;

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
  const targetDir =
    installDir || path.join(os.homedir(), "stable-diffusion-webui-forge");

  try {
    onProgress({
      stage: "clone",
      message:
        "Cloning Stable Diffusion Forge repository (this may take a while)...",
    });

    // Use spawn with inherited stdio to show git clone progress
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        "git",
        [
          "clone",
          "--progress",
          "https://github.com/lllyasviel/stable-diffusion-webui-forge.git",
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
      message: `To start: cd "${targetDir}" && ./webui.sh --api`,
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
  try {
    await execAsync(`test -f "${modelFile}"`);
    return true;
  } catch {
    return false;
  }
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
    await execAsync(`mkdir -p "${modelsDir}"`);

    // Check if model already exists
    try {
      await execAsync(`test -f "${modelFile}"`);
      onProgress({
        stage: "complete",
        message: "SDXL base model already exists!",
        complete: true,
      });
      return true;
    } catch {
      // File doesn't exist, proceed with download
    }

    onProgress({
      stage: "download",
      message: "Downloading SDXL base model (~6.5 GB)...",
    });

    // Try wget first (better progress), fall back to curl
    const hasWget = await new Promise<boolean>((resolve) => {
      exec("which wget", (error) => resolve(!error));
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
          exec(`rm -f "${modelFile}"`);
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
    onProgress({
      stage: "start",
      message:
        "Starting Stable Diffusion server (this will take over the terminal)...",
    });

    // Small delay to let the message display
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Determine the script based on platform
    const isWindows = process.platform === "win32";
    const script = isWindows ? "webui-user.bat" : "./webui.sh";
    const args = ["--api"];

    // Run in foreground with inherited stdio - SD needs a proper terminal
    // This will block until the server is killed
    return new Promise((resolve) => {
      const proc = spawn(script, args, {
        cwd: installPath,
        stdio: "inherit",
        shell: true,
      });

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
        onProgress({
          stage: "complete",
          message:
            code === 0 ? "Stable Diffusion server stopped." : "Server exited.",
          complete: true,
        });
        resolve(true);
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
 * Run a command with sudo, allowing user to enter password
 */
async function runSudoCommand(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("sudo", ["bash", "-c", command], {
      stdio: "inherit",
    });
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

    console.log(
      "\nYou may be prompted for your password to stop the server.\n"
    );

    // Kill python processes running webui with sudo
    await runSudoCommand("pkill -f 'python.*launch.py' || true");
    await runSudoCommand("pkill -f 'python.*webui.py' || true");
    await runSudoCommand("pkill -f 'stable-diffusion-webui' || true");

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

    console.log(
      "\nYou may be prompted for your password to stop the server.\n"
    );

    // Try different methods with sudo
    // 1. Try systemctl first (if running as a service)
    await runSudoCommand("systemctl stop ollama 2>/dev/null || true");

    // 2. pkill with -f flag to match full command line
    await runSudoCommand("pkill -f 'ollama serve' || true");

    // 3. Try killall
    await runSudoCommand("killall ollama 2>/dev/null || true");

    // 4. Try pkill without -f
    await runSudoCommand("pkill ollama || true");

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
