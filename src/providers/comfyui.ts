import * as fs from "fs";
import * as path from "path";
import { getComfyUIBaseUrl, getComfyUIInstallPath } from "../config.js";
import {
  getWorkflowForModel,
  isKnownVideoModel,
} from "../workflows/index.js";
import type {
  VideoProvider,
  LocalModel,
  VideoGenerationOptions,
  VideoGenerationResult,
  VideoGenerationProgress,
  ParameterSchema,
} from "./types.js";

/**
 * ComfyUI provider for video generation.
 * Default URL: http://127.0.0.1:8188
 */
export class ComfyUIProvider implements VideoProvider {
  readonly name = "comfyui" as const;
  readonly displayName = "ComfyUI";
  readonly capability = "video" as const;

  private getBaseUrl(): string {
    return getComfyUIBaseUrl();
  }

  async isRunning(): Promise<boolean> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/system_stats`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Discover video models by scanning ComfyUI's model directories.
   */
  async discoverModels(): Promise<LocalModel[]> {
    const models: LocalModel[] = [];

    // Try to discover models via the API first (more reliable)
    try {
      const response = await fetch(
        `${this.getBaseUrl()}/object_info/CheckpointLoaderSimple`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        const nodeInfo = data.CheckpointLoaderSimple as {
          input?: { required?: { ckpt_name?: [string[]] } };
        };
        const checkpoints =
          nodeInfo?.input?.required?.ckpt_name?.[0] || [];
        for (const name of checkpoints) {
          if (isKnownVideoModel(name)) {
            const workflow = getWorkflowForModel(name);
            models.push({
              name: name,
              provider: this.name,
              capability: "video",
              parameterSize: workflow?.displayName,
            });
          }
        }
      }
    } catch {
      // API not available, try filesystem scan
    }

    // Also scan diffusion_models directory for Wan2.1 style models
    try {
      const response = await fetch(
        `${this.getBaseUrl()}/object_info/UNETLoader`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        const nodeInfo = data.UNETLoader as {
          input?: { required?: { unet_name?: [string[]] } };
        };
        const unetModels =
          nodeInfo?.input?.required?.unet_name?.[0] || [];
        for (const name of unetModels) {
          if (
            isKnownVideoModel(name) &&
            !models.some((m) => m.name === name)
          ) {
            const workflow = getWorkflowForModel(name);
            models.push({
              name: name,
              provider: this.name,
              capability: "video",
              parameterSize: workflow?.displayName,
            });
          }
        }
      }
    } catch {
      // Ignore
    }

    // Fallback: scan filesystem if API returned nothing
    if (models.length === 0) {
      const installPath = getComfyUIInstallPath();
      if (installPath) {
        const dirs = [
          path.join(installPath, "models", "checkpoints"),
          path.join(installPath, "models", "diffusion_models"),
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
                    capability: "video",
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
    onProgress?: (progress: VideoGenerationProgress) => void
  ): Promise<VideoGenerationResult> {
    const baseUrl = this.getBaseUrl();
    const workflowConfig = getWorkflowForModel(model);

    if (!workflowConfig) {
      throw new Error(
        `No workflow template found for model: ${model}. Supported families: LTX-Video, Wan2.1`
      );
    }

    const defaults = workflowConfig.defaults;
    const seed =
      options?.seed !== undefined && options.seed !== -1
        ? options.seed
        : Math.floor(Math.random() * 2 ** 32);

    // Build the workflow
    const workflow = workflowConfig.buildWorkflow({
      model,
      prompt,
      negativePrompt: options?.negativePrompt || "worst quality, blurry, distorted",
      width: options?.width || defaults.width,
      height: options?.height || defaults.height,
      numFrames: options?.numFrames || defaults.numFrames,
      fps: options?.fps || defaults.fps,
      steps: options?.steps || defaults.steps,
      cfgScale: options?.cfgScale || defaults.cfgScale,
      seed,
    });

    // Generate a unique client ID for this request
    const clientId = `mindstudio_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    // Connect WebSocket for progress tracking before submitting
    const wsUrl = baseUrl.replace(/^http/, "ws") + `/ws?clientId=${clientId}`;

