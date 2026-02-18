import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts', 'src/index.ts'],
  format: ['esm'],
  target: 'node18',
  outDir: 'dist',
  splitting: true,
  sourcemap: true,
  dts: true,
  clean: true,
  // Keep dependencies external (installed via npm)
  external: [/^[^./]/],
});
