// Read the local MCP interface config and inline its file references into a
// single bundle the platform can serve as the app's MCP server in dev.
//
// Called via readConfig() on every get-config poll request — no caching, so
// edits to instructions.md, tools/*.md, and prompts/*.md are picked up
// immediately.
//
// Unlike api.json (self-contained, passed through verbatim), the MCP
// interface.json references three things by path that must be inlined:
//   - instructions       -> contents of the instructions file
//   - tools[].description -> contents of each tools/*.md
//   - prompts[].template  -> contents of each prompts/*.md
// Everything else (name, method, tool name/title/annotations, resources,
// prompt arguments) passes through verbatim. Input schemas are NOT computed
// here — the platform resolves each tool's schema from the method contract.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { AppConfig } from '../config/types';

export interface McpToolConfig {
  method: string;
  name: string;
  title?: string;
  description: string; // inlined from tools/*.md
  annotations?: Record<string, unknown>;
}

export interface McpResourceConfig {
  method: string;
  uri?: string;
  uriTemplate?: string;
  name: string;
  mimeType?: string;
}

export interface McpPromptConfig {
  name: string;
  title?: string;
  description?: string;
  arguments?: Array<{ name: string; required?: boolean }>;
  template: string; // inlined from prompts/*.md
}

export interface McpConfigBundle {
  name: string;
  instructions: string; // inlined from the instructions file
  tools: McpToolConfig[];
  resources: McpResourceConfig[];
  prompts: McpPromptConfig[];
}

/**
 * Read and bundle the MCP interface config from local dist files.
 *
 * @param projectRoot  Absolute path to the project root (where mindstudio.json lives)
 * @param appConfig    The parsed AppConfig (already in memory)
 * @returns The bundled MCP config ready to send to the platform
 * @throws If no MCP interface is configured or a referenced file is missing
 */
export function readMcpConfig(
  projectRoot: string,
  appConfig: AppConfig,
): McpConfigBundle {
  const mcpInterface = appConfig.interfaces.find(
    (i) => i.type === 'mcp' && i.enabled !== false,
  );
  if (!mcpInterface) {
    throw new Error('No MCP interface configured in mindstudio.json');
  }

  const configPath = join(projectRoot, mcpInterface.path);
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch {
    throw new Error(
      `MCP config not found at ${mcpInterface.path} — run your build command`,
    );
  }

  const parsed = JSON.parse(raw);
  const config = parsed.mcp ?? parsed; // unwrap "mcp" key if present
  const mcpDir = dirname(configPath);

  // Resolve a file referenced (by relative path) from the interface dir and
  // inline its contents. A listed-but-missing file is a broken build.
  const readRef = (rel: string, label: string): string => {
    try {
      return readFileSync(join(mcpDir, rel), 'utf-8');
    } catch {
      throw new Error(`MCP ${label} not found at ${rel} — run your build command`);
    }
  };

  // instructions is optional; inline it only when the interface declares one.
  const instructions = config.instructions
    ? readRef(config.instructions, 'instructions')
    : '';

  // Inline each tool's description; pass method/name/title/annotations verbatim.
  const tools: McpToolConfig[] = (config.tools ?? []).map(
    (tool: McpToolConfig) => ({
      ...tool,
      description: readRef(tool.description, `tool description for "${tool.method}"`),
    }),
  );

  // Inline each prompt's template; pass name/title/description/arguments verbatim.
  const prompts: McpPromptConfig[] = (config.prompts ?? []).map(
    (prompt: McpPromptConfig) => ({
      ...prompt,
      template: readRef(prompt.template, `prompt template for "${prompt.name}"`),
    }),
  );

  return {
    ...config,
    instructions,
    tools,
    prompts,
    resources: config.resources ?? [],
  };
}
