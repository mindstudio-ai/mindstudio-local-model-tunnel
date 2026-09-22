import { defineConfig } from 'tsup';
import pkg from './package.json';

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    index: 'src/index.ts',
  },
  format: ['esm'],
  target: 'node18',
  outDir: 'dist',
  splitting: true,
  sourcemap: true,
  dts: {
    entry: {
      cli: 'src/cli.ts',
      index: 'src/index.ts',
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
