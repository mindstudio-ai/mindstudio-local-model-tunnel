// Convert a TypeScript type node to a JSON Schema object.
// Uses a type map for cross-file type resolution.

import ts from 'typescript';
import type { JsonSchema } from './types';

/** Fallback for anything we can't resolve. */
const STRING_FALLBACK: JsonSchema = { type: 'string' };

/**
 * Convert a TypeScript TypeNode to a JSON Schema.
 * Always returns a schema — unresolvable types become { type: "string" }.
 */
export function convertTypeNode(
  node: ts.TypeNode,
  typeMap: Map<string, ts.TypeNode>,
  sourceFile: ts.SourceFile,
): JsonSchema {
  // Inline object literal: { foo: string; bar?: number }
  if (ts.isTypeLiteralNode(node)) {
    return convertTypeLiteral(node, typeMap, sourceFile);
  }

  // Primitives
  if (node.kind === ts.SyntaxKind.StringKeyword) return { type: 'string' };
  if (node.kind === ts.SyntaxKind.NumberKeyword) return { type: 'number' };
  if (node.kind === ts.SyntaxKind.BooleanKeyword) return { type: 'boolean' };
  if (node.kind === ts.SyntaxKind.AnyKeyword) return { type: 'object' };
  if (node.kind === ts.SyntaxKind.UnknownKeyword) return { type: 'object' };

  // T[] syntax
  if (ts.isArrayTypeNode(node)) {
    const items = convertTypeNode(node.elementType, typeMap, sourceFile);
    return { type: 'array', items };
  }

  // Array<T> generic syntax
  if (
    ts.isTypeReferenceNode(node) &&
    ts.isIdentifier(node.typeName) &&
    node.typeName.text === 'Array' &&
    node.typeArguments?.length === 1
  ) {
    const items = convertTypeNode(node.typeArguments[0], typeMap, sourceFile);
    return { type: 'array', items };
  }

  // Record<string, T>
  if (
    ts.isTypeReferenceNode(node) &&
    ts.isIdentifier(node.typeName) &&
    node.typeName.text === 'Record' &&
    node.typeArguments?.length === 2
  ) {
    const valueSchema = convertTypeNode(node.typeArguments[1], typeMap, sourceFile);
    return { type: 'object', additionalProperties: valueSchema };
  }

  // String literal union: 'a' | 'b' | 'c'
  if (ts.isUnionTypeNode(node)) {
    const allStringLiterals = node.types.every(
      (t) => ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal),
    );
    if (allStringLiterals) {
      const enumValues = node.types.map(
        (t) => ((t as ts.LiteralTypeNode).literal as ts.StringLiteral).text,
      );
      return { type: 'string', enum: enumValues };
    }
    // Mixed union — fall back
    return STRING_FALLBACK;
  }

  // Parenthesized: (SomeType)
  if (ts.isParenthesizedTypeNode(node)) {
    return convertTypeNode(node.type, typeMap, sourceFile);
  }

  // Intersection: { a: string } & { b: number }
  if (ts.isIntersectionTypeNode(node)) {
    const merged: JsonSchema = { type: 'object', properties: {}, required: [] };
    for (const member of node.types) {
      const sub = convertTypeNode(member, typeMap, sourceFile);
      if (sub.properties) {
        Object.assign(merged.properties!, sub.properties);
        if (sub.required) merged.required!.push(...sub.required);
      }
    }
    if (merged.required!.length === 0) delete merged.required;
    if (Object.keys(merged.properties!).length === 0) delete merged.properties;
    return merged;
  }

  // Type reference — resolve from the type map
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const resolved = typeMap.get(node.typeName.text);
    if (resolved) return convertTypeNode(resolved, typeMap, sourceFile);
  }

  // Anything unresolvable
  return STRING_FALLBACK;
}

function convertTypeLiteral(
  node: ts.TypeLiteralNode,
  typeMap: Map<string, ts.TypeNode>,
  sourceFile: ts.SourceFile,
): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const member of node.members) {
    if (!ts.isPropertySignature(member) || !member.name) continue;

    const name = member.name.getText(sourceFile);
    const optional = !!member.questionToken;

    if (member.type) {
      properties[name] = convertTypeNode(member.type, typeMap, sourceFile);
      if (!optional) required.push(name);
    }
  }

  const schema: JsonSchema = { type: 'object', properties };
  if (required.length > 0) schema.required = required;
  return schema;
}
