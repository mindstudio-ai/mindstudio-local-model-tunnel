import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';
import { getComfyUIBaseUrl, getComfyUIInstallPath, setComfyUIInstallPath } from '../config.js';
import { getWorkflowForModel, isKnownVideoModel } from '../workflows/index.js';
import {
  commandExists,
  getPythonVersion,
  detectCudaVersion,
  runKillCommand,
  downloadFile,
} from './utils.js';
import type {
  VideoProvider,
  LocalModel,
  VideoGenerationOptions,
  VideoGenerationResult,
  VideoGenerationProgress,
  ParameterSchema,
  ProviderSetupStatus,
  LifecycleProgressCallback,
  ModelAction,
} from './types.js';

/** Model download definitions for ComfyUI */
interface ComfyUIModelDownload {
  id: string;
  label: string;
  files: Array<{
    url: string;
    dest: string;
    filename: string;
    sizeLabel: string;
  }>;
}

const COMFYUI_MODELS: ComfyUIModelDownload[] = [
  {
    id: 'ltx-video',
    label: 'LTX-Video 2B',
    files: [
      {
        url: 'https://huggingface.co/Lightricks/LTX-Video/resolve/main/ltx-video-2b-v0.9.5.safetensors',
        dest: 'models/checkpoints',
        filename: 'ltx-video-2b-v0.9.5.safetensors',
        sizeLabel: '~6 GB',
      },
      {
        url: 'https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp16.safetensors',
        dest: 'models/text_encoders',
        filename: 't5xxl_fp16.safetensors',
        sizeLabel: '~10 GB',
      },
    ],
  },
  {
    id: 'wan2.1-t2v',
    label: 'Wan 2.1 T2V 1.3B',
    files: [
      {
        url: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_t2v_1.3B_fp16.safetensors',
        dest: 'models/diffusion_models',
        filename: 'wan2.1_t2v_1.3B_fp16.safetensors',
        sizeLabel: '~2.6 GB',
      },
      {
        url: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors',
        dest: 'models/text_encoders',
        filename: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
        sizeLabel: '~5 GB',
      },
      {
        url: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors',
        dest: 'models/vae',
        filename: 'wan_2.1_vae.safetensors',
        sizeLabel: '~0.3 GB',
      },
    ],
  },
];

/**
 * ComfyUI provider for video generation.
 * Default URL: http://127.0.0.1:8188
 */
export class ComfyUIProvider implements VideoProvider {
  readonly name = 'comfyui' as const;
  readonly displayName = 'ComfyUI';
  readonly description = 'Video generation (LTX-Video, Wan2.1)';
  readonly capability = 'video' as const;
  readonly requiresTerminalForStart = true;
  readonly requiresTerminalForStop = true;

  private getBaseUrl(): string {
    return getComfyUIBaseUrl();
  }

