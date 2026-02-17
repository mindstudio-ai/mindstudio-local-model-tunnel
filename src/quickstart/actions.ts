import * as path from 'path';
import * as os from 'os';
import { getProvider } from '../providers/index.js';
import { getPythonVersion } from '../providers/utils.js';
import { getStableDiffusionInstallPath } from '../config.js';
import { waitForEnter, clearTerminal } from '../helpers.js';
import type { LifecycleProgressCallback } from '../providers/types.js';

const progressLogger: LifecycleProgressCallback = (progress) => {
  if (progress.message && !progress.error) console.log(progress.message);
  if (progress.error) {
    console.error(`\n${progress.message}`);
    console.error(progress.error);
  }
};

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
}

export async function executeSetupAction(action: string): Promise<void> {
  const [operation, providerName, ...rest] = action.split(':');

  // Special case: fix-python is not a provider operation
  if (operation === 'fix-python') {
    await handleFixPython();
    await waitForEnter();
    return;
  }

  const provider = providerName ? getProvider(providerName as any) : undefined;

  if (!provider) {
    console.error(`Unknown provider: ${providerName}`);
    await waitForEnter();
    return;
  }

  clearTerminal();

  switch (operation) {
    case 'install': {
      console.log(`Installing ${provider.displayName}...\n`);

      // For Ollama, handle post-install model pull
      const success = await provider.install?.(progressLogger, undefined);

      if (success && provider.name === 'ollama') {
        console.log('\nOllama installed! Pulling llama3.2 as default model...\n');
        await provider.downloadModel?.('llama3.2', progressLogger);
        console.log('\nOllama is ready to use.');
      } else if (success) {
        console.log(`\n${provider.displayName} installed!`);
      } else {
        console.log('\nInstallation failed. Check errors above.');
      }
      break;
    }

    case 'start': {
      console.log(`Starting ${provider.displayName}...\n`);

      if (provider.name === 'stable-diffusion') {
        const pyInfo = await getPythonVersion();
        console.log(
          `Starting Stable Diffusion server (Python ${pyInfo?.version ?? 'unknown'})...\n`,
        );
        console.log('The server will take over this terminal.');
        console.log('Press Ctrl+C to stop the server and return to the menu.\n');
      } else if (provider.name === 'comfyui') {
        console.log('The server will take over this terminal.');
        console.log('Press Ctrl+C to stop the server and return to the menu.\n');
      }

      let failed = false;
      let lastError = '';
      await provider.start?.((progress) => {
        if (progress.message && !progress.error) {
          console.log(progress.message);
        }
        if (progress.error) {
          failed = true;
          lastError = progress.error;
          console.error(`\n${progress.message}`);
          console.error(progress.error);
        }
      });

      if (failed) {
        if (
          provider.name === 'stable-diffusion' &&
          !lastError.includes('venv')
        ) {
          const sdPath =
            getStableDiffusionInstallPath() || 'sd-webui-forge-neo';
          console.log(
            '\nTip: If you recently changed Python versions, try deleting the venv:',
          );
          console.log(`  rm -rf ${sdPath}/venv`);
        }
      } else {
        console.log(`\n${provider.displayName} server stopped.`);
        console.log('Returning to setup menu...\n');
        await new Promise((r) => setTimeout(r, 1500));
        return; // Don't wait for enter on clean stop
      }
      break;
    }

    case 'stop': {
      console.log(`Stopping ${provider.displayName}...\n`);
      await provider.stop?.(progressLogger);
      break;
    }

    case 'download': {
      const actionId = rest.join(':');
      console.log(`Downloading model for ${provider.displayName}...\n`);

      if (provider.name === 'stable-diffusion') {
        console.log(
          'This will download sd_xl_base_1.0.safetensors (~6.5 GB) from Hugging Face.\n',
        );
      } else {
        console.log('This may download multiple files from HuggingFace.\n');
      }

      const success = await provider.downloadModel?.(actionId, progressLogger);

      if (success) {
        console.log('\nModel downloaded successfully!');
        if (provider.name === 'comfyui') {
          console.log('Start the ComfyUI server and the tunnel to use it.');
        }
      } else {
        console.log('\nDownload failed. Check the errors above.');
        if (provider.name === 'stable-diffusion') {
          const sdPath =
            getStableDiffusionInstallPath() || 'sd-webui-forge-neo';
          console.log(
            'You can also download SDXL models from https://civitai.com/models',
          );
          console.log('Filter by "SDXL 1.0" and place .safetensors files in:');
          console.log(`  ${sdPath}/models/Stable-diffusion/`);
        }
      }
      break;
    }

    default:
      console.error(`Unknown operation: ${operation}`);
  }

  await waitForEnter();
}
