/**
 * Resolve the path to a Chrome/Chromium executable. Returns null if none
 * found — the supervisor downgrades to a no-op and logs in that case.
 *
 * The sandbox image bakes in `google-chrome-stable`. On dev machines
 * the user may have Chrome installed at a different path; we probe a
 * short list of common locations.
 */

import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const CANDIDATES = [
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/opt/google/chrome/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

const PATH_COMMANDS = ['google-chrome-stable', 'google-chrome', 'chromium'];

export function resolveChromePath(): string | null {
  for (const candidate of CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }

  for (const cmd of PATH_COMMANDS) {
    try {
      const resolved = execSync(`command -v ${cmd}`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (resolved && existsSync(resolved)) return resolved;
    } catch {
      // Not on PATH — try next
    }
  }

  return null;
}
