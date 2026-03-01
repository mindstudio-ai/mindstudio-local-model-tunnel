import * as fs from 'fs';
import * as path from 'path';

const CONVERTER_DIR = 'comfyui-workflow-to-api-converter-endpoint';
const GITHUB_RAW_BASE =
  'https://raw.githubusercontent.com/SethRobinson/comfyui-workflow-to-api-converter-endpoint/main';
const FILES_TO_DOWNLOAD = ['__init__.py', 'workflow_converter.py'];

/**
 * Ensure the workflow converter custom node is installed in ComfyUI's custom_nodes directory.
 * Returns true if files are on disk (ComfyUI may still need a restart to load the endpoint).
 */
export async function ensureConverterInstalled(
  installPath: string,
): Promise<boolean> {
  const customNodesDir = path.join(installPath, 'custom_nodes');
  const converterDir = path.join(customNodesDir, CONVERTER_DIR);

  // Check if already installed
  const allFilesExist = FILES_TO_DOWNLOAD.every((f) =>
    fs.existsSync(path.join(converterDir, f)),
  );
  if (allFilesExist) {
    return true;
  }

  // Ensure custom_nodes directory exists
  if (!fs.existsSync(customNodesDir)) {
    return false; // Not a valid ComfyUI install
  }

  try {
    if (!fs.existsSync(converterDir)) {
      fs.mkdirSync(converterDir, { recursive: true });
    }

    for (const filename of FILES_TO_DOWNLOAD) {
      const url = `${GITHUB_RAW_BASE}/${filename}`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        throw new Error(`Failed to download ${filename}: ${response.status}`);
      }
      const content = await response.text();
      fs.writeFileSync(path.join(converterDir, filename), content, 'utf-8');
    }

    return true;
  } catch {
    return false;
  }
}

let converterAvailableCache: boolean | null = null;

/**
 * Check if the /workflow/convert endpoint is available on the running ComfyUI server.
 * Caches result for the duration of the discovery run.
 */
export async function isConverterEndpointAvailable(
  baseUrl: string,
): Promise<boolean> {
  if (converterAvailableCache !== null) {
    return converterAvailableCache;
  }

  try {
    const response = await fetch(`${baseUrl}/workflow/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodes: [], links: [] }),
      signal: AbortSignal.timeout(5000),
    });
    // Only a 200 means the endpoint is actually loaded;
    // ComfyUI returns 405 for unknown routes, not 404
    converterAvailableCache = response.ok;
    return converterAvailableCache;
  } catch {
    converterAvailableCache = false;
    return false;
  }
}

/**
 * Reset the converter availability cache. Call at the start of each discovery run.
 */
export function resetConverterCache(): void {
  converterAvailableCache = null;
}

/**
 * Convert a UI-format workflow to API format using ComfyUI's /workflow/convert endpoint.
 * The endpoint auto-detects if already API format and passes through.
 */
export async function convertWorkflow(
  baseUrl: string,
  uiWorkflow: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}/workflow/convert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(uiWorkflow),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Workflow conversion failed: ${response.status} ${errorText}`,
    );
  }

  return (await response.json()) as Record<string, unknown>;
}