  async isRunning(): Promise<boolean> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/system_stats`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async detect(): Promise<ProviderSetupStatus> {
    const savedPath = getComfyUIInstallPath();

    const possiblePaths = [
      ...(savedPath ? [savedPath] : []),
      path.join(os.homedir(), 'ComfyUI'),
      path.join(os.homedir(), 'comfyui'),
      path.join(os.homedir(), 'Projects', 'ComfyUI'),
      path.join(os.homedir(), 'Code', 'ComfyUI'),
    ];

    let installed = false;
    for (const p of possiblePaths) {
      if (
        fs.existsSync(path.join(p, 'main.py')) &&
        fs.existsSync(path.join(p, 'requirements.txt'))
      ) {
        installed = true;
        break;
      }
    }

    let running = false;
    try {
      const response = await fetch('http://127.0.0.1:8188/system_stats', {
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

    return {
      installed,
      running,
      installable: hasGit && hasPython && process.platform !== 'win32',
    };
  }

  async install(
    onProgress: LifecycleProgressCallback,
    installPath?: string,
  ): Promise<boolean> {
    const targetPath = installPath || path.join(os.homedir(), 'ComfyUI');

    try {
      onProgress({ stage: 'start', message: 'Cloning ComfyUI repository...' });

      await new Promise<void>((resolve, reject) => {
        const proc = spawn(
          'git',
          ['clone', 'https://github.com/comfyanonymous/ComfyUI.git', targetPath],
          { stdio: 'inherit' },
        );
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`git clone failed with code ${code}`));
        });
        proc.on('error', reject);
      });

      onProgress({ stage: 'venv', message: 'Creating virtual environment...' });

      const pyInfo = await getPythonVersion();
      const pythonCmd = pyInfo?.executable || 'python3';

      await new Promise<void>((resolve, reject) => {
        const proc = spawn(
          pythonCmd,
          ['-m', 'venv', path.join(targetPath, 'venv')],
          { stdio: 'inherit' },
        );
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`venv creation failed with code ${code}`));
        });
        proc.on('error', reject);
      });

      onProgress({
        stage: 'deps',
        message: 'Installing dependencies (this may take a while)...',
      });

      // Detect CUDA version for PyTorch index URL
      let pipExtraArgs: string[] = [];
      const cuda = await detectCudaVersion();
      if (cuda) {
        pipExtraArgs = [
          '--extra-index-url',
          `https://download.pytorch.org/whl/${cuda.cuTag}`,
        ];
        onProgress({
          stage: 'deps',
          message: `Driver supports CUDA ${cuda.major}.${cuda.minor}, using PyTorch with ${cuda.cuTag}`,
        });
      }

      const isWindows = process.platform === 'win32';
      const pipPath = isWindows
        ? path.join(targetPath, 'venv', 'Scripts', 'pip')
        : path.join(targetPath, 'venv', 'bin', 'pip');

      await new Promise<void>((resolve, reject) => {
        const args = [
          'install',
          '-r',
          path.join(targetPath, 'requirements.txt'),
          ...pipExtraArgs,
        ];
        const proc = spawn(pipPath, args, { stdio: 'inherit', cwd: targetPath });
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`pip install failed with code ${code}`));
        });
        proc.on('error', reject);
      });

      // Install custom nodes
      await this.installCustomNodes(targetPath, onProgress);

      setComfyUIInstallPath(targetPath);

      onProgress({
        stage: 'complete',
        message: 'ComfyUI installed successfully!',
        complete: true,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      onProgress({
        stage: 'error',
        message: 'ComfyUI installation failed',
        error: message,
      });
      return false;
    }
  }

  /**
   * Install required ComfyUI custom nodes.
   */
  private async installCustomNodes(
    installPath: string,
    onProgress: LifecycleProgressCallback,
  ): Promise<void> {
    const customNodes = [
      {
        url: 'https://github.com/Lightricks/ComfyUI-LTXVideo.git',
        dirName: 'ComfyUI-LTXVideo',
      },
      {
        url: 'https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git',
        dirName: 'ComfyUI-VideoHelperSuite',
      },
    ];

    const customNodesDir = path.join(installPath, 'custom_nodes');
    if (!fs.existsSync(customNodesDir)) {
      fs.mkdirSync(customNodesDir, { recursive: true });
    }

    for (const node of customNodes) {
      const nodeDir = path.join(customNodesDir, node.dirName);
      if (fs.existsSync(nodeDir)) {
        onProgress({
          stage: 'complete',
          message: `${node.dirName} already installed, skipping.`,
        });
        continue;
      }

      onProgress({
        stage: 'start',
        message: `Installing ${node.dirName}...`,
      });

      await new Promise<void>((resolve, reject) => {
        const proc = spawn('git', ['clone', node.url, nodeDir], {
          stdio: 'inherit',
        });
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`git clone ${node.dirName} failed with code ${code}`));
        });
        proc.on('error', reject);
      });

      const reqFile = path.join(nodeDir, 'requirements.txt');
      if (fs.existsSync(reqFile)) {
        const isWindows = process.platform === 'win32';
        const pipPath = isWindows
          ? path.join(installPath, 'venv', 'Scripts', 'pip')
          : path.join(installPath, 'venv', 'bin', 'pip');

        await new Promise<void>((resolve, reject) => {
          const proc = spawn(pipPath, ['install', '-r', reqFile], {
            stdio: 'inherit',
          });
          proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`pip install ${node.dirName} deps failed with code ${code}`));
          });
          proc.on('error', reject);
        });
      }
    }
  }

  async start(onProgress: LifecycleProgressCallback): Promise<boolean> {
    const installPath = getComfyUIInstallPath();
    if (!installPath) {
      onProgress({
        stage: 'error',
        message: 'ComfyUI not installed',
        error: 'Install ComfyUI first',
      });
      return false;
    }

    try {
      onProgress({ stage: 'start', message: 'Starting ComfyUI server...' });
      await new Promise((r) => setTimeout(r, 500));

      const isWindows = process.platform === 'win32';

      return new Promise((resolve) => {
        let proc: ReturnType<typeof spawn>;

        if (isWindows) {
          const venvPython = path.join(
            installPath,
            'venv',
            'Scripts',
            'python.exe',
          );
          proc = spawn(venvPython, ['main.py', '--listen', '--port', '8188'], {
            cwd: installPath,
            stdio: 'inherit',
          });
        } else {
          const venvDir = path.join(installPath, 'venv');
          const launchScript = [
            `source "${venvDir}/bin/activate"`,
            `python main.py --listen --port 8188`,
          ].join('\n');

          proc = spawn('bash', ['-c', launchScript], {
            cwd: installPath,
            stdio: 'inherit',
          });
        }

        proc.on('close', (code) => {
          if (code === 0) {
            onProgress({
              stage: 'complete',
              message: 'ComfyUI server stopped.',
              complete: true,
            });
            resolve(true);
          } else {
            onProgress({
              stage: 'error',
              message: 'ComfyUI failed to start',
              error: [
                `Process exited with code ${code}. Check the output above.`,
                '',
                chalk.yellow('Common fixes:'),
                chalk.white('  - Delete the venv and retry: ') +
                  chalk.cyan(`rm -rf ${installPath}/venv`),
                chalk.white('  - Ensure Python 3.10+ is installed'),
                chalk.white('  - Ensure NVIDIA drivers and CUDA are up to date'),
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
      onProgress({ stage: 'error', message: 'Failed to start', error: message });
      return false;
    }
  }

  async stop(onProgress: LifecycleProgressCallback): Promise<boolean> {
    try {
      onProgress({ stage: 'start', message: 'Stopping ComfyUI server...' });

      const isWindows = process.platform === 'win32';

      if (!isWindows) {
        onProgress({
          stage: 'start',
          message: 'You may be prompted for your password...',
        });
      }

      if (isWindows) {
        await runKillCommand(
          'taskkill /F /FI "IMAGENAME eq python.exe" /FI "WINDOWTITLE eq *ComfyUI*" 2>nul || exit 0',
        );
      } else {
        await runKillCommand("pkill -f 'python.*main.py.*--port 8188' || true");
        await runKillCommand("pkill -f 'python.*main.py.*comfyui' || true");
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));

      try {
        const response = await fetch('http://127.0.0.1:8188/system_stats', {
          signal: AbortSignal.timeout(2000),
        });
        if (response.ok) {
          onProgress({
            stage: 'complete',
            message: 'ComfyUI may still be running.',
            complete: true,
          });
          return false;
        }
      } catch {
        // Stopped
      }

      onProgress({
        stage: 'complete',
        message: 'ComfyUI server stopped!',
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
    const installPath = getComfyUIInstallPath();

    return COMFYUI_MODELS.map((model) => {
      let installed = false;
      if (installPath) {
        installed = model.files.every((file) =>
          fs.existsSync(path.join(installPath, file.dest, file.filename)),
        );
      }

      return {
        id: model.id,
        label: model.label,
        installed,
        sizeLabel: model.files.map((f) => f.sizeLabel).join(' + '),
        requiresTerminal: true,
      };
    });
  }

  async downloadModel(
    modelId: string,
    onProgress: LifecycleProgressCallback,
  ): Promise<boolean> {
    const installPath = getComfyUIInstallPath();
    if (!installPath) {
      onProgress({
        stage: 'error',
        message: 'ComfyUI not installed',
        error: 'Install ComfyUI first',
      });
      return false;
    }

    const modelDef = COMFYUI_MODELS.find((m) => m.id === modelId);
    if (!modelDef) {
      onProgress({
        stage: 'error',
        message: 'Unknown model',
        error: `Model ID "${modelId}" is not recognized`,
      });
      return false;
    }

    try {
      for (let i = 0; i < modelDef.files.length; i++) {
        const file = modelDef.files[i];
        const destDir = path.join(installPath, file.dest);
        const destFile = path.join(destDir, file.filename);

        if (fs.existsSync(destFile)) {
          onProgress({
            stage: 'download',
            message: `[${i + 1}/${modelDef.files.length}] ${file.filename} already exists, skipping.`,
          });
          continue;
        }

        fs.mkdirSync(destDir, { recursive: true });

        onProgress({
          stage: 'download',
          message: `[${i + 1}/${modelDef.files.length}] Downloading ${file.filename} (${file.sizeLabel})...`,
        });

        const success = await downloadFile(file.url, destFile, onProgress);
        if (!success) {
          onProgress({
            stage: 'error',
            message: 'Download failed',
            error: `Failed to download ${file.filename}`,
          });
          return false;
        }
      }

      onProgress({
        stage: 'complete',
        message: `${modelDef.label} model downloaded successfully!`,
        complete: true,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      onProgress({
        stage: 'error',
        message: 'Download failed',
        error: message,
      });
      return false;
    }
  }

  /**
   * Discover video models by scanning ComfyUI's model directories.
   */
  async discoverModels(): Promise<LocalModel[]> {
    const models: LocalModel[] = [];

    try {
      const response = await fetch(
        `${this.getBaseUrl()}/object_info/CheckpointLoaderSimple`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        const nodeInfo = data.CheckpointLoaderSimple as {
          input?: { required?: { ckpt_name?: [string[]] } };
        };
        const checkpoints = nodeInfo?.input?.required?.ckpt_name?.[0] || [];
        for (const name of checkpoints) {
          if (isKnownVideoModel(name)) {
            const workflow = getWorkflowForModel(name);
            models.push({
              name: name,
              provider: this.name,
              capability: 'video',
              parameterSize: workflow?.displayName,
            });
          }
        }
      }
    } catch {
      // API not available
    }

    try {
      const response = await fetch(
        `${this.getBaseUrl()}/object_info/UNETLoader`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        const nodeInfo = data.UNETLoader as {
          input?: { required?: { unet_name?: [string[]] } };
        };
        const unetModels = nodeInfo?.input?.required?.unet_name?.[0] || [];
        for (const name of unetModels) {
          if (isKnownVideoModel(name) && !models.some((m) => m.name === name)) {
            const workflow = getWorkflowForModel(name);
            models.push({
              name: name,
              provider: this.name,
              capability: 'video',
              parameterSize: workflow?.displayName,
            });
          }
        }
      }
    } catch {
      // Ignore
    }

    if (models.length === 0) {
      const installPath = getComfyUIInstallPath();
      if (installPath) {
        const dirs = [
          path.join(installPath, 'models', 'checkpoints'),
          path.join(installPath, 'models', 'diffusion_models'),
        ];
        for (const dir of dirs) {
          if (fs.existsSync(dir)) {
            try {
              const files = fs.readdirSync(dir);
              for (const file of files) {
                if (
                  isKnownVideoModel(file) &&
                  !models.some((m) => m.name === file)
                ) {
                  const workflow = getWorkflowForModel(file);
                  models.push({
                    name: file,
                    provider: this.name,
                    capability: 'video',
                    parameterSize: workflow?.displayName,
                  });
                }
              }
            } catch {
              // Ignore read errors
            }
          }
        }
      }
    }

    return models;
  }

  /**
   * Generate a video using ComfyUI.
   */
  async generateVideo(
    model: string,
    prompt: string,
    options?: VideoGenerationOptions,
    onProgress?: (progress: VideoGenerationProgress) => void,
  ): Promise<VideoGenerationResult> {
    const baseUrl = this.getBaseUrl();
    const workflowConfig = getWorkflowForModel(model);

    if (!workflowConfig) {
      throw new Error(
        `No workflow template found for model: ${model}. Supported families: LTX-Video, Wan2.1`,
      );
    }

    const defaults = workflowConfig.defaults;
    const seed =
      options?.seed !== undefined && options.seed !== -1
        ? options.seed
        : Math.floor(Math.random() * 2 ** 32);

    const workflow = workflowConfig.buildWorkflow({
      model,
      prompt,
      negativePrompt:
        options?.negativePrompt || 'worst quality, blurry, distorted',
      width: options?.width || defaults.width,
      height: options?.height || defaults.height,
      numFrames: options?.numFrames || defaults.numFrames,
      fps: options?.fps || defaults.fps,
      steps: options?.steps || defaults.steps,
      cfgScale: options?.cfgScale || defaults.cfgScale,
      seed,
    });

    const clientId = `mindstudio_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const wsUrl = baseUrl.replace(/^http/, 'ws') + `/ws?clientId=${clientId}`;

    const submitResponse = await fetch(`${baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: workflow,
        client_id: clientId,
      }),
    });

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      throw new Error(
        `ComfyUI prompt submission failed: ${submitResponse.status} ${errorText}`,
      );
    }

    const submitResult = (await submitResponse.json()) as {
      prompt_id: string;
      number: number;
      node_errors?: Record<string, unknown>;
    };

    if (
      submitResult.node_errors &&
      Object.keys(submitResult.node_errors).length > 0
    ) {
      throw new Error(
        `ComfyUI workflow validation failed: ${JSON.stringify(submitResult.node_errors)}`,
      );
    }

    const promptId = submitResult.prompt_id;

    await this.waitForCompletion(wsUrl, promptId, onProgress);

    const historyResponse = await fetch(`${baseUrl}/history/${promptId}`, {
      signal: AbortSignal.timeout(30000),
    });

    if (!historyResponse.ok) {
      throw new Error(
        `Failed to fetch result history: ${historyResponse.status}`,
      );
    }

    const history = (await historyResponse.json()) as Record<
      string,
      {
        outputs: Record<
          string,
          {
            images?: Array<{
              filename: string;
              subfolder: string;
              type: string;
            }>;
            gifs?: Array<{ filename: string; subfolder: string; type: string }>;
          }
        >;
      }
    >;

    const promptHistory = history[promptId];
    if (!promptHistory) {
      throw new Error('No result found in ComfyUI history');
    }

    const outputNodeId = workflowConfig.outputNodeId;
    const outputData = promptHistory.outputs[outputNodeId];
    const outputFiles = outputData?.gifs || outputData?.images;

    if (!outputFiles || outputFiles.length === 0) {
      throw new Error('No output files found in ComfyUI result');
    }

    const outputFile = outputFiles[0];

    const fileUrl = new URL(`${baseUrl}/view`);
    fileUrl.searchParams.set('filename', outputFile.filename);
    fileUrl.searchParams.set('subfolder', outputFile.subfolder || '');
    fileUrl.searchParams.set('type', outputFile.type || 'output');

    const fileResponse = await fetch(fileUrl.toString(), {
      signal: AbortSignal.timeout(60000),
    });

    if (!fileResponse.ok) {
      throw new Error(`Failed to download output file: ${fileResponse.status}`);
    }

    const fileBuffer = await fileResponse.arrayBuffer();
    const videoBase64 = Buffer.from(fileBuffer).toString('base64');

    const ext = path.extname(outputFile.filename).toLowerCase();
    const mimeType =
      ext === '.mp4'
        ? 'video/mp4'
        : ext === '.webm'
          ? 'video/webm'
          : ext === '.webp'
            ? 'image/webp'
            : ext === '.gif'
              ? 'image/gif'
              : 'video/mp4';

    const fps = options?.fps || defaults.fps;
    const numFrames = options?.numFrames || defaults.numFrames;

    return {
      videoBase64,
      mimeType,
      duration: numFrames / fps,
      fps,
      seed,
    };
  }

  /**
   * Wait for a ComfyUI prompt to finish execution via WebSocket.
   */
  private waitForCompletion(
    wsUrl: string,
    promptId: string,
    onProgress?: (progress: VideoGenerationProgress) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutMs = 30 * 60 * 1000;
      let ws: WebSocket;

      const timeout = setTimeout(() => {
        try {
          ws?.close();
        } catch {
          // Ignore
        }
        reject(new Error('Video generation timed out after 30 minutes'));
      }, timeoutMs);

      try {
        ws = new WebSocket(wsUrl);
      } catch (err) {
        clearTimeout(timeout);
        reject(
          new Error(
            `Failed to connect to ComfyUI WebSocket: ${err instanceof Error ? err.message : err}`,
          ),
        );
        return;
      }

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(
            typeof event.data === 'string' ? event.data : '',
          ) as {
            type: string;
            data: Record<string, unknown>;
          };

          if (message.type === 'progress') {
            const data = message.data as {
              value: number;
              max: number;
              prompt_id?: string;
              node?: string;
            };
            if (!data.prompt_id || data.prompt_id === promptId) {
              onProgress?.({
                step: data.value,
                totalSteps: data.max,
                currentNode: data.node as string | undefined,
              });
            }
          }

          if (message.type === 'execution_success') {
            const data = message.data as { prompt_id: string };
            if (data.prompt_id === promptId) {
              clearTimeout(timeout);
              ws.close();
              resolve();
            }
          }

          if (message.type === 'execution_error') {
            const data = message.data as {
              prompt_id: string;
              exception_message?: string;
              node_type?: string;
            };
            if (data.prompt_id === promptId) {
              clearTimeout(timeout);
              ws.close();
              reject(
                new Error(
                  `ComfyUI execution error${data.node_type ? ` in ${data.node_type}` : ''}: ${data.exception_message || 'Unknown error'}`,
                ),
              );
            }
          }
        } catch {
          // Ignore non-JSON messages
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('ComfyUI WebSocket error: connection failed'));
      };

      ws.onclose = (event) => {
        if (!event.wasClean) {
          clearTimeout(timeout);
          reject(new Error('ComfyUI WebSocket connection closed unexpectedly'));
        }
      };
    });
  }

  /**
   * Get parameter schemas for video generation UI configuration.
   */
  async getParameterSchemas(): Promise<ParameterSchema[]> {
    return [
      {
        type: 'number',
        label: 'Width',
        variable: 'width',
        helpText:
          'Video width in pixels. Larger = better quality but bigger file.',
        defaultValue: 512,
        numberOptions: { min: 256, max: 1280, step: 64 },
      },
      {
        type: 'number',
        label: 'Height',
        variable: 'height',
        helpText:
          'Video height in pixels. Larger = better quality but bigger file.',
        defaultValue: 320,
        numberOptions: { min: 256, max: 1280, step: 64 },
      },
      {
        type: 'number',
        label: 'Frames',
        variable: 'numFrames',
        helpText:
          'Number of frames to generate. More frames = longer video but bigger file. Keep low to avoid upload limits.',
        defaultValue: 41,
        numberOptions: { min: 9, max: 97, step: 8 },
      },
      {
        type: 'number',
        label: 'FPS',
        variable: 'fps',
        helpText: 'Frames per second for the output video.',
        defaultValue: 8,
        numberOptions: { min: 4, max: 30, step: 1 },
      },
      {
        type: 'number',
        label: 'Steps',
        variable: 'steps',
        helpText:
          'Number of denoising steps. More steps = higher quality but slower.',
        defaultValue: 20,
        numberOptions: { min: 10, max: 100, step: 1 },
      },
      {
        type: 'number',
        label: 'CFG Scale',
        variable: 'cfgScale',
        helpText:
          'How strongly the video should follow the prompt. Higher = more literal.',
        defaultValue: 7,
        numberOptions: { min: 1, max: 20, step: 0.5 },
      },
      {
        type: 'number',
        label: 'Seed',
        variable: 'seed',
        helpText:
          'A specific value used to guide randomness. Use -1 for random.',
        defaultValue: -1,
        numberOptions: { min: -1, max: 2147483647 },
      },
      {
        type: 'text',
        label: 'Negative Prompt',
        variable: 'negativePrompt',
        helpText: "Things you don't want in the video",
        placeholder: 'worst quality, blurry, distorted',
      },
    ];
  }
}
