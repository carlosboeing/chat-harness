import { spawnSync } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sha256File } from "./checksum.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export type MacosArch = "arm64" | "x64";

export function npmHelperPath(arch: MacosArch): string {
  return path.join(root, "dist", "npm", "native", "macos", `darwin-${arch}`, "safe-move");
}

/** Building on macOS is a release/development responsibility, never an install hook. */
export async function buildMacosHelper(arch: MacosArch, output: string): Promise<void> {
  if (process.platform !== "darwin") throw new Error("macOS native helper must be built on macOS.");
  const absolute = path.resolve(output);
  if (!absolute.startsWith(root + path.sep)) throw new Error("Native helper output must stay inside repository.");
  await mkdir(path.dirname(absolute), { recursive: true });
  const ccArch = arch === "arm64" ? "arm64" : "x86_64";
  const result = spawnSync("cc", [
    "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror",
    "-arch", ccArch, "-mmacosx-version-min=12.0",
    path.join(root, "native", "macos", "gate0-safe-move.c"),
    "-o", absolute,
  ], { cwd: root, encoding: "utf8", stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`macOS helper compilation failed (${result.status}).`);
  await chmod(absolute, 0o755);
  const digest = await sha256File(absolute);
  await writeFile(absolute + ".sha256", `${digest}  ${path.basename(absolute)}\n`, "utf8");
}

async function main(): Promise<void> {
  if (process.platform !== "darwin") throw new Error("This build script requires macOS.");
  const arch = process.argv[2] as MacosArch;
  const output = process.argv[3];
  if (!["arm64", "x64"].includes(arch) || !output) {
    throw new Error("Usage: bun scripts/build-macos-helper.ts arm64|x64 <output>");
  }
  await buildMacosHelper(arch, path.resolve(root, output));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
