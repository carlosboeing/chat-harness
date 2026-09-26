import * as Ajv2020Module from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";
import sourcePolicySchema from "../../schemas/source-policy/v1.schema.json" with { type: "json" };
import workstreamSchema from "../../schemas/workstream/frontmatter.schema.json" with { type: "json" };

interface AjvLike { compile(schema: object): ValidateFunction<Record<string, unknown>>; }
type AjvConstructor = new (options?: Record<string, unknown>) => AjvLike;
const Ajv2020 = ((Ajv2020Module as { default?: unknown }).default ?? Ajv2020Module) as AjvConstructor;
const ajv = new Ajv2020({ allErrors: true, strict: true });
export const validateWorkstreamFrontmatter = ajv.compile(workstreamSchema) as ValidateFunction<Record<string, unknown>>;
export const validateSourcePolicyV1 = ajv.compile(sourcePolicySchema) as ValidateFunction<Record<string, unknown>>;
export function formatSchemaErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`).join("; ");
}
