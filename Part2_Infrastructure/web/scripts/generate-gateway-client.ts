/**
 * Generates lib/gateway-contract.generated.ts — typed bindings for the
 * committed gateway OpenAPI contract (FEAT-074 on the Developer board).
 *
 * Run manually and commit the output whenever the gateway contract changes:
 *   node --import tsx scripts/generate-gateway-client.ts
 *
 * Deliberately a bespoke ~150-line converter rather than a codegen
 * dependency: the contract is pydantic v2 output with a small, closed set of
 * constructs (`type`, `$ref`, nullable `anyOf`, `const`, three string-keyed
 * dicts — no `allOf`, no tuples), and anything outside that set must FAIL the
 * generation loudly rather than degrade to `any`. A general-purpose generator
 * would hide exactly the drift this file exists to surface;
 * `tests/gateway-contract.test.ts` fails the suite when the committed output
 * goes stale.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface SchemaNode {
  type?: string;
  $ref?: string;
  anyOf?: SchemaNode[];
  const?: unknown;
  enum?: unknown[];
  items?: SchemaNode;
  properties?: Record<string, SchemaNode>;
  required?: string[];
  additionalProperties?: SchemaNode | boolean;
  format?: string;
  title?: string;
  description?: string;
  default?: unknown;
}

interface OpenApiDocument {
  openapi: string;
  paths: Record<string, Record<string, OperationNode>>;
  components: { schemas: Record<string, SchemaNode> };
}

interface OperationNode {
  operationId?: string;
  requestBody?: { content?: Record<string, { schema?: SchemaNode }> };
  responses?: Record<string, { content?: Record<string, { schema?: SchemaNode }> }>;
}

const HANDLED_KEYS = new Set([
  "type", "$ref", "anyOf", "const", "enum", "items", "properties", "required",
  "additionalProperties", "format", "title", "description", "default", "examples", "deprecated",
  // Value constraints: enforced by the gateway at runtime, invisible to the type.
  "maximum", "minimum", "exclusiveMaximum", "exclusiveMinimum", "multipleOf",
  "maxLength", "minLength", "pattern", "maxItems", "minItems",
]);

function fail(context: string, message: string): never {
  throw new Error(`gateway-contract generation failed at ${context}: ${message}`);
}

function literal(value: unknown, context: string): string {
  if (value === null) return "null";
  const kind = typeof value;
  if (kind === "string" || kind === "number" || kind === "boolean") return JSON.stringify(value)!;
  return fail(context, `unsupported literal ${String(value)}`);
}

function refName(ref: string, context: string): string {
  const match = /^#\/components\/schemas\/([A-Za-z0-9_]+)$/.exec(ref);
  if (!match) return fail(context, `unsupported $ref ${ref}`);
  return match[1];
}

/** Convert one schema node to a TypeScript type expression. */
function tsType(node: SchemaNode, context: string): string {
  for (const key of Object.keys(node)) {
    if (!HANDLED_KEYS.has(key)) fail(context, `unhandled schema keyword "${key}"`);
  }
  if (node.$ref) return refName(node.$ref, context);
  if (node.anyOf) {
    const members = node.anyOf.map((member, index) => tsType(member, `${context}.anyOf[${index}]`));
    return [...new Set(members)].join(" | ");
  }
  if (node.const !== undefined) return literal(node.const, context);
  if (node.enum) return node.enum.map((value) => literal(value, context)).join(" | ");

  switch (node.type) {
    case undefined:
      // Pydantic renders `Any` as the empty schema.
      return "unknown";
    case "null":
      return "null";
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      if (!node.items) return "unknown[]";
      return `Array<${tsType(node.items, `${context}.items`)}>`;
    case "object": {
      if (node.properties) return objectBody(node, context, "  ");
      if (node.additionalProperties === undefined || node.additionalProperties === true) {
        return "Record<string, unknown>";
      }
      if (node.additionalProperties === false) return "Record<string, never>";
      return `Record<string, ${tsType(node.additionalProperties, `${context}.additionalProperties`)}>`;
    }
    default:
      return fail(context, `unsupported type "${node.type}"`);
  }
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function objectBody(node: SchemaNode, context: string, indent: string): string {
  const required = new Set(node.required ?? []);
  const fields = Object.keys(node.properties ?? {}).sort().map((key) => {
    const property = node.properties![key];
    const name = IDENTIFIER.test(key) ? key : JSON.stringify(key);
    const optional = required.has(key) ? "" : "?";
    return `${indent}${name}${optional}: ${tsType(property, `${context}.${key}`)};`;
  });
  return `{\n${fields.join("\n")}\n${indent.slice(2)}}`;
}

function operationEntry(path: string, method: string, operation: OperationNode): string {
  const context = `${method.toUpperCase()} ${path}`;
  const requestSchema = operation.requestBody?.content?.["application/json"]?.schema;
  const responseSchema = operation.responses?.["200"]?.content?.["application/json"]?.schema;
  const fields = [
    requestSchema ? `request: ${tsType(requestSchema, `${context} request`)}` : null,
    `response: ${responseSchema ? tsType(responseSchema, `${context} response`) : "unknown"}`,
  ].filter(Boolean);
  return `  ${JSON.stringify(context)}: { ${fields.join("; ")} };`;
}

export function renderGatewayContract(document: OpenApiDocument): string {
  const schemas = document.components.schemas;
  const models = Object.keys(schemas).sort().map((name) => {
    const node = schemas[name];
    if (node.type === "object" && node.properties) {
      return `export interface ${name} ${objectBody(node, name, "  ")}\n`;
    }
    return `export type ${name} = ${tsType(node, name)};\n`;
  });

  const operationLines: string[] = [];
  const pathLines: string[] = [];
  for (const path of Object.keys(document.paths).sort()) {
    pathLines.push(`  ${JSON.stringify(path)},`);
    for (const method of Object.keys(document.paths[path]).sort()) {
      operationLines.push(operationEntry(path, method, document.paths[path][method]));
    }
  }

  return `// Generated by scripts/generate-gateway-client.ts from tools/openapi.json — do not edit.
// Typed bindings for the committed gateway contract (OpenAPI ${document.openapi}).
// Regenerate: node --import tsx scripts/generate-gateway-client.ts

${models.join("\n")}
/** Request/response bindings keyed by "METHOD /path". */
export interface GatewayOperations {
${operationLines.join("\n")}
}

/** Every path the committed contract publishes. */
export const GATEWAY_CONTRACT_PATHS = [
${pathLines.join("\n")}
] as const;

export type GatewayContractPath = (typeof GATEWAY_CONTRACT_PATHS)[number];
`;
}

export function loadCommittedContract(): OpenApiDocument {
  const contractPath = fileURLToPath(new URL("../../tools/openapi.json", import.meta.url));
  return JSON.parse(readFileSync(contractPath, "utf8")) as OpenApiDocument;
}

const isDirectRun = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isDirectRun) {
  const outPath = fileURLToPath(new URL("../lib/gateway-contract.generated.ts", import.meta.url));
  const rendered = renderGatewayContract(loadCommittedContract());
  writeFileSync(outPath, rendered);
  console.log(`wrote lib/gateway-contract.generated.ts (${rendered.length} bytes)`);
}
