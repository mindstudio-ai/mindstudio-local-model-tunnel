// JSON Schema subset used for method input parameter schemas.

// A type alias rather than an interface on purpose: only aliases get an
// implicit index signature, so this stays assignable to the
// `Record<string, unknown>` the interface configs carry schemas as (an
// interface would need a cast at every such boundary).
export type JsonSchema = {
  type: string;
  properties?: Record<string, JsonSchema>;
  additionalProperties?: JsonSchema;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
};

/** Empty object schema — used for methods with no input parameters. */
export const EMPTY_OBJECT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {},
};
