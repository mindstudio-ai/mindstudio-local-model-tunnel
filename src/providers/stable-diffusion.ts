import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';
import {
  getStableDiffusionBaseUrl,
  getStableDiffusionInstallPath,
  setStableDiffusionInstallPath,
} from '../config.js';
import {
  commandExists,
  getPythonVersion,
  isPythonVersionOk,
  detectCudaVersion,
  runKillCommand,
  downloadFile,
} from './utils.js';
import type {
  ImageProvider,
  LocalModel,
  ImageGenerationOptions,
  ImageGenerationResult,
  ImageGenerationProgress,
  ParameterSchema,
  ProviderSetupStatus,
  LifecycleProgressCallback,
  ModelAction,
} from './types.js';

const execAsync = promisify(exec);

/**
 * Response from AUTOMATIC1111's /sdapi/v1/sd-models endpoint
 */
interface SDModel {
  title: string;
  model_name: string;
  hash?: string;
  sha256?: string;
  filename: string;
}

/**
 * Response from AUTOMATIC1111's /sdapi/v1/txt2img endpoint
 */
interface Txt2ImgResponse {
  images: string[];
  parameters: Record<string, unknown>;
  info: string;
}

/**
 * Response from AUTOMATIC1111's /sdapi/v1/progress endpoint
 */
interface ProgressResponse {
  progress: number;
  eta_relative: number;
  state: {
    skipped: boolean;
    interrupted: boolean;
    job: string;
    job_count: number;
    job_timestamp: string;
    job_no: number;
    sampling_step: number;
    sampling_steps: number;
  };
  current_image?: string;
  textinfo?: string;
}

/**
 * Response from AUTOMATIC1111's /sdapi/v1/samplers endpoint
 */
interface SDSampler {
  name: string;
  aliases: string[];
  options: Record<string, unknown>;
}

/**
 * Stable Diffusion provider for AUTOMATIC1111 WebUI
 * Default URL: http://127.0.0.1:7860
 */
export class StableDiffusionProvider implements ImageProvider {
  readonly name = 'stable-diffusion' as const;
  readonly displayName = 'Stable Diffusion Forge Neo';
  readonly description = 'Image generation';
  readonly capability = 'image' as const;
  readonly requiresTerminalForStart = true;
  readonly requiresTerminalForStop = true;

  private getBaseUrl(): string {
    return getStableDiffusionBaseUrl();
  }

