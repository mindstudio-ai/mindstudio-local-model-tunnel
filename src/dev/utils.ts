// Shared utilities for dev mode — used by both headless and TUI orchestrators.

import { execSync } from 'node:child_process';

/** Derive a stable port number (3100-3999) from the app ID so the proxy URL is consistent. */
export function stablePort(appId: string): number {
  let hash = 0;
  for (let i = 0; i < appId.length; i++) {
    hash = ((hash << 5) - hash + appId.charCodeAt(i)) | 0;
  }
  return 3100 + (Math.abs(hash) % 900);
}

/** Detect current git branch, or undefined if not in a git repo. */
export function detectGitBranch(): string | undefined {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || undefined;
  } catch {
    return undefined;
  }
}
