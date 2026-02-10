import React from "react";
import { render } from "ink";
import { QuickstartScreen } from "./QuickstartScreen.js";
import {
  startStableDiffusion,
  stopStableDiffusion,
  stopOllama,
  downloadSdModel,
  getPythonVersion,
  getStableDiffusionInstallPath,
} from "./installers.js";
import { spawn } from "child_process";

const clear = () => process.stdout.write("\x1B[2J\x1B[3J\x1B[H");

function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    const isWindows = process.platform === "win32";
    const child = isWindows
      ? spawn("cmd", ["/c", "pause >nul"], { stdio: "inherit" })
      : spawn("bash", ["-c", "read -n 1 -s"], { stdio: "inherit" });
    child.on("close", () => resolve());
    child.on("error", () => resolve());
  });
}

async function handleStartSd(): Promise<void> {
  clear();

  const pyInfo = await getPythonVersion();
  console.log(
    `Starting Stable Diffusion server (Python ${pyInfo?.version ?? "unknown"})...\n`
  );
  console.log("The server will take over this terminal.");
  console.log("Press Ctrl+C to stop the server and return to the menu.\n");

  let sdFailed = false;
  let lastError = "";
  await startStableDiffusion((progress) => {
    if (progress.message && !progress.error) {
      console.log(progress.message);
    }
    if (progress.error) {
      sdFailed = true;
      lastError = progress.error;
      console.error(`\n${progress.message}`);
      console.error(progress.error);
    }
  });

  if (sdFailed) {
    // Show the full error context if it wasn't already in the progress callback
    if (!lastError.includes("venv")) {
      const sdPath = getStableDiffusionInstallPath() || "sd-webui-forge-neo";
      console.log("\nTip: If you recently changed Python versions, try deleting the venv:");
      console.log(`  rm -rf ${sdPath}/venv`);
    }
    console.log("\nPress any key to return to setup menu...");
    await waitForEnter();
  } else {
    console.log("\nStable Diffusion server stopped.");
    console.log("Returning to setup menu...\n");
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function handleStopSd(): Promise<void> {
  clear();
  console.log("Stopping Stable Diffusion server...\n");

  await stopStableDiffusion((progress) => {
    if (progress.message) console.log(progress.message);
    if (progress.error) console.error(`Error: ${progress.error}`);
  });

  console.log("\nPress any key to return to setup menu...");
  await waitForEnter();
}

async function handleStopOllama(): Promise<void> {
  clear();
  console.log("Stopping Ollama server...\n");

  await stopOllama((progress) => {
    if (progress.message) console.log(progress.message);
    if (progress.error) console.error(`Error: ${progress.error}`);
  });

  console.log("\nPress any key to return to setup menu...");
  await waitForEnter();
}

async function handleFixPython(): Promise<void> {
  clear();
  const isMac = process.platform === "darwin";
  const isWindows = process.platform === "win32";

  console.log("Forge Neo requires Python 3.13+\n");

  if (isMac) {
    console.log("Option 1 - Homebrew:");
    console.log("  brew install python@3.13\n");
    console.log("Option 2 - pyenv:");
    console.log("  pyenv install 3.13.12");
    console.log("  pyenv global 3.13.12\n");
  } else if (isWindows) {
    console.log("Download Python 3.13 from:");
    console.log("  https://www.python.org/downloads/\n");
    console.log('Make sure to check "Add Python to PATH" during install.\n');
  } else {
    console.log("Option 1 - pyenv (recommended):");
    console.log("  pyenv install 3.13.12");
    console.log("  pyenv global 3.13.12\n");
    console.log("Option 2 - System package manager:");
    console.log("  sudo add-apt-repository ppa:deadsnakes/ppa");
    console.log("  sudo apt update");
    console.log("  sudo apt install python3.13 python3.13-venv\n");
    console.log("Option 3 - Download from python.org:");
    console.log("  https://www.python.org/downloads/\n");
  }

  const sdPath = getStableDiffusionInstallPath() || "sd-webui-forge-neo";
  console.log("After installing, delete the old venv folder if it exists:");
  console.log(`  rm -rf ${sdPath}/venv\n`);
  console.log("Then return here and start the server.\n");
  console.log("Press any key to return to setup menu...");

  await waitForEnter();
}

async function handleDownloadSdModel(): Promise<void> {
  clear();
  console.log("Downloading SDXL base model...\n");
  console.log(
    "This will download sd_xl_base_1.0.safetensors (~6.5 GB) from Hugging Face.\n"
  );

  const success = await downloadSdModel((progress) => {
    if (progress.message) console.log(progress.message);
    if (progress.error) console.error(`Error: ${progress.error}`);
  });

  const sdInstallPath = getStableDiffusionInstallPath() || "sd-webui-forge-neo";
  if (success) {
    console.log("\nModel downloaded successfully!");
  } else {
    console.log(
      "\nDownload failed. You can also download SDXL models from https://civitai.com/models"
    );
    console.log('Filter by "SDXL 1.0" and place .safetensors files in:');
    console.log(`  ${sdInstallPath}/models/Stable-diffusion/`);
  }

  console.log("\nPress any key to return to setup menu...");
  await waitForEnter();
}

export async function startQuickstart(): Promise<void> {
  // Loop: render Ink TUI, handle external actions, re-render
  while (true) {
    let externalAction: string | null = null;

    clear();
    const { waitUntilExit } = render(
      <QuickstartScreen
        onExternalAction={(action) => {
          externalAction = action;
        }}
      />
    );
    await waitUntilExit();

    // If no external action was requested, user quit - break out of loop
    if (!externalAction) {
      break;
    }

    // Handle terminal-takeover actions outside of Ink
    switch (externalAction) {
      case "start-sd":
        await handleStartSd();
        continue;
      case "stop-sd":
        await handleStopSd();
        continue;
      case "stop-ollama":
        await handleStopOllama();
        continue;
      case "download-sd-model":
        await handleDownloadSdModel();
        continue;
      case "fix-python":
        await handleFixPython();
        continue;
    }

    // Unknown action - break
    break;
  }
}

export { detectAllProviders, checkPrerequisites } from "./detect.js";
export type { ProviderInfo } from "./detect.js";
