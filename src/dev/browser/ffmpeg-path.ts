/**
 * Resolve the ffmpeg binary used to encode browser-test replay exports.
 *
 * The devbox image bakes ffmpeg in; sandboxes still on the older image (and
 * dev machines) may not have it. Callers report FFMPEG_UNAVAILABLE up front
 * rather than discovering the gap after a multi-minute render. Only a found
 * binary is cached — an agent can `apt-get install ffmpeg` mid-session and the
 * next export should see it.
 */

import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const CANDIDATES = [
  '/usr/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  '/opt/homebrew/bin/ffmpeg',
];

let found: string | null = null;

export function resolveFfmpegPath(): string | null {
  if (found && existsSync(found)) return found;
  found = null;

  for (const candidate of CANDIDATES) {
    if (existsSync(candidate)) {
      found = candidate;
      return found;
    }
  }

  try {
    const resolved = execSync('command -v ffmpeg', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (resolved && existsSync(resolved)) {
      found = resolved;
    }
  } catch {
    // Not on PATH.
  }
  return found;
}
