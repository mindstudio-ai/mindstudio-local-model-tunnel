/**
 * Stdin command router for headless mode.
 *
 * Reads NDJSON commands from stdin and dispatches to individual handlers.
 * Each command lives in its own file for isolation and testability.
 */

import { handleRunScenario } from './run-scenario';
import { handleRunMethod } from './run-method';
import { handleImpersonate, handleClearImpersonation } from './impersonate';
import { handleBrowser } from './browser';
import { handleScreenshot } from './screenshot';
import type { SessionState, EmitFn } from './types';

export type { SessionState, EmitFn } from './types';

export function setupStdinCommands(
  state: SessionState,
  cwd: string,
  emit: EmitFn,
): void {
  if (!process.stdin.readable) return;

  let buffer = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;

      try {
        const cmd = JSON.parse(line) as { action: string; [key: string]: unknown };
        handleStdinCommand(cmd, state, cwd, emit);
      } catch {
        emit('command-error', { message: `Invalid JSON on stdin: ${line.slice(0, 100)}` });
      }
    }
  });
}

async function handleStdinCommand(
  cmd: { action: string; [key: string]: unknown },
  state: SessionState,
  cwd: string,
  emit: EmitFn,
): Promise<void> {
  switch (cmd.action) {
    case 'run-scenario':
      return handleRunScenario(state, cwd, cmd, emit);
    case 'run-method':
      return handleRunMethod(state, cwd, cmd, emit);
    case 'impersonate':
      return handleImpersonate(state, cmd, emit);
    case 'clear-impersonation':
      return handleClearImpersonation(state, emit);
    case 'browser':
      return handleBrowser(state, cmd, emit);
    case 'screenshot':
      return handleScreenshot(state, emit);
    default:
      emit('command-error', { message: `Unknown action: ${cmd.action}` });
  }
}
