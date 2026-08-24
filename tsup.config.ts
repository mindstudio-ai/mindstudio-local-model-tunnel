import { defineConfig } from 'tsup';
import pkg from './package.json';

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    index: 'src/index.ts',
    headless: 'src/headless.ts',
    // The forked dev method worker — its own entry so it emits a standalone
    // dist/dev-worker.js that executor.ts copies into the project tree and forks
    // (it must live in the project's node_modules to resolve @mindstudio-ai/agent).
    'dev-worker': 'src/dev/execution/worker.ts',
  },
  format: ['esm'],
  target: 'node18',
  outDir: 'dist',
  splitting: true,
  sourcemap: true,
  // Emit .d.ts only for the public API entries. dev-worker is a runtime-only
  // forked process (no exports, nothing imports its types), and its no-export
  // isolated DTS compilation can't see node globals — tsc --noEmit is its type
  // gate instead.
  dts: {
    entry: {
      cli: 'src/cli.ts',
      index: 'src/index.ts',
      headless: 'src/headless.ts',
    },
  },
  clean: true,
  loader: { '.md': 'text' },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // Keep dependencies external (installed via npm)
  external: [/^[^./]/],
});
