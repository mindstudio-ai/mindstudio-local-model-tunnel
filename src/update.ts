import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const CDN_BASE_URL = 'https://f.mscdn.ai/local-model-tunnel';

export type InstallMethod = 'binary' | 'npm';

export function getInstallMethod(): InstallMethod {
  // Bun-compiled binaries embed the runtime — there's no node_modules or global npm prefix
  // Check if we're running from a standalone binary (not inside a node_modules tree)
  const execPath = process.execPath;
  if (
    !execPath.includes('node_modules') &&
    !execPath.includes('node') &&
    !execPath.includes('bun')
  ) {
    return 'binary';
  }
  return 'npm';
}

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

export function getBinaryDownloadUrl(): string {
  const platformMap: Record<string, string> = {
    darwin: 'darwin',
    linux: 'linux',
    win32: 'windows',
  };
  const platform = platformMap[process.platform] ?? 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const ext = process.platform === 'win32' ? '.exe' : '';
  return `${CDN_BASE_URL}/latest/mindstudio-local-${platform}-${arch}${ext}`;
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
