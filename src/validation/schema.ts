import { createRequire } from "node:module";
import type { ErrorObject, ValidateFunction } from "ajv";

import lifecycleSchema from "../../schemas/lifecycle/frontmatter.schema.json" with { type: "json" };
import sourcePolicySchema from "../../schemas/source-policy/v1.schema.json" with { type: "json" };
import workstreamSchema from "../../schemas/workstream/frontmatter.schema.json" with { type: "json" };

interface AjvLike {
  compile(schema: object): ValidateFunction<Record<string, unknown>>;
}

type AjvConstructor = new (options?: Record<string, unknown>) => AjvLike;

const require = createRequire(import.meta.url);
const ajvModule = require("ajv/dist/2020") as {
  default?: AjvConstructor;
} & AjvConstructor;
const Ajv2020: AjvConstructor = ajvModule.default ?? ajvModule;
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});

export const validateWorkstreamFrontmatter =
  ajv.compile(workstreamSchema) as ValidateFunction<Record<string, unknown>>;
export const validateLifecycleFrontmatter =
  ajv.compile(lifecycleSchema) as ValidateFunction<Record<string, unknown>>;
export const validateSourcePolicyV1 =
  ajv.compile(sourcePolicySchema) as ValidateFunction<Record<string, unknown>>;

export function formatSchemaErrors(
  errors: ErrorObject[] | null | undefined,
): string {
  return (errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .join("; ");
}
