// esbuild-based TypeScript transpiler. Always transpiles fresh (no mtime cache).
//
// Output goes to {nearest node_modules}/.cache/mindstudio-dev/ so that:
// 1. Node's ESM resolver can find @mindstudio-ai/agent (walks up to node_modules)
// 2. The repo stays clean (.cache/ is conventionally gitignored)
//
// @mindstudio-ai/agent is marked external so it resolves from the project's
// installed version at runtime, not bundled into the output. This is critical
// because the SDK reads globalThis.ai and env vars set by the executor.

import { unlink, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { build } from 'esbuild';
import { log } from './logger';

export class Transpiler {
  private projectRoot: string;
  private outputFiles: Set<string> = new Set();

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    // Clean up orphaned .__ms_dev__.mjs files from previous runs
    // (or from the old transpiler that wrote next to source files)
    this.cleanupOrphans();
  }

  /** Remove any .__ms_dev__.mjs files found in the project source tree (not in node_modules/.cache). */
  private async cleanupOrphans(): Promise<void> {
    try {
      await removeOrphanedDevFiles(this.projectRoot);
    } catch {
      // Best effort
    }
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
 * Recursively remove .__ms_dev__.mjs files from the project tree,
 * skipping node_modules (where they belong if in .cache/).
 */
async function removeOrphanedDevFiles(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await removeOrphanedDevFiles(fullPath);
    } else if (entry.name.endsWith('.__ms_dev__.mjs')) {
      log.debug('transpiler Removing orphaned file', { path: fullPath });
      await unlink(fullPath).catch(() => {});
    }
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
