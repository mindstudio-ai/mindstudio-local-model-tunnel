// esbuild-based TypeScript transpiler with mtime caching.

import { stat, mkdir, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

export class Transpiler {
  private cacheDir: string;
  private projectRoot: string;

  constructor(appId: string, projectRoot: string) {
    this.projectRoot = projectRoot;
    // Cache inside dist/backend/ so Node's ESM resolver walks up and
    // finds dist/backend/node_modules/ for external packages like
    // @mindstudio-ai/agent. ESM doesn't respect NODE_PATH.
    this.cacheDir = join(projectRoot, 'dist', 'backend', 'node_modules', '.cache', 'mindstudio-dev');
  }

  /**
   * Transpile a method file to ESM JavaScript.
   * Returns the absolute path to the cached .mjs file.
   * Uses mtime-based caching to skip redundant transpilation.
   */
  async transpile(methodPath: string): Promise<string> {
    const absolutePath = resolve(this.projectRoot, methodPath);
    const fileStat = await stat(absolutePath);
    const mtime = Math.floor(fileStat.mtimeMs);

    const hash = createHash('sha256')
      .update(methodPath)
      .digest('hex')
      .slice(0, 16);
    const cachedFileName = `${hash}-${mtime}.mjs`;
    const cachedPath = join(this.cacheDir, cachedFileName);

    // Cache hit
    if (existsSync(cachedPath)) {
      return cachedPath;
    }

    // Ensure cache directory exists
    await mkdir(this.cacheDir, { recursive: true });

    // Clean stale cache entries for this method (different mtime)
    await this.cleanStaleEntries(hash);

    // Transpile with esbuild
    await build({
      entryPoints: [absolutePath],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      outfile: cachedPath,
      external: ['@mindstudio-ai/agent'],
      absWorkingDir: this.projectRoot,
      logLevel: 'silent',
    });

    return cachedPath;
  }

  /**
   * Remove stale cache entries for a given method hash (old mtime versions).
   */
  private async cleanStaleEntries(hash: string): Promise<void> {
    try {
      const entries = await readdir(this.cacheDir);
      for (const entry of entries) {
        if (entry.startsWith(`${hash}-`) && entry.endsWith('.mjs')) {
          await unlink(join(this.cacheDir, entry)).catch(() => {});
        }
      }
    } catch {
      // Cache dir may not exist yet
    }
  }

  /**
   * Clear the entire cache directory for this app.
   */
  async clearCache(): Promise<void> {
    try {
      const entries = await readdir(this.cacheDir);
      for (const entry of entries) {
        await unlink(join(this.cacheDir, entry)).catch(() => {});
      }
    } catch {
      // Nothing to clean
    }
  }
}
