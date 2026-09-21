import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = path.join(root, "registry.json");
const capabilitiesRoot = path.join(root, "capabilities");

function fail(message) {
  process.stderr.write("registry validation failed: " + message + "\n");
  process.exitCode = 1;
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function walkHandlers(dir) {
  const handlers = [];
  if (!(await exists(dir))) return handlers;

  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      handlers.push(...(await walkHandlers(full)));
    } else if (entry.isFile() && entry.name === "handler.mjs") {
      handlers.push(path.relative(root, full).split(path.sep).join("/"));
    }
  }

  return handlers;
}

const registry = JSON.parse(await fs.readFile(registryPath, "utf8"));
const entries = Object.entries(registry?.capabilities ?? {});
const registeredHandlers = new Set();

for (const [name, entry] of entries) {
  if (entry.lifecycle !== "durable") {
    fail(
      name +
        " must declare lifecycle=durable. Spike/candidate adapters are branch-only and must not be registered on main.",
    );
  }

  if (!entry.promotion || typeof entry.promotion !== "object") {
    fail(name + " is missing promotion metadata.");
  } else {
    const validBasis = new Set(["recurring-use", "recurring-workflow"]);
    if (!validBasis.has(entry.promotion.basis)) {
      fail(name + " has invalid promotion.basis.");
    }

    if (
      !Array.isArray(entry.promotion.evidence) ||
      entry.promotion.evidence.length === 0 ||
      entry.promotion.evidence.some(
        (item) => typeof item !== "string" || item.trim().length === 0,
      )
    ) {
      fail(name + " must have non-empty promotion.evidence.");
    }

    if (
      typeof entry.promotion.reviewed_at !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(entry.promotion.reviewed_at)
    ) {
      fail(name + " must have promotion.reviewed_at in YYYY-MM-DD form.");
    }
  }

  if (
    typeof entry.handler !== "string" ||
    !entry.handler.startsWith("capabilities/") ||
    !entry.handler.endsWith("/handler.mjs")
  ) {
    fail(name + " must point to capabilities/<name>/handler.mjs.");
    continue;
  }

  registeredHandlers.add(entry.handler);

  if (!(await exists(path.join(root, entry.handler)))) {
    fail(name + " references missing handler " + entry.handler + ".");
  }
}

for (const forbidden of ["spikes", "experiments"]) {
  if (await exists(path.join(root, forbidden))) {
    fail(
      forbidden +
        "/ is not allowed on main. Disposable adapters must stay on branches and be removed before merge.",
    );
  }
}

const handlers = await walkHandlers(capabilitiesRoot);
for (const handler of handlers) {
  if (!registeredHandlers.has(handler)) {
    fail(
      handler +
        " is not registered. Main must not contain orphan/disposable capability handlers.",
    );
  }
}

if (!process.exitCode) {
  process.stdout.write(
    "registry validation passed: " +
      entries.length +
      " durable capability/capabilities, no disposable adapters on main.\n",
  );
}
