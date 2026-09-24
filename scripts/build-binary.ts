import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const supported = new Set([
  "bun-linux-x64",
  "bun-linux-arm64",
  "bun-darwin-x64",
  "bun-darwin-arm64",
  "bun-windows-x64",
]);

export async function buildBinary(target: string, outfile: string): Promise<void> {
  if (!supported.has(target)) throw new Error(`Unsupported release target: ${target}`);
  const absolute = path.resolve(root, outfile);
  if (!absolute.startsWith(root + path.sep)) throw new Error("Output must remain inside repository.");
  await mkdir(path.dirname(absolute), { recursive: true });

  const result = spawnSync(
    "bun",
    [
      "build",
      "--compile",
      `--target=${target}`,
      "--minify",
      "--no-compile-autoload-dotenv",
      "--no-compile-autoload-bunfig",
      "src/cli/main.ts",
      `--outfile=${absolute}`,
    ],
    { cwd: root, encoding: "utf8", stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`bun build exited with status ${result.status}`);
}

async function main(): Promise<void> {
  const target = process.argv[2];
  const outfile = process.argv[3];
  if (!target || !outfile) {
    throw new Error("Usage: bun scripts/build-binary.ts <bun-target> <outfile>");
  }
  await buildBinary(target, outfile);
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) await main();
