import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";

import lifecycleSchema from "../../schemas/lifecycle/frontmatter.schema.json" with { type: "json" };
import sourcePolicySchema from "../../schemas/source-policy/v1.schema.json" with { type: "json" };
import workstreamSchema from "../../schemas/workstream/frontmatter.schema.json" with { type: "json" };

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
