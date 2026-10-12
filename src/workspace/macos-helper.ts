import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type MacosHelperCode = "unsupported" | "missing" | "invalid" | "failed";

export class MacosHelperError extends Error {
  constructor(readonly code: MacosHelperCode, detail: string) {
    super(`macOS filesystem helper ${code}: ${detail}`);
    this.name = "MacosHelperError";
  }
}

export interface MacosHelperRuntime {
  platform: string;
  arch: string;
  standalone: boolean;
  /** Node bundle path; unused for standalone. */
  entryPath: string;
  /** Actual running Bun standalone executable; unused for Node. */
  executablePath: string;
}

function runtime(): MacosHelperRuntime {
  const bun = (globalThis as typeof globalThis & { Bun?: { isStandaloneExecutable?: boolean } }).Bun;
  return {
    platform: process.platform,
    arch: process.arch,
    standalone: bun?.isStandaloneExecutable === true,
    entryPath: fileURLToPath(import.meta.url),
    executablePath: process.execPath,
  };
}

/** No PATH lookup, environment override, download, runtime compiler or source checkout. */
export function macosHelperPath(info: MacosHelperRuntime = runtime()): string {
  if (info.platform !== "darwin" || !["arm64", "x64"].includes(info.arch)) {
    throw new MacosHelperError("unsupported", `${info.platform}/${info.arch}; native reconciliation is unavailable on this platform.`);
  }
  if (info.standalone) return info.executablePath + ".macos-safe-move";
  return path.join(path.dirname(info.entryPath), "native", "macos", `darwin-${info.arch}`, "safe-move");
}

function regularFile(file: string, executable: boolean): void {
  let info;
  try { info = lstatSync(file); }
  catch {
    throw new MacosHelperError("missing", `missing packaged file ${file}; reinstall Chat Harness from a complete distribution.`);
  }
  if (!info.isFile() || (executable && (info.mode & 0o111) === 0)) {
    throw new MacosHelperError("invalid", `unsafe file type or executable mode at ${file}; reinstall Chat Harness.`);
  }
}

export function verifiedMacosHelper(info: MacosHelperRuntime = runtime()): string {
  const executable = macosHelperPath(info);
  regularFile(executable, true);
  regularFile(executable + ".sha256", false);

  let bytes: Buffer, checksum: string;
  try {
    bytes = readFileSync(executable);
    checksum = readFileSync(executable + ".sha256", "utf8");
  } catch {
    throw new MacosHelperError("invalid", "could not read packaged helper or checksum; reinstall Chat Harness.");
  }
  const match = checksum.match(/^([0-9a-f]{64})  ([A-Za-z0-9.-]+)\n$/);
  if (!match || match[2] !== path.basename(executable) ||
      createHash("sha256").update(bytes).digest("hex") !== match[1]) {
    throw new MacosHelperError("invalid", "helper SHA-256 checksum does not match; reinstall Chat Harness.");
  }

  // Reject scripts, wrong architecture and fat/unknown binaries *before* executing.
  const cpu = info.arch === "arm64" ? 0x0100000c : 0x01000007;
  if (bytes.length < 12 || bytes.readUInt32LE(0) !== 0xfeedfacf ||
      bytes.readUInt32LE(4) !== cpu) {
    throw new MacosHelperError("invalid", `helper is not a thin ${info.arch} macOS Mach-O executable.`);
  }

  const probe = spawnSync(executable, ["--probe"], {
    encoding: "utf8", timeout: 5000, maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"],
  });
  const expected = `chat-harness-macos-helper/1 darwin-${info.arch}\n`;
  if (probe.error || probe.status !== 0 || probe.stdout !== expected || probe.stderr !== "") {
    throw new MacosHelperError("invalid", "helper protocol/architecture probe failed; reinstall Chat Harness.");
  }
  return executable;
}

export interface MacosMove {
  operation: "move" | "promote" | "restore";
  workspace: string;
  parent: string;
  source: string;
  destination: string;
  /** Lowercase hex SHA-256 of the source bytes, without the sha256: prefix. */
  digest: string;
}

/**
 * Bounded native primitive only. Caller must first verify semantic ownership,
 * transaction state and journal safety; never call from legacy setup.
 */
export function invokeMacosSafeMove(input: MacosMove, info: MacosHelperRuntime = runtime()): void {
  const executable = verifiedMacosHelper(info);
  if (!/^[0-9a-f]{64}$/.test(input.digest)) {
    throw new MacosHelperError("invalid", "expected lowercase 64-character SHA-256 digest.");
  }
  const args = [input.operation, input.workspace, input.parent, input.source, input.destination, input.digest];
  const result = spawnSync(executable, args, {
    encoding: "utf8", timeout: 15000, maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    throw new MacosHelperError("failed",
      `no-replace ${input.operation} failed (exit ${result.status ?? "unknown"}). ${(result.stderr ?? "").trim()} Preserve the Workspace and inspect the transaction before retrying.`);
  }
}

export interface MacosStage {
  workspace: string;
  /** Parent directory relative to an explicit physical Workspace root. */
  parent: string;
  destination: string;
  /** Lowercase raw SHA-256 hex of the exact desired bytes. */
  digest: string;
  content: Buffer | Uint8Array;
}

/**
 * Descriptor-anchored, exclusive creation primitive for one stage only.
 * No parent mkdir, journal creation, rollback or production setup integration.
 */
export function invokeMacosSafeStage(input: MacosStage, info: MacosHelperRuntime = runtime()): void {
  if (!/^[0-9a-f]{64}$/.test(input.digest)) {
    throw new MacosHelperError("invalid", "stage requires a lowercase SHA-256 hex digest.");
  }
  const content = Buffer.from(input.content);
  if (content.length > 16 * 1024 * 1024 ||
      createHash("sha256").update(content).digest("hex") !== input.digest) {
    throw new MacosHelperError("invalid", "stage payload is oversized or differs from expected digest.");
  }
  const executable = verifiedMacosHelper(info);
  const args = ["stage", input.workspace, input.parent, input.destination, input.digest];
  const result = spawnSync(executable, args, {
    input: content, encoding: "utf8", timeout: 15000, maxBuffer: 4096,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    throw new MacosHelperError("failed",
      `exclusive native stage failed (exit ${result.status ?? "unknown"}). ${(result.stderr ?? "").trim()} Preserve the Workspace and inspect transaction state.`);
  }
}
