/**
 * Shared NDJSON log writer with rotation.
 *
 * Used by browser-log.ts and request-log.ts. Handles fd management,
 * line counting, append, and rotation when the file exceeds limits.
 */

import fs from 'node:fs';
import { join } from 'node:path';
import { log } from './logger';

export class NdjsonLog {
  private fd: number | null = null;
  private logPath: string | null = null;
  private lineCount = 0;
  private rotating = false;

  constructor(
    private readonly filename: string,
    private readonly maxLines = 500,
    private readonly maxBytes = 2 * 1024 * 1024,
    private readonly keepBytes = 1 * 1024 * 1024,
  ) {}

  init(projectRoot: string): void {
    this.close();

    try {
      const logsDir = join(projectRoot, '.logs');
      fs.mkdirSync(logsDir, { recursive: true });

      this.logPath = join(logsDir, this.filename);

      if (fs.existsSync(this.logPath)) {
        const content = fs.readFileSync(this.logPath, 'utf-8');
        this.lineCount = content.split('\n').filter((l) => l.trim()).length;
      } else {
        this.lineCount = 0;
      }

      this.fd = fs.openSync(this.logPath, 'a');
      // If the file was left over-cap by a previous run, rotate now so the
      // first append doesn't race against a huge file.
      this.maybeRotate();
      log.debug('logging', `${this.filename} log initialized`, {
        path: this.logPath,
        existingEntries: this.lineCount,
      });
    } catch (err) {
      log.warn('logging', `Failed to initialize ${this.filename} log`, {
        error: err instanceof Error ? err.message : String(err),
      });
      this.fd = null;
      this.logPath = null;
    }
  }

  append(record: Record<string, unknown>): void {
    if (this.fd === null) return;

    try {
      const line = JSON.stringify(record) + '\n';
      fs.writeSync(this.fd, line);
      this.lineCount++;
      this.maybeRotate();
    } catch {
      // Best effort
    }
  }

  close(): void {
    if (this.fd !== null) {
      try {
        fs.closeSync(this.fd);
      } catch {
        // Best effort
      }
      this.fd = null;
    }
    this.logPath = null;
    this.lineCount = 0;
    this.rotating = false;
  }

  private maybeRotate(): void {
    if (this.fd === null || this.logPath === null || this.rotating) return;

    try {
      let needsRotation = this.lineCount > this.maxLines;

      if (!needsRotation) {
        const stat = fs.fstatSync(this.fd);
        needsRotation = stat.size > this.maxBytes;
      }

      if (!needsRotation) return;

      this.rotating = true;

      const content = fs.readFileSync(this.logPath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());

      // Walk from the newest line backwards, keeping lines until the next one
      // would push us over the byte budget. Always keep at least one line so a
      // single pathologically-large entry doesn't empty the file entirely.
      const kept: string[] = [];
      let bytes = 0;
      for (let i = lines.length - 1; i >= 0; i--) {
        const lineBytes = Buffer.byteLength(lines[i], 'utf-8') + 1;
        if (bytes + lineBytes > this.keepBytes && kept.length > 0) break;
        kept.unshift(lines[i]);
        bytes += lineBytes;
      }

      fs.closeSync(this.fd);
      fs.writeFileSync(this.logPath, kept.join('\n') + '\n', 'utf-8');
      this.fd = fs.openSync(this.logPath, 'a');
      this.lineCount = kept.length;

    } catch {
      // Best effort
    } finally {
      this.rotating = false;
    }
  }
}
