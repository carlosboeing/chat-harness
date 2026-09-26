import { constants, accessSync, copyFileSync, mkdirSync, renameSync, rmSync, chmodSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildBinary } from "./build-binary.js";

type ExecFn = typeof execFileSync;

export function getTargetName(platform: string = process.platform, arch: string = process.arch): string {
  if (platform !== "darwin" && platform !== "linux") {
    throw new Error(`Unsupported platform: ${platform}. Local installs currently support macOS and Linux.`);
  }
  if (arch === "arm64" || arch === "aarch64") return `bun-${platform}-arm64`;
  if (arch === "x64" || arch === "x86_64" || arch === "amd64") return `bun-${platform}-x64`;
  throw new Error(`Unsupported architecture: ${arch}`);
}

export function getBinDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CHAT_HARNESS_BIN_DIR || path.join(os.homedir(), ".local", "bin");
}

export function resolveLocalVersion(execFn: ExecFn = execFileSync, cwd = process.cwd()): string {
  const pkgVersion = (JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8")) as { version: string }).version;
  try {
    const sha = String(execFn("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", cwd })).trim();
    const dirty = String(execFn("git", ["status", "--porcelain"], { encoding: "utf8", cwd })).trim().length > 0;
    return `${pkgVersion}-${sha}${dirty ? "-dirty" : ""}`;
  } catch {
    return pkgVersion;
  }
}

export function installBinary(binDir: string, sourceBin: string): string {
  if (!sourceBin) throw new Error("Source binary path is required.");
  accessSync(sourceBin, constants.R_OK);
  mkdirSync(binDir, { recursive: true });

  const target = path.join(binDir, "chat-harness");
  const temp = path.join(binDir, `.chat-harness.tmp.${process.pid}.${Date.now()}`);
  copyFileSync(sourceBin, temp);
  chmodSync(temp, 0o755);
  renameSync(temp, target);
  return target;
}

export function findExecutableOnPath(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  for (const directory of (env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue searching PATH.
    }
  }
  return null;
}

export function verifyInstalledVersion(
  binary: string,
  expectedVersion: string,
  execFn: ExecFn = execFileSync,
): void {
  const actual = String(execFn(binary, ["--version"], { encoding: "utf8" })).trim();
  if (actual !== expectedVersion) {
    throw new Error(`Installed binary reported ${actual || "(no version)"}, expected ${expectedVersion}.`);
  }
}

function localEntrypoint(version: string): string {
  return [
    'process.env.CHAT_HARNESS_SUPPRESS_AUTO_RUN = "1";',
    'const { runCli } = await import("../../src/cli/main.ts");',
    `const code = await runCli(process.argv.slice(2), { version: ${JSON.stringify(version)} });`,
    "process.exitCode = code;",
    "",
  ].join("\\n");
}

export async function main(): Promise<void> {
  const root = process.cwd();
  const target = getTargetName();
  const version = resolveLocalVersion(execFileSync, root);
  const binDir = getBinDir();
  const platformName = target.replace(/^bun-/, "");
  const entrypoint = path.join(root, "dist", "local", "entry.ts");
  const sourceBin = path.join(root, "dist", "local", `chat-harness-${platformName}`);

  console.log("chat-harness install:local");
  console.log(`Version: ${version}`);
  console.log(`Target:  ${platformName}`);
  console.log(`Bin dir: ${binDir}\n`);

  mkdirSync(path.dirname(entrypoint), { recursive: true });
  writeFileSync(entrypoint, localEntrypoint(version), "utf8");

  try {
    console.log("1. Building standalone binary...");
    await buildBinary(target, path.relative(root, sourceBin), path.relative(root, entrypoint));

    console.log("\n2. Installing local binary...");
    const installed = installBinary(binDir, sourceBin);
    console.log(`✓ Installed ${installed}`);

    console.log("\n3. Verifying installed version...");
    verifyInstalledVersion(installed, version);
    console.log(`✓ ${installed} --version => ${version}`);

    const active = findExecutableOnPath("chat-harness");
    console.log("\n4. Checking PATH...");
    if (active === null) {
      console.warn(`⚠ chat-harness is not currently resolvable on PATH. Add ${binDir} to PATH.`);
    } else if (path.resolve(active) !== path.resolve(installed)) {
      console.warn("⚠ The active chat-harness command is not this local build.");
      console.warn(`  Active:    ${active}`);
      console.warn(`  Installed: ${installed}`);
      console.warn(`  Put ${binDir} earlier in PATH, or set CHAT_HARNESS_BIN_DIR to the directory you want to install into.`);
    } else {
      console.log(`✓ Active command: ${active}`);
    }

    console.log(`\n✔ Local Chat Harness build installed (${version}).`);
  } finally {
    rmSync(entrypoint, { force: true });
  }
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`error: ${message}`);
    process.exitCode = 1;
  });
}
