// esbuild-based TypeScript transpiler. No caching — always fresh for local dev.

import { unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { build } from 'esbuild';
import { log } from './logger';

export class Transpiler {
  private projectRoot: string;
  private outputFiles: Set<string> = new Set();

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Transpile a method file to ESM JavaScript.
   * Returns the absolute path to the output .mjs file.
   * Output is written inside the nearest node_modules/.cache/mindstudio-dev/
   * so ESM resolver can find packages and the repo stays clean.
   */
  async transpile(methodPath: string): Promise<string> {
    const start = Date.now();
    const absolutePath = resolve(this.projectRoot, methodPath);
    const name = basename(absolutePath).replace(/\.[^.]+$/, '');

    log.debug('transpiler Transpiling', { methodPath });

    // Find nearest node_modules by walking up from the source file
    const nodeModulesDir = findNearestNodeModules(dirname(absolutePath));
    if (!nodeModulesDir) {
      log.error('transpiler No node_modules found', { methodPath, searchStart: dirname(absolutePath) });
      throw new Error(
        `No node_modules found near ${methodPath}. Run npm install first.`,
      );
    }
    log.debug('transpiler Found node_modules', { path: nodeModulesDir });

    const outDir = join(nodeModulesDir, '.cache', 'mindstudio-dev');
    await mkdir(outDir, { recursive: true });

    const outfile = join(outDir, `${name}.__ms_dev__.mjs`);

    await build({
      entryPoints: [absolutePath],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      outfile,
      external: ['@mindstudio-ai/agent'],
      absWorkingDir: this.projectRoot,
      logLevel: 'silent',
    });

    this.outputFiles.add(outfile);
    log.info(`transpiler Transpiled in ${Date.now() - start}ms`, { methodPath, outfile });
    return outfile;
  }

  /**
   * Clean up all transpiled output files.
   */
  async cleanup(): Promise<void> {
    log.debug('transpiler Cleaning up', { fileCount: this.outputFiles.size });
    for (const file of this.outputFiles) {
      await unlink(file).catch(() => {});
    }
    this.outputFiles.clear();
  }
}

/**
 * Walk up from a directory to find the nearest node_modules.
 */
function findNearestNodeModules(startDir: string): string | null {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, 'node_modules');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached root
    dir = parent;
  }
  return null;
}