    // Submit the workflow
    const submitResponse = await fetch(`${baseUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: workflow,
        client_id: clientId,
      }),
    });

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      throw new Error(`ComfyUI prompt submission failed: ${submitResponse.status} ${errorText}`);
    }

    const submitResult = (await submitResponse.json()) as {
      prompt_id: string;
      number: number;
      node_errors?: Record<string, unknown>;
    };

    if (submitResult.node_errors && Object.keys(submitResult.node_errors).length > 0) {
      throw new Error(
        `ComfyUI workflow validation failed: ${JSON.stringify(submitResult.node_errors)}`
      );
    }

    const promptId = submitResult.prompt_id;

    // Wait for execution to complete using WebSocket
    await this.waitForCompletion(wsUrl, promptId, onProgress);

    // Fetch the result from history
    const historyResponse = await fetch(
      `${baseUrl}/history/${promptId}`,
      { signal: AbortSignal.timeout(30000) }
    );

    if (!historyResponse.ok) {
      throw new Error(`Failed to fetch result history: ${historyResponse.status}`);
    }

    const history = (await historyResponse.json()) as Record<
      string,
      {
        outputs: Record<
          string,
          {
            images?: Array<{ filename: string; subfolder: string; type: string }>;
            gifs?: Array<{ filename: string; subfolder: string; type: string }>;
          }
        >;
      }
    >;

    const promptHistory = history[promptId];
    if (!promptHistory) {
      throw new Error("No result found in ComfyUI history");
    }

    // Find the output from our output node
    // VHS_VideoCombine uses "gifs" key, SaveAnimatedWEBP uses "images"
    const outputNodeId = workflowConfig.outputNodeId;
    const outputData = promptHistory.outputs[outputNodeId];
    const outputFiles = outputData?.gifs || outputData?.images;

    if (!outputFiles || outputFiles.length === 0) {
      throw new Error("No output files found in ComfyUI result");
    }

    const outputFile = outputFiles[0];

    // Download the output file
    const fileUrl = new URL(`${baseUrl}/view`);
    fileUrl.searchParams.set("filename", outputFile.filename);
    fileUrl.searchParams.set("subfolder", outputFile.subfolder || "");
    fileUrl.searchParams.set("type", outputFile.type || "output");

    const fileResponse = await fetch(fileUrl.toString(), {
      signal: AbortSignal.timeout(60000),
    });

    if (!fileResponse.ok) {
      throw new Error(`Failed to download output file: ${fileResponse.status}`);
    }

    const fileBuffer = await fileResponse.arrayBuffer();
    const videoBase64 = Buffer.from(fileBuffer).toString("base64");

    // Determine MIME type from filename
    const ext = path.extname(outputFile.filename).toLowerCase();
    const mimeType =
      ext === ".mp4"
        ? "video/mp4"
        : ext === ".webm"
          ? "video/webm"
          : ext === ".webp"
            ? "image/webp"
            : ext === ".gif"
              ? "image/gif"
              : "video/mp4";

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
    onProgress?: (progress: VideoGenerationProgress) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutMs = 30 * 60 * 1000; // 30 minutes for video generation
      let ws: WebSocket;

      const timeout = setTimeout(() => {
        try {
          ws?.close();
        } catch {
          // Ignore
        }
        reject(new Error("Video generation timed out after 30 minutes"));
      }, timeoutMs);

      try {
        ws = new WebSocket(wsUrl);
      } catch (err) {
        clearTimeout(timeout);
        reject(
          new Error(
            `Failed to connect to ComfyUI WebSocket: ${err instanceof Error ? err.message : err}`
          )
        );
        return;
      }

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(
            typeof event.data === "string" ? event.data : ""
          ) as {
            type: string;
            data: Record<string, unknown>;
          };

          if (message.type === "progress") {
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

          if (message.type === "execution_success") {
            const data = message.data as { prompt_id: string };
            if (data.prompt_id === promptId) {
              clearTimeout(timeout);
              ws.close();
              resolve();
            }
          }

          if (message.type === "execution_error") {
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
                  `ComfyUI execution error${data.node_type ? ` in ${data.node_type}` : ""}: ${data.exception_message || "Unknown error"}`
                )
              );
            }
          }
        } catch {
          // Ignore non-JSON messages
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("ComfyUI WebSocket error: connection failed"));
      };

      ws.onclose = (event) => {
        // Only reject if we haven't already resolved
        if (!event.wasClean) {
          clearTimeout(timeout);
          reject(new Error("ComfyUI WebSocket connection closed unexpectedly"));
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
        type: "number",
        label: "Width",
        variable: "width",
        helpText: "Video width in pixels. Larger = better quality but bigger file.",
        defaultValue: 512,
        numberOptions: { min: 256, max: 1280, step: 64 },
      },
      {
        type: "number",
        label: "Height",
        variable: "height",
        helpText: "Video height in pixels. Larger = better quality but bigger file.",
        defaultValue: 320,
        numberOptions: { min: 256, max: 1280, step: 64 },
      },
      {
        type: "number",
        label: "Frames",
        variable: "numFrames",
        helpText:
          "Number of frames to generate. More frames = longer video but bigger file. Keep low to avoid upload limits.",
        defaultValue: 41,
        numberOptions: { min: 9, max: 97, step: 8 },
      },
      {
        type: "number",
        label: "FPS",
        variable: "fps",
        helpText: "Frames per second for the output video.",
        defaultValue: 8,
        numberOptions: { min: 4, max: 30, step: 1 },
      },
      {
        type: "number",
        label: "Steps",
        variable: "steps",
        helpText:
          "Number of denoising steps. More steps = higher quality but slower.",
        defaultValue: 20,
        numberOptions: { min: 10, max: 100, step: 1 },
      },
      {
        type: "number",
        label: "CFG Scale",
        variable: "cfgScale",
        helpText:
          "How strongly the video should follow the prompt. Higher = more literal.",
        defaultValue: 7,
        numberOptions: { min: 1, max: 20, step: 0.5 },
      },
      {
        type: "number",
        label: "Seed",
        variable: "seed",
        helpText:
          "A specific value used to guide randomness. Use -1 for random.",
        defaultValue: -1,
        numberOptions: { min: -1, max: 2147483647 },
      },
      {
        type: "text",
        label: "Negative Prompt",
        variable: "negativePrompt",
        helpText: "Things you don't want in the video",
        placeholder: "worst quality, blurry, distorted",
      },
    ];
  }
}
