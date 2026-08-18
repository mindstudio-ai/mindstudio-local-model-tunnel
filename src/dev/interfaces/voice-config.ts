// Read the local voice interface config and inline all file references
// into a single bundle the platform can use to run a voice session.
//
// Called via readConfig() on every get-config poll request — no caching,
// so edits to system.md and tools/*.md are picked up immediately.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { extractInputSchema } from './schema/extract';
import { EMPTY_OBJECT_SCHEMA } from './schema/types';
import type { AppConfig } from '../config/types';

export interface VoiceToolBundle {
  method: string;
  latency?: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface VoiceConfigBundle {
  name?: string;
  description?: string;
  /**
   * Engine, key-discriminated: {model, voice} for native speech-to-speech,
   * or {llm, stt, tts, voice} for a cascaded pipeline.
   */
  model?: Record<string, unknown>;
  turnDetection?: Record<string, unknown>;
  greeting?: string;
  webInterfacePath?: string;
  systemPrompt: string;
  tools: VoiceToolBundle[];
  [key: string]: unknown;
}

/**
 * Read and bundle the voice interface config from local dist files.
 *
 * Unknown config keys are passed through (spread), so model-specific
 * settings and future fields survive without a tunnel release.
 *
 * @param projectRoot  Absolute path to the project root (where mindstudio.json lives)
 * @param appConfig    The parsed AppConfig (already in memory)
 * @returns The bundled voice config ready to send to the platform
 * @throws If no voice interface is configured or files are missing
 */
export function readVoiceConfig(
  projectRoot: string,
  appConfig: AppConfig,
): VoiceConfigBundle {
  const voiceInterface = appConfig.interfaces.find(
    (i) => i.type === 'voice' && i.enabled !== false,
  );
  if (!voiceInterface) {
    throw new Error('No voice interface configured in mindstudio.json');
  }

  const configPath = join(projectRoot, voiceInterface.path);
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch {
    throw new Error(
      `Voice config not found at ${voiceInterface.path} — run your build command`,
    );
  }

  const parsed = JSON.parse(raw);
  const config = parsed.voice ?? parsed; // unwrap "voice" key if present
  const voiceDir = dirname(configPath);

  // Read and inline the system prompt
  const systemPromptPath = config.systemPrompt;
  if (!systemPromptPath) {
    throw new Error('Voice config missing "systemPrompt" field');
  }
  let systemPrompt: string;
  try {
    systemPrompt = readFileSync(join(voiceDir, systemPromptPath), 'utf-8');
  } catch {
    throw new Error(
      `Voice system prompt not found at ${config.systemPrompt} — run your build command`,
    );
  }

  // Read and inline each tool description + extract inputSchema from source
  const tools: VoiceToolBundle[] = (config.tools ?? []).map(
    (tool: {
      method: string;
      latency?: string;
      description: string;
      inputSchema?: Record<string, unknown>;
    }) => {
      const descPath = join(voiceDir, tool.description);
      let description: string;
      try {
        description = readFileSync(descPath, 'utf-8');
      } catch {
        throw new Error(
          `Voice tool description not found at ${tool.description} for method "${tool.method}" — run your build command`,
        );
      }

      // Use compiled inputSchema if present, otherwise extract from TS source
      let inputSchema: Record<string, unknown>;
      if (tool.inputSchema) {
        inputSchema = tool.inputSchema;
      } else {
        const method = appConfig.methods.find((m) => m.id === tool.method);
        inputSchema = method
          ? extractInputSchema(join(projectRoot, method.path), method.export)
          : EMPTY_OBJECT_SCHEMA;
      }

      return {
        method: tool.method,
        latency: tool.latency,
        description,
        inputSchema,
      };
    },
  );

  return {
    ...config,
    systemPrompt,
    tools,
  };
}
