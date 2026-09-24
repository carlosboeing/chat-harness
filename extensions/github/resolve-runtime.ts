import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadCapabilityRegistry } from "../../src/validation/capability-registry.js";

function rootFromModule(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

export async function resolveRuntime(
  raw: string,
  root = rootFromModule(),
): Promise<"node" | "browser"> {
  let request: unknown;
  try {
    request = JSON.parse(raw);
  } catch {
    return "node";
  }

  const capability =
    request &&
    typeof request === "object" &&
    !Array.isArray(request) &&
    typeof (request as Record<string, unknown>).capability === "string"
      ? String((request as Record<string, unknown>).capability)
      : "";

  const registry = await loadCapabilityRegistry(root);
  return registry.capabilities[capability]?.runtime ?? "node";
}

if (import.meta.main) {
  const runtime = await resolveRuntime(process.env.CAPABILITY_REQUEST ?? "");
  process.stdout.write(`runtime=${runtime}\n`);
}
