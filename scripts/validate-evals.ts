import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = path.join(root, "evals", "scenarios", "v0.1.json");

interface Scenario {
  id: string;
  fixture: string;
  objective: string;
  prompt: string;
  required_behaviours: string[];
  forbidden_behaviours: string[];
  evidence_notes: string;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function nonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => nonEmptyString(item))
  );
}

export async function validateScenarioCatalog(): Promise<string[]> {
  const errors: string[] = [];
  let parsed: unknown;

  try {
    parsed = JSON.parse(await readFile(catalogPath, "utf8"));
  } catch (error) {
    return [
      `eval scenario catalog could not be read: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }

  if (!Array.isArray(parsed)) {
    return ["eval scenario catalog must be a JSON array"];
  }

  const ids = new Set<string>();
  for (const [index, raw] of parsed.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      errors.push(`scenario[${index}] must be an object`);
      continue;
    }

    const value = raw as Record<string, unknown>;
    const allowed = new Set([
      "id",
      "fixture",
      "objective",
      "prompt",
      "required_behaviours",
      "forbidden_behaviours",
      "evidence_notes",
    ]);
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) errors.push(`scenario[${index}] has unknown field ${key}`);
    }

    for (const key of ["id", "fixture", "objective", "prompt", "evidence_notes"] as const) {
      if (!nonEmptyString(value[key])) errors.push(`scenario[${index}].${key} must be a non-empty string`);
    }
    if (!nonEmptyStringArray(value.required_behaviours)) {
      errors.push(`scenario[${index}].required_behaviours must be a non-empty string array`);
    }
    if (!nonEmptyStringArray(value.forbidden_behaviours)) {
      errors.push(`scenario[${index}].forbidden_behaviours must be a non-empty string array`);
    }

    if (nonEmptyString(value.id)) {
      if (ids.has(value.id)) errors.push(`duplicate scenario id: ${value.id}`);
      ids.add(value.id);
    }

    if (nonEmptyString(value.fixture)) {
      const fixture = path.resolve(root, value.fixture);
      if (!fixture.startsWith(root + path.sep)) {
        errors.push(`scenario[${index}] fixture escapes repository: ${value.fixture}`);
      } else {
        try { await access(fixture); }
        catch { errors.push(`scenario[${index}] fixture does not exist: ${value.fixture}`); }
      }
    }
  }

  if (parsed.length < 1) errors.push("eval scenario catalog must not be empty");
  return errors.sort();
}

async function main(): Promise<void> {
  const errors = await validateScenarioCatalog();
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`eval validation failed: ${error}\n`);
    process.exit(1);
  }
  const scenarios = JSON.parse(await readFile(catalogPath, "utf8")) as Scenario[];
  process.stdout.write(`eval validation passed: ${scenarios.length} behavioural scenarios.\n`);
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) await main();
