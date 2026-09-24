import { readFile } from "node:fs/promises";
import path from "node:path";
import * as Ajv2020Module from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";

import registrySchema from "../../schemas/capability/registry.schema.json" with { type: "json" };
import { formatSchemaErrors } from "./schema.js";

type Authority = "read-only" | "write" | "consequential";
type DataClass = "public" | "personal" | "confidential" | "restricted";

export interface CapabilityEntry {
  description: string;
  handler: string;
  runtime: "node" | "browser";
  authority: Authority;
  timeout_seconds: number;
  max_output_chars: number;
  network_policy: {
    scheme: "https";
    hosts: string[];
    request_template: string;
  };
  security: {
    data_class: DataClass;
    credentials: "none" | "required";
    persistent_transport_safe: boolean;
  };
  input: Record<string, unknown>;
  lifecycle: "durable";
  promotion: {
    basis: "recurring-use" | "recurring-workflow";
    evidence: string[];
    reviewed_at: string;
  };
}

export interface CapabilityRegistry {
  version: 1;
  capabilities: Record<string, CapabilityEntry>;
}

interface AjvLike {
  compile(schema: object): ValidateFunction;
}

type AjvConstructor = new (options?: Record<string, unknown>) => AjvLike;

const Ajv2020 = (
  (Ajv2020Module as { default?: unknown }).default ?? Ajv2020Module
) as AjvConstructor;

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateRegistry = ajv.compile(registrySchema);

export class CapabilityRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityRegistryError";
  }
}

export async function loadCapabilityRegistry(
  root: string,
): Promise<CapabilityRegistry> {
  const source = await readFile(path.join(root, "registry.json"), "utf8");
  const parsed: unknown = JSON.parse(source);

  if (!validateRegistry(parsed)) {
    throw new CapabilityRegistryError(
      `Capability registry is invalid: ${formatSchemaErrors(validateRegistry.errors)}`,
    );
  }

  return parsed as CapabilityRegistry;
}

export function validateCapabilityInput(
  entry: CapabilityEntry,
  input: unknown,
): { valid: true } | { valid: false; message: string } {
  const validate = ajv.compile(entry.input);
  if (validate(input)) return { valid: true };
  return {
    valid: false,
    message: formatSchemaErrors(validate.errors),
  };
}

export function githubPersistentTransportRejection(
  entry: CapabilityEntry,
): string | null {
  if (entry.authority !== "read-only") {
    return "GitHub persistent transport permits only read-only capabilities in v0.1.";
  }
  if (entry.security.data_class !== "public") {
    return "GitHub persistent transport permits only public-data capabilities in v0.1.";
  }
  if (entry.security.credentials !== "none") {
    return "GitHub persistent transport does not permit credential-bearing capabilities in v0.1.";
  }
  if (!entry.security.persistent_transport_safe) {
    return "Capability is not approved for persistent GitHub Issue/comment transport.";
  }
  return null;
}
