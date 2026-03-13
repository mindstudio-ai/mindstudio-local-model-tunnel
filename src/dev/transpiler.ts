// esbuild-based TypeScript transpiler. No caching — always fresh for local dev.

import { unlink } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { build } from 'esbuild';

export class Transpiler {
  private projectRoot: string;
  private outputFiles: Set<string> = new Set();

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Transpile a method file to ESM JavaScript.
   * Returns the absolute path to the output .mjs file.
   * Output is written next to the source file so Node's ESM resolver
   * can find the project's node_modules (e.g. @mindstudio-ai/agent).
   */
  async transpile(methodPath: string): Promise<string> {
    const absolutePath = resolve(this.projectRoot, methodPath);
    const dir = dirname(absolutePath);
    const name = basename(absolutePath).replace(/\.[^.]+$/, '');
    const outfile = resolve(dir, `${name}.__ms_dev__.mjs`);

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
    return outfile;
  }

  /**
   * Clean up all transpiled output files.
   */
  async cleanup(): Promise<void> {
    for (const file of this.outputFiles) {
      await unlink(file).catch(() => {});
    }
    this.outputFiles.clear();
  }
}
