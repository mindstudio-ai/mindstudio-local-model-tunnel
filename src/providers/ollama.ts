import { spawn } from 'child_process';
import { Ollama } from 'ollama';
import open from 'open';
import { getOllamaBaseUrl } from '../config.js';
import { commandExists, runKillCommand } from './utils.js';
import type {
  TextProvider,
  LocalModel,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ProviderSetupStatus,
  LifecycleProgressCallback,
} from './types.js';

export class OllamaProvider implements TextProvider {
  readonly name = 'ollama' as const;
  readonly displayName = 'Ollama';
  readonly description = 'Text generation (llama, mistral, etc.)';
  readonly capability = 'text' as const;
  readonly requiresTerminalForStart = false;
  readonly requiresTerminalForStop = true;

  private createClient(): Ollama {
    return new Ollama({ host: getOllamaBaseUrl() });
  }

  async isRunning(): Promise<boolean> {
    try {
      const client = this.createClient();
      await client.list();
      return true;
    } catch {
      return false;
    }
  }

  async discoverModels(): Promise<LocalModel[]> {
    try {
      const client = this.createClient();
      const response = await client.list();

      return response.models.map((m) => ({
        name: m.name,
        provider: this.name,
        capability: 'text' as const,
        size: m.size,
        parameterSize: m.details?.parameter_size,
        quantization: m.details?.quantization_level,
      }));
    } catch {
      return [];
    }
  }

  async detect(): Promise<ProviderSetupStatus> {
    const installed = await commandExists('ollama');
    let running = false;

    if (installed) {
      running = await this.isRunning();
    }

    return {
      installed,
      running,
      installable: process.platform !== 'win32',
    };
  }

  async install(onProgress: LifecycleProgressCallback): Promise<boolean> {
    if (process.platform === 'win32') {
      onProgress({
        stage: 'error',
        message: 'Auto-install not supported on Windows',
        error: 'Please download Ollama from https://ollama.com/download',
      });
      await open('https://ollama.com/download');
      return false;
    }

    try {
      onProgress({
        stage: 'download',
        message: 'Installing Ollama (you may be prompted for your password)...',
      });

      await new Promise<void>((resolve, reject) => {
        const proc = spawn(
          'bash',
          ['-c', 'curl -fsSL https://ollama.com/install.sh | sh'],
          { stdio: 'inherit' },
        );

        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Installation exited with code ${code}`));
        });

        proc.on('error', (err) => reject(err));
      });

      onProgress({
        stage: 'complete',
        message: 'Ollama installed successfully!',
        complete: true,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      onProgress({
        stage: 'error',
        message: 'Installation failed',
        error: message,
      });
      return false;
    }
  }

  async start(onProgress: LifecycleProgressCallback): Promise<boolean> {
    try {
      onProgress({ stage: 'start', message: 'Starting Ollama server...' });

      const proc = spawn('ollama', ['serve'], {
        detached: true,
        stdio: 'ignore',
      });
      proc.unref();

      await new Promise((resolve) => setTimeout(resolve, 2000));

      try {
        const response = await fetch('http://localhost:11434/api/tags', {
          signal: AbortSignal.timeout(2000),
        });
        if (response.ok) {
          onProgress({
            stage: 'complete',
            message: 'Ollama server started!',
            complete: true,
          });
          return true;
        }
      } catch {
        // Fall through
      }

      onProgress({
        stage: 'complete',
        message: 'Ollama starting in background...',
        complete: true,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      onProgress({ stage: 'error', message: 'Failed to start', error: message });
      return false;
    }
  }

  async stop(onProgress: LifecycleProgressCallback): Promise<boolean> {
    try {
      onProgress({ stage: 'start', message: 'Stopping Ollama server...' });

      const isWindows = process.platform === 'win32';

      if (!isWindows) {
        onProgress({
          stage: 'info',
          message: 'You may be prompted for your password...',
        });
      }

      if (isWindows) {
        await runKillCommand('taskkill /F /IM ollama.exe 2>nul || exit 0');
        await runKillCommand(
          'taskkill /F /FI "IMAGENAME eq ollama_runners*" 2>nul || exit 0',
        );
      } else {
        await runKillCommand('systemctl stop ollama 2>/dev/null || true');
        await runKillCommand("pkill -f 'ollama serve' || true");
        await runKillCommand('killall ollama 2>/dev/null || true');
        await runKillCommand('pkill ollama || true');
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));

      try {
        const response = await fetch('http://localhost:11434/api/tags', {
          signal: AbortSignal.timeout(2000),
        });
        if (response.ok) {
          onProgress({
            stage: 'complete',
            message:
              'Ollama may still be running. Check with: ps aux | grep ollama',
            complete: true,
          });
          return false;
        }
      } catch {
        // Connection refused = server is stopped
      }

      onProgress({
        stage: 'complete',
        message: 'Ollama server stopped!',
        complete: true,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      onProgress({ stage: 'error', message: 'Failed to stop', error: message });
      return false;
    }
  }

  async downloadModel(
    modelName: string,
    onProgress: LifecycleProgressCallback,
  ): Promise<boolean> {
    try {
      onProgress({ stage: 'pull', message: `Pulling ${modelName}...` });

      return new Promise((resolve) => {
        const proc = spawn('ollama', ['pull', modelName], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        proc.stdout?.on('data', (data) => {
          const line = data.toString().trim();
          if (line) {
            onProgress({ stage: 'pull', message: line });
          }
        });

        proc.stderr?.on('data', (data) => {
          const line = data.toString().trim();
          if (line) {
            onProgress({ stage: 'pull', message: line });
          }
        });

        proc.on('close', (code) => {
          if (code === 0) {
            onProgress({
              stage: 'complete',
              message: `${modelName} ready!`,
              complete: true,
            });
            resolve(true);
          } else {
            onProgress({
              stage: 'error',
              message: 'Pull failed',
              error: `Exit code: ${code}`,
            });
            resolve(false);
          }
        });

        proc.on('error', (error) => {
          onProgress({
            stage: 'error',
            message: 'Pull failed',
            error: error.message,
          });
          resolve(false);
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      onProgress({ stage: 'error', message: 'Pull failed', error: message });
      return false;
    }
  }

  async *chat(
    model: string,
    messages: ChatMessage[],
    options?: ChatOptions,
  ): AsyncGenerator<ChatResponse> {
    const client = this.createClient();

    const stream = await client.chat({
      model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
      options: {
        temperature: options?.temperature,
        num_predict: options?.maxTokens,
      },
    });

    for await (const chunk of stream) {
      yield {
        content: chunk.message.content,
        done: chunk.done,
      };
    }
  }
}
