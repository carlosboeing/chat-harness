import { readdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  githubPersistentTransportRejection,
  loadCapabilityRegistry,
} from "../src/validation/capability-registry.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const capabilitiesRoot = path.join(root, "capabilities");

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function walkHandlers(directory: string): Promise<string[]> {
  const handlers: string[] = [];
  if (!(await exists(directory))) return handlers;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      handlers.push(...(await walkHandlers(full)));
    } else if (entry.isFile() && entry.name === "handler.ts") {
      handlers.push(path.relative(root, full).split(path.sep).join("/"));
    }
  }
  return handlers;
}

const errors: string[] = [];
let registry;
try {
  registry = await loadCapabilityRegistry(root);
} catch (error) {
  process.stderr.write(
    `registry validation failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}

const entries = Object.entries(registry.capabilities);
const registered = new Set<string>();

for (const [name, entry] of entries) {
  if (
    entry.promotion.basis === "recurring-use" &&
    entry.promotion.evidence.length < 2
  ) {
    errors.push(
      `${name} promoted by recurring-use must cite at least two independent real-use references.`,
    );
  }

  const handler = path.resolve(root, entry.handler);
  if (!handler.startsWith(root + path.sep) || !(await exists(handler))) {
    errors.push(`${name} references missing handler ${entry.handler}.`);
  }
  registered.add(entry.handler);

  const rejection = githubPersistentTransportRejection(entry);
  if (rejection) {
    errors.push(`${name} is unsafe for the v0.1 GitHub transport: ${rejection}`);
  }
}

for (const forbidden of ["spikes", "experiments"]) {
  if (await exists(path.join(root, forbidden))) {
    errors.push(
      `${forbidden}/ is not allowed on main. Disposable adapters must remain branch-only.`,
    );
  }
}

for (const handler of await walkHandlers(capabilitiesRoot)) {
  if (!registered.has(handler)) {
    errors.push(
      `${handler} is not registered. Main must not contain orphan/disposable capability handlers.`,
    );
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    process.stderr.write(`registry validation failed: ${error}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(
    `registry validation passed: ${entries.length} durable capability/capabilities, persistent transport policy satisfied.\n`,
  );
}
