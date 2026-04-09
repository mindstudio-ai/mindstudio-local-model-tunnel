// Resolve a relative import specifier to an absolute file path on disk.
// Only follows relative imports (./  ../) — node_modules are skipped.

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const EXTENSIONS = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

/**
 * Resolve `from './types'` to an absolute path like `/project/src/methods/types.ts`.
 * Returns null if the import is non-relative or the file can't be found.
 */
export function resolveImportPath(
  specifier: string,
  fromDir: string,
): string | null {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return null; // node_modules — skip
  }

  const base = resolve(fromDir, specifier);

  // Exact match (e.g. './types.ts' imported literally)
  if (existsSync(base) && !base.endsWith('/')) return base;

  // Try extensions
  for (const ext of EXTENSIONS) {
    const candidate = base + ext;
    if (existsSync(candidate)) return candidate;
  }

  return null;
}
