import * as path from 'path';

export interface WorkflowExecutionResult {
  dataBase64: string;
  mimeType: string;
  filename: string;
}

export interface WorkflowExecutionProgress {
  step: number;
  totalSteps: number;
  currentNode?: string;
}

interface OutputFile {
  filename: string;
  subfolder: string;
  type: string;
}

/**
 * Execute an arbitrary workflow on ComfyUI and return the first output.
 * Handles: POST /prompt → WebSocket progress → GET /history → GET /view
 */
export async function executeWorkflow(options: {
  baseUrl: string;
  workflow: Record<string, unknown>;
  onProgress?: (progress: WorkflowExecutionProgress) => void;
}): Promise<WorkflowExecutionResult> {
  const { baseUrl, workflow, onProgress } = options;

  const clientId = `mindstudio_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const wsUrl = baseUrl.replace(/^http/, 'ws') + `/ws?clientId=${clientId}`;

  // Submit prompt
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

  // Wait for completion via WebSocket
  await waitForCompletion(wsUrl, promptId, onProgress);

  // Fetch history
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
          images?: OutputFile[];
          gifs?: OutputFile[];
        }
      >;
    }
  >;

  const promptHistory = history[promptId];
  if (!promptHistory) {
    throw new Error('No result found in ComfyUI history');
  }

  // Scan ALL output nodes — prefer gifs (video) over images
  let outputFile: OutputFile | null = null;

  for (const nodeOutputs of Object.values(promptHistory.outputs)) {
    if (nodeOutputs.gifs && nodeOutputs.gifs.length > 0) {
      outputFile = nodeOutputs.gifs[0]!;
      break; // Prefer video output
    }
    if (!outputFile && nodeOutputs.images && nodeOutputs.images.length > 0) {
      outputFile = nodeOutputs.images[0]!;
    }
  }

  if (!outputFile) {
    throw new Error('No output files found in ComfyUI result');
  }

  // Download the output file
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
  const dataBase64 = Buffer.from(fileBuffer).toString('base64');

  const ext = path.extname(outputFile.filename).toLowerCase();
  const mimeType = getMimeType(ext);

  return { dataBase64, mimeType, filename: outputFile.filename };
}

function getMimeType(ext: string): string {
  switch (ext) {
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    default:
      return 'application/octet-stream';
  }
}

function waitForCompletion(
  wsUrl: string,
  promptId: string,
  onProgress?: (progress: WorkflowExecutionProgress) => void,
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
      reject(new Error('Workflow execution timed out after 30 minutes'));
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
