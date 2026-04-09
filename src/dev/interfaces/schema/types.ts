// JSON Schema subset used for method input parameter schemas.

export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema>;
  additionalProperties?: JsonSchema;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
}

/** Empty object schema — used for methods with no input parameters. */
export const EMPTY_OBJECT_SCHEMA: JsonSchema = { type: 'object', properties: {} };
