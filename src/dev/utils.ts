// Shared utilities for dev mode — used by both headless and TUI orchestrators.

import { execSync } from 'node:child_process';

// Chromium's kRestrictedPorts — ports the browser refuses to connect to over
// HTTP, failing navigation with net::ERR_UNSAFE_PORT. The sandbox automation
// browser (and any human opening the localhost proxy URL) would silently break
// on one of these. Kept as the full canonical list rather than filtered to the
// stablePort range below, so it stays correct if that range ever changes.
const CHROME_RESTRICTED_PORTS = new Set<number>([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
  2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697,
  10080,
]);

const STABLE_PORT_RANGE_START = 3100;
const STABLE_PORT_RANGE_SIZE = 900;

/**
 * Derive a stable port number (3100-3999) from the app ID so the proxy URL is
 * consistent across restarts. Chromium-restricted ports (e.g. 3659) are skipped
 * deterministically by walking forward within the range — otherwise an app whose
 * hash lands on one would fail every automation-browser launch with
 * net::ERR_UNSAFE_PORT, unfixable by restarting since the mapping is fixed.
 */
export function stablePort(appId: string): number {
  let hash = 0;
  for (let i = 0; i < appId.length; i++) {
    hash = ((hash << 5) - hash + appId.charCodeAt(i)) | 0;
  }
  const offset = Math.abs(hash) % STABLE_PORT_RANGE_SIZE;
  for (let i = 0; i < STABLE_PORT_RANGE_SIZE; i++) {
    const port =
      STABLE_PORT_RANGE_START + ((offset + i) % STABLE_PORT_RANGE_SIZE);
    if (!CHROME_RESTRICTED_PORTS.has(port)) return port;
  }
  return STABLE_PORT_RANGE_START + offset; // unreachable — range is not fully restricted
}

/** Detect current git branch, or undefined if not in a git repo. */
export function detectGitBranch(): string | undefined {
  try {
    return (
      execSync('git rev-parse --abbrev-ref HEAD', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}
