import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

export function getCurrentVersion(): string {
  return pkg.version;
}

export async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(
      'https://registry.npmjs.org/@mindstudio-ai/local-model-tunnel/latest',
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

export function isNewerVersion(current: string, latest: string): boolean {
  const currentParts = current.split('.').map(Number);
  const latestParts = latest.split('.').map(Number);
  for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
    const c = currentParts[i] ?? 0;
    const l = latestParts[i] ?? 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

export async function checkForUpdate(): Promise<{
  currentVersion: string;
  latestVersion: string;
} | null> {
  const currentVersion = getCurrentVersion();
  const latestVersion = await fetchLatestVersion();
  if (!latestVersion) return null;
  if (!isNewerVersion(currentVersion, latestVersion)) return null;
  return { currentVersion, latestVersion };
}
