// Extract a JSON Schema from a TypeScript method's input parameter.
//
// Entry point for schema extraction. Parses the source file and its
// imports, finds the exported function, and converts its first
// parameter's type annotation to JSON Schema.

import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { collectTypeMap } from './type-map';
import { convertTypeNode } from './convert';
import { EMPTY_OBJECT_SCHEMA, type JsonSchema } from './types';

/**
 * Extract a JSON Schema from the first parameter of an exported function.
 * Always returns a schema — never undefined.
 */
export function extractInputSchema(
  filePath: string,
  exportName: string,
): JsonSchema {
  let source: string;
  try {
    source = readFileSync(filePath, 'utf-8');
  } catch {
    return EMPTY_OBJECT_SCHEMA;
  }

  const { typeMap, sourceFile } = collectTypeMap(filePath);

  const fn = findExportedFunction(sourceFile, exportName);
  if (!fn || fn.parameters.length === 0) return EMPTY_OBJECT_SCHEMA;

  const param = fn.parameters[0];
  if (!param.type) return EMPTY_OBJECT_SCHEMA;

  return convertTypeNode(param.type, typeMap, sourceFile);
}

function findExportedFunction(
  sourceFile: ts.SourceFile,
  name: string,
): ts.FunctionDeclaration | ts.ArrowFunction | undefined {
  for (const stmt of sourceFile.statements) {
    // export async function foo(input: { ... })
    if (
      ts.isFunctionDeclaration(stmt) &&
      stmt.name?.text === name &&
      hasExportModifier(stmt)
    ) {
      return stmt;
    }

    // export const foo = async (input: { ... }) => { ... }
    if (
      ts.isVariableStatement(stmt) &&
      hasExportModifier(stmt)
    ) {
      for (const decl of stmt.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.name.text === name &&
          decl.initializer
        ) {
          if (ts.isArrowFunction(decl.initializer)) {
            return decl.initializer;
          }
          if (ts.isFunctionExpression(decl.initializer)) {
            return decl.initializer as unknown as ts.ArrowFunction;
          }
        }
      }
    }
  }
  return undefined;
}

function hasExportModifier(node: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword,
    )
  );
}
