// Read the local agent interface config and inline all file references
// into a single bundle the platform can use to run the agent loop.
//
// Called on every get-agent-config poll request — no caching, so edits
// to system.md and tools/*.md are picked up immediately.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { AppConfig } from '../config/types';

export interface AgentConfigBundle {
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  tools: Array<{
    name: string;
    description: string;
    inputSchema?: Record<string, unknown>;
  }>;
}

/**
 * Read and bundle the agent interface config from local dist files.
 *
 * @param projectRoot  Absolute path to the project root (where mindstudio.json lives)
 * @param appConfig    The parsed AppConfig (already in memory)
 * @returns The bundled agent config ready to send to the platform
 * @throws If no agent interface is configured or files are missing
 */
export function readAgentConfig(
  projectRoot: string,
  appConfig: AppConfig,
): AgentConfigBundle {
  const agentInterface = appConfig.interfaces.find(
    (i) => i.type === 'agent' && i.enabled !== false,
  );
  if (!agentInterface) {
    throw new Error('No agent interface configured in mindstudio.json');
  }

  const configPath = join(projectRoot, agentInterface.path);
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch {
    throw new Error(
      `Agent config not found at ${agentInterface.path} — run your build command`,
    );
  }

  const parsed = JSON.parse(raw);
  const config = parsed.agent ?? parsed; // unwrap "agent" key if present
  const agentDir = dirname(configPath);

  // Read and inline the system prompt
  const systemPromptPath = join(agentDir, config.systemPrompt);
  let systemPrompt: string;
  try {
    systemPrompt = readFileSync(systemPromptPath, 'utf-8');
  } catch {
    throw new Error(
      `Agent system prompt not found at ${config.systemPrompt} — run your build command`,
    );
  }

  // Read and inline each tool description
  const tools = (config.tools ?? []).map(
    (tool: { method: string; description: string }) => {
      const descPath = join(agentDir, tool.description);
      let description: string;
      try {
        description = readFileSync(descPath, 'utf-8');
      } catch {
        throw new Error(
          `Agent tool description not found at ${tool.description} for method "${tool.method}" — run your build command`,
        );
      }
      return {
        name: tool.method,
        description,
      };
    },
  );

  return {
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    systemPrompt,
    tools,
  };
}
