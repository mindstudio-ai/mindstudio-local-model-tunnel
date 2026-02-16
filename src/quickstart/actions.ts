import {
  startStableDiffusion,
  stopStableDiffusion,
  installOllama,
  installLMStudio,
  installStableDiffusion,
  installComfyUI,
  pullOllamaModel,
  stopOllama,
  downloadSdModel,
  getPythonVersion,
  getStableDiffusionInstallPath,
  startComfyUI,
  stopComfyUI,
  downloadComfyUIModel,
  getComfyUIInstallPath,
} from './installers.js';
import * as path from 'path';
import * as os from 'os';
import { waitForEnter, clearTerminal } from '../helpers.js';

async function handleStartSd(): Promise<void> {
  clearTerminal();

  const pyInfo = await getPythonVersion();
  console.log(
    `Starting Stable Diffusion server (Python ${pyInfo?.version ?? 'unknown'})...\n`,
  );
  console.log('The server will take over this terminal.');
  console.log('Press Ctrl+C to stop the server and return to the menu.\n');

  let sdFailed = false;
  let lastError = '';
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
    if (!lastError.includes('venv')) {
      const sdPath = getStableDiffusionInstallPath() || 'sd-webui-forge-neo';
      console.log(
        '\nTip: If you recently changed Python versions, try deleting the venv:',
      );
      console.log(`  rm -rf ${sdPath}/venv`);
    }
    console.log('\nPress any key to return to setup menu...');
    await waitForEnter();
  } else {
    console.log('\nStable Diffusion server stopped.');
    console.log('Returning to setup menu...\n');
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function handleStopSd(): Promise<void> {
  clearTerminal();
  console.log('Stopping Stable Diffusion server...\n');

  await stopStableDiffusion((progress) => {
    if (progress.message) console.log(progress.message);
    if (progress.error) console.error(`Error: ${progress.error}`);
  });

  console.log('\nPress any key to return to setup menu...');
  await waitForEnter();
}

async function handleInstallOllama(): Promise<void> {
  clearTerminal();
  console.log('Installing Ollama...\n');
  console.log('You may be prompted for your password.\n');

  const success = await installOllama((progress) => {
    if (progress.message && !progress.error) console.log(progress.message);
    if (progress.error) console.error(`Error: ${progress.error}`);
  });

  if (success) {
    console.log('\nOllama installed! Pulling llama3.2 as default model...\n');
    await pullOllamaModel('llama3.2', (progress) => {
      if (progress.message) console.log(progress.message);
      if (progress.error) console.error(`Error: ${progress.error}`);
    });
    console.log('\nOllama is ready to use.');
  } else {
    console.log('\nInstallation failed. Check errors above.');
  }

  console.log('\nPress any key to return to setup menu...');
  await waitForEnter();
}

async function handleStopOllama(): Promise<void> {
  clearTerminal();
  console.log('Stopping Ollama server...\n');

  await stopOllama((progress) => {
    if (progress.message) console.log(progress.message);
    if (progress.error) console.error(`Error: ${progress.error}`);
  });

  console.log('\nPress any key to return to setup menu...');
  await waitForEnter();
}

async function handleFixPython(): Promise<void> {
  clearTerminal();
  const isMac = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';

  console.log('Forge Neo requires Python 3.13+\n');

  if (isMac) {
    console.log('Option 1 - Homebrew:');
    console.log('  brew install python@3.13\n');
    console.log('Option 2 - pyenv:');
    console.log('  pyenv install 3.13.12');
    console.log('  pyenv global 3.13.12\n');
  } else if (isWindows) {
    console.log('Download Python 3.13 from:');
    console.log('  https://www.python.org/downloads/\n');
    console.log('Make sure to check "Add Python to PATH" during install.\n');
  } else {
    console.log('Option 1 - pyenv (recommended):');
    console.log('  pyenv install 3.13.12');
    console.log('  pyenv global 3.13.12\n');
    console.log('Option 2 - System package manager:');
    console.log('  sudo add-apt-repository ppa:deadsnakes/ppa');
    console.log('  sudo apt update');
    console.log('  sudo apt install python3.13 python3.13-venv\n');
    console.log('Option 3 - Download from python.org:');
    console.log('  https://www.python.org/downloads/\n');
  }

  const sdPath = getStableDiffusionInstallPath() || 'sd-webui-forge-neo';
  console.log('After installing, delete the old venv folder if it exists:');
  console.log(`  rm -rf ${sdPath}/venv\n`);
  console.log('Then return here and start the server.\n');
  console.log('Press any key to return to setup menu...');

  await waitForEnter();
}

async function handleDownloadSdModel(): Promise<void> {
  clearTerminal();
  console.log('Downloading SDXL base model...\n');
  console.log(
    'This will download sd_xl_base_1.0.safetensors (~6.5 GB) from Hugging Face.\n',
  );

  const success = await downloadSdModel((progress) => {
    if (progress.message) console.log(progress.message);
    if (progress.error) console.error(`Error: ${progress.error}`);
  });

  const sdInstallPath = getStableDiffusionInstallPath() || 'sd-webui-forge-neo';
  if (success) {
    console.log('\nModel downloaded successfully!');
  } else {
    console.log(
      '\nDownload failed. You can also download SDXL models from https://civitai.com/models',
    );
    console.log('Filter by "SDXL 1.0" and place .safetensors files in:');
    console.log(`  ${sdInstallPath}/models/Stable-diffusion/`);
  }

  console.log('\nPress any key to return to setup menu...');
  await waitForEnter();
}

async function handleStartComfyUI(): Promise<void> {
  clearTerminal();
  console.log('Starting ComfyUI server...\n');
  console.log('The server will take over this terminal.');
  console.log('Press Ctrl+C to stop the server and return to the menu.\n');

  let failed = false;
  await startComfyUI((progress) => {
    if (progress.message && !progress.error) {
      console.log(progress.message);
    }
    if (progress.error) {
      failed = true;
      console.error(`\n${progress.message}`);
      console.error(progress.error);
    }
  });

  if (failed) {
    const comfyPath = getComfyUIInstallPath() || 'ComfyUI';
    console.log(
      '\nTip: If you have dependency issues, try deleting the venv:',
    );
    console.log(`  rm -rf ${comfyPath}/venv`);
    console.log('\nPress any key to return to setup menu...');
    await waitForEnter();
  } else {
    console.log('\nComfyUI server stopped.');
    console.log('Returning to setup menu...\n');
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function handleStopComfyUI(): Promise<void> {
  clearTerminal();
  console.log('Stopping ComfyUI server...\n');

  await stopComfyUI((progress) => {
    if (progress.message) console.log(progress.message);
    if (progress.error) console.error(`Error: ${progress.error}`);
  });

  console.log('\nPress any key to return to setup menu...');
  await waitForEnter();
}

async function handleDownloadComfyUIModel(modelId: string): Promise<void> {
  clearTerminal();
  console.log(`Downloading ${modelId} model for ComfyUI...\n`);
  console.log('This may download multiple files from HuggingFace.\n');

  const success = await downloadComfyUIModel(modelId, (progress) => {
    if (progress.message) console.log(progress.message);
    if (progress.error) console.error(`Error: ${progress.error}`);
  });

  if (success) {
    console.log('\nModel downloaded successfully!');
    console.log('Start the ComfyUI server and the tunnel to use it.');
  } else {
    console.log('\nDownload failed. Check the errors above.');
  }

  console.log('\nPress any key to return to setup menu...');
  await waitForEnter();
}

async function handleInstallLMStudio(): Promise<void> {
  clearTerminal();
  console.log('Opening LM Studio download page...\n');

  await installLMStudio((progress) => {
    if (progress.message) console.log(progress.message);
    if (progress.error) console.error(`Error: ${progress.error}`);
  });

  console.log('\nAfter installing, enable the local server in LM Studio.');
  console.log('\nPress any key to return to setup menu...');
  await waitForEnter();
}

async function handleInstallSd(): Promise<void> {
  clearTerminal();
  console.log('Installing Stable Diffusion Forge Neo...\n');

  const success = await installStableDiffusion((progress) => {
    if (progress.message && !progress.error) console.log(progress.message);
    if (progress.error) console.error(`Error: ${progress.error}`);
  });

  if (success) {
    console.log('\nStable Diffusion installed! You can start it from the setup menu.');
  } else {
    console.log('\nInstallation failed. Check errors above.');
  }

  console.log('\nPress any key to return to setup menu...');
  await waitForEnter();
}

async function handleInstallComfyUI(): Promise<void> {
  clearTerminal();
  console.log('Installing ComfyUI...\n');

  const installPath = path.join(os.homedir(), 'ComfyUI');
  const success = await installComfyUI(installPath, (progress) => {
    if (progress.message && !progress.error) console.log(progress.message);
    if (progress.error) console.error(`Error: ${progress.error}`);
  });

  if (success) {
    console.log('\nComfyUI installed! You can start it from the setup menu.');
  } else {
    console.log('\nInstallation failed. Check errors above.');
  }

  console.log('\nPress any key to return to setup menu...');
  await waitForEnter();
}

export async function executeSetupAction(action: string): Promise<void> {
  // Check parameterized actions first
  if (action.startsWith('download-comfyui-model:')) {
    const modelId = action.split(':')[1]!;
    await handleDownloadComfyUIModel(modelId);
    return;
  }

  switch (action) {
    case 'install-ollama':
      await handleInstallOllama();
      return;
    case 'install-lmstudio':
      await handleInstallLMStudio();
      return;
    case 'install-sd':
      await handleInstallSd();
      return;
    case 'install-comfyui':
      await handleInstallComfyUI();
      return;
    case 'stop-ollama':
      await handleStopOllama();
      return;
    case 'start-sd':
      await handleStartSd();
      return;
    case 'stop-sd':
      await handleStopSd();
      return;
    case 'download-sd-model':
      await handleDownloadSdModel();
      return;
    case 'fix-python':
      await handleFixPython();
      return;
    case 'start-comfyui':
      await handleStartComfyUI();
      return;
    case 'stop-comfyui':
      await handleStopComfyUI();
      return;
  }
}
