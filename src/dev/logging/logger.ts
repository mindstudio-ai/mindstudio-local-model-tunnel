/**
 * Structured NDJSON logger with configurable level and output target.
 *
 * Every log line is a self-contained JSON object:
 *   {"ts":1711234567890,"level":"info","module":"runner","msg":"Method received","requestId":"ac-4"}
 *
 * - Headless mode: writes to stderr (stdout reserved for JSON events)
 * - Interactive mode: writes to .logs/tunnel.ndjson (won't interfere with Ink TUI)
 *
 * Levels: error > warn > info > debug
 */

import fs from 'node:fs';
import { join } from 'node:path';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

let currentLevel: number = LEVELS.error;
let writeFn: (line: string) => void = () => {};

function write(level: LogLevel, module: string, msg: string, data?: Record<string, unknown>) {
  if (LEVELS[level] > currentLevel) {
    return;
  }
  const entry: Record<string, unknown> = { ts: Date.now(), level, module, msg };
  if (data) {
    Object.assign(entry, data);
  }
  writeFn(JSON.stringify(entry));
}

export const log = {
  error(module: string, msg: string, data?: Record<string, unknown>) {
    write('error', module, msg, data);
  },
  warn(module: string, msg: string, data?: Record<string, unknown>) {
    write('warn', module, msg, data);
  },
  info(module: string, msg: string, data?: Record<string, unknown>) {
    write('info', module, msg, data);
  },
  debug(module: string, msg: string, data?: Record<string, unknown>) {
    write('debug', module, msg, data);
  },
};

/** Configure logger for headless mode — writes NDJSON to stderr. */
export function initLoggerHeadless(level: LogLevel = 'info'): void {
  currentLevel = LEVELS[level];
  writeFn = (line) => {
    process.stderr.write(line + '\n');
  };
}

/** Configure logger for interactive mode — writes NDJSON to .logs/tunnel.ndjson. */
export function initLoggerInteractive(level: LogLevel = 'error'): void {
  currentLevel = LEVELS[level];
  let fd: number | null = null;
  writeFn = (line) => {
    try {
      if (fd === null) {
        const logsDir = join(process.cwd(), '.logs');
        fs.mkdirSync(logsDir, { recursive: true });
        fd = fs.openSync(join(logsDir, 'tunnel.ndjson'), 'a');
      }
      fs.writeSync(fd, line + '\n');
    } catch {
      // Best-effort — don't crash if we can't write logs
    }
  };
}
