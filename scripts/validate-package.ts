import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

interface NpmPackEntry { path?: string }
interface NpmPackResult { files?: NpmPackEntry[] }

export function validatePackedPaths(paths: readonly string[]): string[] {
  const errors: string[] = [];
  const forbidden = [
    ".chat-harness/",
    "evals/",
    "examples/",
    "extensions/",
    "capabilities/",
    "tests/",
    "registry.json",
    ".github/",
  ];
  for (const item of paths) {
    for (const prefix of forbidden) {
      if (item === prefix.replace(/\/$/, "") || item.startsWith(prefix)) {
        errors.push(`npm package contains forbidden repository/runtime material: ${item}`);
      }
    }
  }
  for (const required of ["package.json", "README.md", "LICENSE", "dist/npm/chat-harness.js"]) {
    if (!paths.includes(required)) errors.push(`npm package missing required file: ${required}`);
  }
  return errors.sort();
}

async function main(): Promise<void> {
  const manifest = process.argv[2];
  if (!manifest) throw new Error("Usage: bun scripts/validate-package.ts <npm-pack-json>");
  const parsed = JSON.parse(await readFile(manifest, "utf8")) as NpmPackResult[];
  const paths = parsed[0]?.files?.map((entry) => entry.path).filter((value): value is string => Boolean(value)) ?? [];
  const errors = validatePackedPaths(paths);
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`package validation failed: ${error}\n`);
    process.exit(1);
  }
  process.stdout.write(`package validation passed: ${paths.length} packed files.\n`);
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) await main();
