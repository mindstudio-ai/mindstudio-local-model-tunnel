// Collect type declarations from a TS file and its relative imports
// into a single lookup map for cross-file type resolution.

import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveImportPath } from './resolve-import';

/**
 * Parse a TypeScript source file and all its relative imports,
 * collecting every type alias and interface declaration into a map.
 *
 * Returns { typeMap, sourceFile } where sourceFile is the parsed entry file.
 */
export function collectTypeMap(filePath: string): {
  typeMap: Map<string, ts.TypeNode>;
  sourceFile: ts.SourceFile;
} {
  const typeMap = new Map<string, ts.TypeNode>();
  const visited = new Set<string>();

  const source = readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  collectFromFile(sourceFile, filePath, typeMap, visited);

  return { typeMap, sourceFile };
}

function collectFromFile(
  sourceFile: ts.SourceFile,
  filePath: string,
  typeMap: Map<string, ts.TypeNode>,
  visited: Set<string>,
): void {
  if (visited.has(filePath)) return;
  visited.add(filePath);

  const dir = dirname(filePath);

  for (const stmt of sourceFile.statements) {
    // Collect type aliases: type Foo = { ... }
    if (ts.isTypeAliasDeclaration(stmt)) {
      typeMap.set(stmt.name.text, stmt.type);
    }

    // Collect interfaces: interface Foo { ... }
    if (ts.isInterfaceDeclaration(stmt)) {
      // Convert to a type literal node so the converter can handle it uniformly
      const typeLiteral = ts.factory.createTypeLiteralNode(
        stmt.members.filter(ts.isPropertySignature),
      );
      typeMap.set(stmt.name.text, typeLiteral as ts.TypeNode);
    }

    // Follow relative imports to collect their types too
    if (
      ts.isImportDeclaration(stmt) &&
      stmt.moduleSpecifier &&
      ts.isStringLiteral(stmt.moduleSpecifier)
    ) {
      const specifier = stmt.moduleSpecifier.text;
      const resolved = resolveImportPath(specifier, dir);
      if (!resolved) continue;

      try {
        const importSource = readFileSync(resolved, 'utf-8');
        const importFile = ts.createSourceFile(
          resolved,
          importSource,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TS,
        );
        collectFromFile(importFile, resolved, typeMap, visited);
      } catch {
        // Can't read imported file — skip
      }
    }
  }
}
