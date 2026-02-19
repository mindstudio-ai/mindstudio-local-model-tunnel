import * as fs from 'fs';
import * as path from 'path';
import type { LocalModel, ComfyWorkflowParameterSchema } from '../types';
import {
  ensureConverterInstalled,
  isConverterEndpointAvailable,
  convertWorkflow,
  resetConverterCache,
} from './converter-install';

const VIDEO_OUTPUT_NODES = ['VHS_VideoCombine', 'SaveVideo'];
const IMAGE_OUTPUT_NODES = ['SaveImage', 'PreviewImage'];

/**
 * Discover user-saved ComfyUI workflows and return them as aggregated LocalModel entries.
 * Returns at most 2 models: "ComfyUI Image Generation" and "ComfyUI Video Generation",
 * with all discovered workflows bundled in the parameter schema.
 */
export async function discoverWorkflows(
  baseUrl: string,
  installPath: string | null,
): Promise<LocalModel[]> {
  resetConverterCache();

  // Try to install converter if we know the install path
  let converterJustInstalled = false;
  if (installPath) {
    const wasInstalled = await ensureConverterInstalled(installPath);
    if (wasInstalled) {
      converterJustInstalled = true;
    }
  }

  const converterAvailable = await isConverterEndpointAvailable(baseUrl);

  // If we just installed files but endpoint isn't available, ComfyUI needs restart.
  // We still discover API-format workflows that don't need conversion.
  const needsRestart = converterJustInstalled && !converterAvailable;

  // List workflow files
  const workflowFiles = await listWorkflowFiles(baseUrl, installPath);

  // Collect converted workflows and unconverted counts per capability
  const converted: {
    image: Array<{ name: string; workflow: Record<string, unknown> }>;
    video: Array<{ name: string; workflow: Record<string, unknown> }>;
  } = { image: [], video: [] };
  const unconvertedCapabilities = new Set<'image' | 'video'>();

  for (const file of workflowFiles) {
    try {
      const workflowJson = await fetchWorkflowJson(baseUrl, installPath, file);
      if (!workflowJson) continue;

      let apiWorkflow: Record<string, unknown>;

      if (isApiFormat(workflowJson)) {
        apiWorkflow = workflowJson;
      } else if (converterAvailable) {
        try {
          apiWorkflow = await convertWorkflow(baseUrl, workflowJson);
        } catch {
          continue; // Skip workflows that fail conversion
        }
      } else {
        // Can't convert UI-format without the endpoint — track as unconverted
        unconvertedCapabilities.add('image');
        continue;
      }

      const capability = detectCapability(apiWorkflow);
      const name = path.basename(file, path.extname(file));
      converted[capability].push({ name, workflow: apiWorkflow });
    } catch {
      // Silent failure per-workflow — one broken workflow doesn't block others
    }
  }

  const models: LocalModel[] = [];

  // Emit aggregated models for each capability that has converted workflows
  for (const capability of ['image', 'video'] as const) {
    if (converted[capability].length > 0) {
      const displayName =
        capability === 'image'
          ? 'ComfyUI Image Generation'
          : 'ComfyUI Video Generation';
      const workflowParam: ComfyWorkflowParameterSchema = {
        type: 'comfyWorkflow',
        variable: 'workflow',
        label: 'Workflow',
        comfyWorkflowOptions: { availableWorkflows: converted[capability] },
      };
      models.push({
        name: displayName,
        provider: 'comfyui',
        capability,
        parameters: [workflowParam],
      });
    }
  }

  // Emit statusHint models for capabilities that have only unconverted workflows
  for (const capability of unconvertedCapabilities) {
    // Skip if we already have converted workflows for this capability
    if (converted[capability].length > 0) continue;

    const displayName =
      capability === 'image'
        ? 'ComfyUI Image Generation'
        : 'ComfyUI Video Generation';
    models.push({
      name: displayName,
      provider: 'comfyui',
      capability,
      statusHint: needsRestart
        ? 'Restart ComfyUI to enable'
        : 'Workflow converter not available',
    });
  }

  return models;
}

/**
 * List workflow files via the ComfyUI userdata API, falling back to filesystem.
 */
async function listWorkflowFiles(
  baseUrl: string,
  installPath: string | null,
): Promise<string[]> {
  // Try API first
  try {
    const response = await fetch(
      `${baseUrl}/userdata?dir=workflows/&recurse=true&full_info=true`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (response.ok) {
      const data = (await response.json()) as Array<string | { path: string }>;
      return data
        .map((entry) => (typeof entry === 'string' ? entry : entry.path))
        .filter((p) => p.endsWith('.json'));
    }
  } catch {
    // Fall through to filesystem
  }

  // Filesystem fallback
  if (installPath) {
    const workflowsDir = path.join(installPath, 'user', 'default', 'workflows');
    return scanDirectory(workflowsDir);
  }

  return [];
}

/**
 * Recursively scan a directory for .json files.
 */
function scanDirectory(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];

  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(
          ...scanDirectory(fullPath).map((f) => path.join(entry.name, f)),
        );
      } else if (entry.name.endsWith('.json')) {
        results.push(entry.name);
      }
    }
  } catch {
    // Ignore read errors
  }
  return results;
}

/**
 * Fetch a workflow's JSON content via the userdata API, falling back to filesystem.
 */
async function fetchWorkflowJson(
  baseUrl: string,
  installPath: string | null,
  filePath: string,
): Promise<Record<string, unknown> | null> {
  // Try API first — the {file} param needs the full path from the userdata root,
  // with slashes encoded (aiohttp matches {file} as a single path segment)
  try {
    const userdataPath = `workflows/${filePath}`;
    const response = await fetch(
      `${baseUrl}/userdata/${encodeURIComponent(userdataPath)}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (response.ok) {
      return (await response.json()) as Record<string, unknown>;
    }
  } catch {
    // Fall through to filesystem
  }

  // Filesystem fallback
  if (installPath) {
    const fullPath = path.join(
      installPath,
      'user',
      'default',
      'workflows',
      filePath,
    );
    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Check if a workflow JSON is already in API format.
 * API format has numeric string keys with objects containing `class_type`.
 */
export function isApiFormat(json: Record<string, unknown>): boolean {
  const keys = Object.keys(json);
  if (keys.length === 0) return false;

  // API format: keys are numeric strings, values have class_type
  return keys.some((key) => {
    const node = json[key];
    return (
      /^\d+$/.test(key) &&
      typeof node === 'object' &&
      node !== null &&
      'class_type' in node
    );
  });
}

/**
 * Detect whether a workflow produces image or video output.
 */
export function detectCapability(
  apiWorkflow: Record<string, unknown>,
): 'image' | 'video' {
  for (const node of Object.values(apiWorkflow)) {
    if (typeof node === 'object' && node !== null && 'class_type' in node) {
      const classType = (node as { class_type: string }).class_type;
      if (VIDEO_OUTPUT_NODES.includes(classType)) {
        return 'video';
      }
    }
  }

  for (const node of Object.values(apiWorkflow)) {
    if (typeof node === 'object' && node !== null && 'class_type' in node) {
      const classType = (node as { class_type: string }).class_type;
      if (IMAGE_OUTPUT_NODES.includes(classType)) {
        return 'image';
      }
    }
  }

  // Default to image if we can't determine
  return 'image';
}
