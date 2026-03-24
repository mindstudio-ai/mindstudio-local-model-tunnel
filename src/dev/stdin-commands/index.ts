/**
 * Stdin command router for headless mode.
 *
 * Reads NDJSON commands from stdin and dispatches to individual handlers.
 * Every command must include a `requestId` for response correlation.
 * The router wraps handlers with automatic response framing.
 */

import { emitResponse } from '../ipc';
import { log } from '../logger';
import { handleRunScenario } from './run-scenario';
import { handleRunMethod } from './run-method';
import { handleImpersonate, handleClearImpersonation } from './impersonate';
import { handleBrowser } from './browser';
import { handleScreenshot } from './screenshot';
import { handleDevServerRestarting } from './dev-server-restarting';
import { handleBrowserStatus } from './browser-status';
import { handleResetBrowser } from './reset-browser';
import type { SessionState, CommandContext, CommandHandler } from './types';

export type { SessionState } from './types';

const handlers: Record<string, CommandHandler> = {
  'run-method': handleRunMethod,
  'run-scenario': handleRunScenario,
  'impersonate': handleImpersonate,
  'clear-impersonation': handleClearImpersonation,
  'browser': handleBrowser,
  'screenshot': handleScreenshot,
  'browser-status': handleBrowserStatus,
  'reset-browser': handleResetBrowser,
  'dev-server-restarting': handleDevServerRestarting,
};

export function setupStdinCommands(
  state: SessionState,
  cwd: string,
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

      let cmd: { action: string; requestId?: string; [key: string]: unknown };
      try {
        cmd = JSON.parse(line);
      } catch {
        log.warn('Invalid JSON on stdin', { preview: line.slice(0, 100) });
        continue;
      }

      handleStdinCommand(cmd, state, cwd);
    }
  });
}

async function handleStdinCommand(
  cmd: { action: string; requestId?: string; [key: string]: unknown },
  state: SessionState,
  cwd: string,
): Promise<void> {
  const { requestId, action } = cmd;

  if (!requestId) {
    log.warn('Command rejected: missing requestId', { action });
    return;
  }

  const handler = handlers[action];
  if (!handler) {
    emitResponse(action ?? 'unknown', requestId, 'completed', {
      success: false,
      error: `Unknown action: ${action}`,
    });
    return;
  }

  const ctx: CommandContext = {
    state,
    cwd,
    requestId,
    started: (data) => emitResponse(action, requestId, 'started', data),
  };

  try {
    const result = await handler(ctx, cmd);
    emitResponse(action, requestId, 'completed', result);
  } catch (err) {
    emitResponse(action, requestId, 'completed', {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