  async isRunning(): Promise<boolean> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/sdapi/v1/sd-models`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async discoverModels(): Promise<LocalModel[]> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/sdapi/v1/sd-models`);

      if (!response.ok) {
        return [];
      }

      const models = (await response.json()) as SDModel[];

      return models.map((m) => ({
        name: m.model_name,
        provider: this.name,
        capability: 'image' as const,
      }));
    } catch {
      return [];
    }
  }

  async detect(): Promise<ProviderSetupStatus> {
    const savedPath = getStableDiffusionInstallPath();

    const possiblePaths = [
      ...(savedPath ? [savedPath] : []),
      path.join(os.homedir(), 'sd-webui-forge-neo'),
      path.join(os.homedir(), 'sd-webui-forge-classic'),
      path.join(os.homedir(), 'stable-diffusion-webui-forge'),
      path.join(os.homedir(), 'sd-forge'),
      path.join(os.homedir(), 'Projects', 'sd-webui-forge-neo'),
      path.join(os.homedir(), 'Code', 'sd-webui-forge-neo'),
    ];

    let installed = false;
    for (const p of possiblePaths) {
      if (
        fs.existsSync(path.join(p, 'launch.py')) ||
        fs.existsSync(path.join(p, 'webui.sh')) ||
        fs.existsSync(path.join(p, 'webui.bat'))
      ) {
        installed = true;
        break;
      }
    }

    let running = false;
    try {
      const response = await fetch('http://127.0.0.1:7860/sdapi/v1/sd-models', {
        signal: AbortSignal.timeout(1000),
      });
      running = response.ok;
      if (running) installed = true;
    } catch {
      running = false;
    }

    const hasGit = await commandExists('git');
    const hasPython =
      (await commandExists('python3')) || (await commandExists('python'));

    let warning: string | undefined;
    if (hasPython && !running) {
      try {
        const pyInfo = await getPythonVersion();
        if (pyInfo && !isPythonVersionOk(pyInfo)) {
          warning = `Python ${pyInfo.version} detected, Forge Neo requires 3.13+`;
        }
      } catch {
        // Ignore
      }
    }

    return {
      installed,
      running,
      installable: hasGit && hasPython && process.platform !== 'win32',
      warning,
    };
  }

  async install(
    onProgress: LifecycleProgressCallback,
    installDir?: string,
  ): Promise<boolean> {
    const targetDir = installDir || path.join(os.homedir(), 'sd-webui-forge-neo');

    try {
      onProgress({
        stage: 'clone',
        message:
          'Cloning Stable Diffusion Forge Neo repository (this may take a while)...',
      });

      await new Promise<void>((resolve, reject) => {
        const proc = spawn(
          'git',
          [
            'clone',
            '--progress',
            '--branch',
            'neo',
            'https://github.com/Haoming02/sd-webui-forge-classic.git',
            targetDir,
          ],
          { stdio: 'inherit' },
        );

        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Git clone exited with code ${code}`));
        });

        proc.on('error', (err) => reject(err));
      });

      setStableDiffusionInstallPath(targetDir);

      onProgress({
        stage: 'complete',
        message: `Installed to ${targetDir}`,
        complete: true,
      });

      onProgress({
        stage: 'info',
        message: `To start: cd "${targetDir}" && python launch.py --api`,
      });

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      if (message.includes('already exists') || message.includes('code 128')) {
        setStableDiffusionInstallPath(targetDir);
        onProgress({
          stage: 'complete',
          message: 'Already installed!',
          complete: true,
        });
        return true;
      }

      onProgress({
        stage: 'error',
        message: 'Installation failed',
        error: message,
      });
      return false;
    }
  }

  async start(onProgress: LifecycleProgressCallback): Promise<boolean> {
    const installPath = getStableDiffusionInstallPath();

    if (!installPath) {
      onProgress({
        stage: 'error',
        message: 'Stable Diffusion install path not found',
        error: 'Please install Stable Diffusion first',
      });
      return false;
    }

    try {
      const pyInfo = await getPythonVersion();
      if (!pyInfo) {
        onProgress({
          stage: 'error',
          message: 'Python not found',
          error: [
            chalk.white(
              'Python is not installed. Forge Neo requires Python 3.13+.',
            ),
            chalk.cyan('Install from https://www.python.org/downloads/'),
          ].join('\n'),
        });
        return false;
      }

      if (!isPythonVersionOk(pyInfo)) {
        onProgress({
          stage: 'error',
          message: `Python ${pyInfo.version} is too old`,
          error: [
            chalk.white(
              `Forge Neo requires Python 3.13+. You have ${pyInfo.version}.`,
            ),
            '',
            chalk.yellow('How to fix:'),
            chalk.white('  Install Python 3.13: ') +
              chalk.cyan('https://www.python.org/downloads/'),
            chalk.white('  If using pyenv: ') +
              chalk.cyan('pyenv install 3.13.12 && pyenv global 3.13.12'),
            chalk.white('  Then delete the old venv: ') +
              chalk.cyan(`rm -rf ${installPath}/venv`),
          ].join('\n'),
        });
        return false;
      }

      onProgress({
        stage: 'start',
        message: `Starting Stable Diffusion server (Python ${pyInfo.version})...`,
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const isWindows = process.platform === 'win32';

      // Detect CUDA version for PyTorch build selection
      let cudaEnv: Record<string, string> = {};
      const cuda = await detectCudaVersion();
      if (cuda && cuda.cuTag !== 'cu130') {
        onProgress({
          stage: 'start',
          message: `Driver supports CUDA ${cuda.major}.${cuda.minor}, using PyTorch with ${cuda.cuTag}`,
        });
        const torchIndexUrl = `https://download.pytorch.org/whl/${cuda.cuTag}`;
        cudaEnv = {
          TORCH_INDEX_URL: torchIndexUrl,
          TORCH_COMMAND: `pip install torch torchvision --extra-index-url ${torchIndexUrl}`,
        };
        await new Promise((r) => setTimeout(r, 1000));
      }

      const env = { ...process.env, ...cudaEnv };

      // Check if existing venv has wrong PyTorch CUDA bindings
      if (!isWindows && cudaEnv.TORCH_INDEX_URL) {
        const venvPythonCheck = path.join(installPath, 'venv', 'bin', 'python');
        if (fs.existsSync(venvPythonCheck)) {
          try {
            const { stdout: torchCheck } = await execAsync(
              `"${venvPythonCheck}" -c "import torch; print(torch.version.cuda or 'none')"`,
            );
            const installedCuda = torchCheck.trim();
            const targetCu = cudaEnv.TORCH_INDEX_URL.split('/').pop() || '';
            const installedCuTag =
              'cu' + installedCuda.replace('.', '').replace(/0$/, '');
            if (installedCuTag !== targetCu) {
              onProgress({
                stage: 'start',
                message: `Existing venv has PyTorch for CUDA ${installedCuda}, recreating with ${targetCu}...`,
              });
              await new Promise((r) => setTimeout(r, 1000));
              fs.rmSync(path.join(installPath, 'venv'), {
                recursive: true,
                force: true,
              });
            }
          } catch {
            // torch not installed in venv yet
          }
        }
      }

      return new Promise((resolve) => {
        let proc: ReturnType<typeof spawn>;

        if (isWindows) {
          proc = spawn('cmd', ['/c', 'webui-user.bat'], {
            cwd: installPath,
            stdio: 'inherit',
            env,
          });
        } else {
          const venvDir = path.join(installPath, 'venv');
          const venvPython = path.join(venvDir, 'bin', 'python');

          const launchScript = [
            `if [ ! -f "${venvPython}" ]; then`,
            `  echo "Creating virtual environment with Python ${pyInfo.version}..."`,
            `  "${pyInfo.executable}" -m venv "${venvDir}"`,
            `fi`,
            `source "${venvDir}/bin/activate"`,
            `python launch.py --api`,
          ].join('\n');

          proc = spawn('bash', ['-c', launchScript], {
            cwd: installPath,
            stdio: 'inherit',
            env,
          });
        }

        // Poll for server readiness
        const pollForReady = async () => {
          const maxWaitTime = 15 * 60 * 1000;
          const pollInterval = 5000;
          const startTime = Date.now();

          while (Date.now() - startTime < maxWaitTime) {
            await new Promise((r) => setTimeout(r, pollInterval));

            try {
              const response = await fetch(
                'http://127.0.0.1:7860/sdapi/v1/sd-models',
                { signal: AbortSignal.timeout(3000) },
              );
              if (response.ok) {
                console.log('\n\n✓ Stable Diffusion server is ready!\n');
                console.log(
                  chalk.yellow(
                    'Please leave this terminal running and open another terminal to run mindstudio-local.\n',
                  ),
                );
                console.log(
                  'Press Ctrl+C to stop the server and return to the menu.\n',
                );
                return;
              }
            } catch {
              // Not ready yet
            }
          }
        };

        pollForReady();

        proc.on('close', (code) => {
          if (code === 0) {
            onProgress({
              stage: 'complete',
              message: 'Stable Diffusion server stopped.',
              complete: true,
            });
            resolve(true);
          } else {
            onProgress({
              stage: 'error',
              message: 'Stable Diffusion failed to start',
              error: [
                `Process exited with code ${code}. Check the output above for details.`,
                '',
                chalk.yellow('Common fixes:'),
                chalk.cyan(`  - Delete the venv and retry: `) +
                  chalk.cyan(`rm -rf ${installPath}/venv`),
                chalk.cyan('  - Ensure Python 3.13+ is installed'),
                chalk.cyan('  - Ensure NVIDIA drivers and CUDA are up to date'),
              ].join('\n'),
            });
            resolve(false);
          }
        });

        proc.on('error', (err) => {
          onProgress({
            stage: 'error',
            message: 'Failed to start',
            error: err.message,
          });
          resolve(false);
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      onProgress({
        stage: 'error',
        message: 'Failed to start Stable Diffusion',
        error: message,
      });
      return false;
    }
  }

  async stop(onProgress: LifecycleProgressCallback): Promise<boolean> {
    try {
      onProgress({
        stage: 'start',
        message: 'Stopping Stable Diffusion server...',
      });

      const isWindows = process.platform === 'win32';

      if (!isWindows) {
        onProgress({
          stage: 'info',
          message: 'You may be prompted for your password...',
        });
      }

      if (isWindows) {
        await runKillCommand(
          'taskkill /F /FI "IMAGENAME eq python.exe" /FI "WINDOWTITLE eq *launch*" 2>nul || exit 0',
        );
        await runKillCommand(
          'taskkill /F /FI "IMAGENAME eq python.exe" /FI "WINDOWTITLE eq *webui*" 2>nul || exit 0',
        );
      } else {
        await runKillCommand("pkill -f 'python.*launch.py' || true");
        await runKillCommand("pkill -f 'python.*webui.py' || true");
        await runKillCommand("pkill -f 'stable-diffusion-webui' || true");
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));

      try {
        const response = await fetch('http://127.0.0.1:7860/sdapi/v1/sd-models', {
          signal: AbortSignal.timeout(2000),
        });
        if (response.ok) {
          onProgress({
            stage: 'complete',
            message:
              'Server may still be running. Try killing the process manually.',
            complete: true,
          });
          return false;
        }
      } catch {
        // Connection refused = server is stopped
      }

      onProgress({
        stage: 'complete',
        message: 'Stable Diffusion server stopped!',
        complete: true,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      onProgress({ stage: 'error', message: 'Failed to stop', error: message });
      return false;
    }
  }

  async getModelActions(): Promise<ModelAction[]> {
    const installPath = getStableDiffusionInstallPath();
    let installed = false;
    if (installPath) {
      const modelFile = path.join(
        installPath,
        'models',
        'Stable-diffusion',
        'sd_xl_base_1.0.safetensors',
      );
      installed = fs.existsSync(modelFile);
    }

    return [
      {
        id: 'sdxl-base',
        label: 'SDXL Base Model',
        installed,
        sizeLabel: '~6.5 GB',
        requiresTerminal: true,
      },
    ];
  }

  async downloadModel(
    actionId: string,
    onProgress: LifecycleProgressCallback,
  ): Promise<boolean> {
    if (actionId !== 'sdxl-base') {
      onProgress({
        stage: 'error',
        message: 'Unknown model',
        error: `Model ID "${actionId}" is not recognized`,
      });
      return false;
    }

    const installPath = getStableDiffusionInstallPath();

    if (!installPath) {
      onProgress({
        stage: 'error',
        message: 'Stable Diffusion install path not found',
        error: 'Please install Stable Diffusion first',
      });
      return false;
    }

    const modelsDir = path.join(installPath, 'models', 'Stable-diffusion');
    const modelUrl =
      'https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors';
    const modelFile = path.join(modelsDir, 'sd_xl_base_1.0.safetensors');

    try {
      fs.mkdirSync(modelsDir, { recursive: true });

      if (fs.existsSync(modelFile)) {
        onProgress({
          stage: 'complete',
          message: 'SDXL base model already exists!',
          complete: true,
        });
        return true;
      }

      onProgress({
        stage: 'download',
        message: 'Downloading SDXL base model (~6.5 GB)...',
      });

      const success = await downloadFile(modelUrl, modelFile, onProgress);

      if (success) {
        onProgress({
          stage: 'complete',
          message: 'SDXL base model downloaded!',
          complete: true,
        });
      } else {
        onProgress({
          stage: 'error',
          message: 'Download failed',
          error: 'The model may require accepting the license at huggingface.co first. You can also download manually from Civitai.',
        });
      }

      return success;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      onProgress({
        stage: 'error',
        message: 'Failed to download model',
        error: message,
      });
      return false;
    }
  }

  /**
   * Get the currently loaded model
   */
  async getCurrentModel(): Promise<string | null> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/sdapi/v1/options`);
      if (!response.ok) return null;

      const options = (await response.json()) as {
        sd_model_checkpoint?: string;
      };
      return options.sd_model_checkpoint || null;
    } catch {
      return null;
    }
  }

  /**
   * Switch to a different model
   */
  async setModel(modelName: string): Promise<void> {
    const response = await fetch(`${this.getBaseUrl()}/sdapi/v1/options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sd_model_checkpoint: modelName }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to switch model: ${error}`);
    }
  }

  async generateImage(
    model: string,
    prompt: string,
    options?: ImageGenerationOptions,
  ): Promise<ImageGenerationResult> {
    const currentModel = await this.getCurrentModel();
    if (currentModel && !currentModel.includes(model)) {
      await this.setModel(model);
    }

    const payload = {
      prompt,
      negative_prompt: options?.negativePrompt || '',
      steps: options?.steps || 20,
      width: options?.width || 512,
      height: options?.height || 512,
      cfg_scale: options?.cfgScale || 7,
      seed: options?.seed ?? -1,
      sampler_name: options?.sampler || 'Euler a',
    };

    const response = await fetch(`${this.getBaseUrl()}/sdapi/v1/txt2img`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Image generation failed: ${response.status} ${error}`);
    }

    const result = (await response.json()) as Txt2ImgResponse;

    if (!result.images || result.images.length === 0) {
      throw new Error('No images returned from Stable Diffusion');
    }

    let info: Record<string, unknown> = {};
    let seed: number | undefined;
    try {
      info = JSON.parse(result.info);
      seed = typeof info.seed === 'number' ? info.seed : undefined;
    } catch {
      // Ignore parse errors
    }

    return {
      imageBase64: result.images[0],
      mimeType: 'image/png',
      seed,
      info,
    };
  }

  async generateImageWithProgress(
    model: string,
    prompt: string,
    options?: ImageGenerationOptions,
    onProgress?: (progress: ImageGenerationProgress) => void,
  ): Promise<ImageGenerationResult> {
    const generatePromise = this.generateImage(model, prompt, options);

    if (onProgress) {
      const pollProgress = async () => {
        while (true) {
          try {
            const response = await fetch(
              `${this.getBaseUrl()}/sdapi/v1/progress`,
            );
            if (!response.ok) break;

            const progress = (await response.json()) as ProgressResponse;

            onProgress({
              step: progress.state.sampling_step,
              totalSteps: progress.state.sampling_steps,
              preview: progress.current_image,
            });

            if (progress.progress >= 1.0) break;

            await new Promise((resolve) => setTimeout(resolve, 500));
          } catch {
            break;
          }
        }
      };

      pollProgress().catch(() => {});
    }

    return generatePromise;
  }

  /**
   * Fetch available samplers from the backend
   */
  private async getSamplers(): Promise<string[]> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/sdapi/v1/samplers`);
      if (!response.ok) return this.getDefaultSamplers();

      const samplers = (await response.json()) as SDSampler[];
      return samplers.map((s) => s.name);
    } catch {
      return this.getDefaultSamplers();
    }
  }

  private getDefaultSamplers(): string[] {
    return [
      'Euler a',
      'Euler',
      'LMS',
      'Heun',
      'DPM2',
      'DPM2 a',
      'DPM++ 2S a',
      'DPM++ 2M',
      'DPM++ SDE',
      'DPM fast',
      'DPM adaptive',
      'LMS Karras',
      'DPM2 Karras',
      'DPM2 a Karras',
      'DPM++ 2S a Karras',
      'DPM++ 2M Karras',
      'DPM++ SDE Karras',
      'DDIM',
      'PLMS',
      'UniPC',
    ];
  }

  private generateDimensionOptions(): Array<{ label: string; value: string }> {
    const options: Array<{ label: string; value: string }> = [];
    for (let size = 256; size <= 2048; size += 64) {
      options.push({
        label: `${size}px`,
        value: String(size),
      });
    }
    return options;
  }

  async getParameterSchemas(): Promise<ParameterSchema[]> {
    const samplers = await this.getSamplers();
    const dimensionOptions = this.generateDimensionOptions();

    return [
      {
        type: 'select',
        label: 'Sampler',
        variable: 'sampler',
        helpText: 'The sampling method used for image generation',
        defaultValue: 'Euler a',
        selectOptions: samplers.map((name) => ({
          label: name,
          value: name,
        })),
      },
      {
        type: 'select',
        label: 'Width',
        variable: 'width',
        defaultValue: '512',
        selectOptions: dimensionOptions,
      },
      {
        type: 'select',
        label: 'Height',
        variable: 'height',
        defaultValue: '512',
        selectOptions: dimensionOptions,
      },
      {
        type: 'number',
        label: 'Steps',
        variable: 'steps',
        helpText:
          'Number of denoising steps. More steps = higher quality but slower.',
        defaultValue: 20,
        numberOptions: {
          min: 1,
          max: 150,
          step: 1,
        },
      },
      {
        type: 'number',
        label: 'CFG Scale',
        variable: 'cfgScale',
        helpText:
          'How strongly the image should follow the prompt. Higher = more literal.',
        defaultValue: 7,
        numberOptions: {
          min: 1,
          max: 30,
          step: 0.5,
        },
      },
      {
        type: 'number',
        label: 'Seed',
        variable: 'seed',
        helpText:
          "A specific value used to guide the 'randomness' of generation. Use -1 for random.",
        defaultValue: -1,
        numberOptions: {
          min: -1,
          max: 2147483647,
        },
      },
      {
        type: 'text',
        label: 'Negative Prompt',
        variable: 'negativePrompt',
        helpText: "Things you don't want in the image",
        placeholder: 'blurry, low quality, distorted',
      },
    ];
  }
}
