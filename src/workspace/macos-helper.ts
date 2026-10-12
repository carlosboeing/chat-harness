import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type MacosHelperCode = "unsupported" | "missing" | "invalid" | "failed";

export class MacosHelperError extends Error {
  constructor(readonly code: MacosHelperCode, detail: string) {
    super(`native filesystem helper ${code}: ${detail}`);
    this.name = "MacosHelperError";
  }
}

export interface MacosHelperRuntime {
  /** Native lease-bound physical root identity for transaction calls. */
  rootIdentity?: string;
  tempIdentity?: string;
  ownerPid?: number;
  leasePid?: number;
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
  if (!["darwin","linux"].includes(info.platform) || !["arm64", "x64"].includes(info.arch)) {
    throw new MacosHelperError("unsupported", `${info.platform}/${info.arch}; native reconciliation is unavailable on this platform.`);
  }
  if (info.standalone) return info.executablePath + (info.platform === "darwin" ? ".macos-safe-move" : ".linux-safe-move");
  return path.join(path.dirname(info.entryPath), "native", info.platform === "darwin" ? "macos" : "linux", `${info.platform}-${info.arch}`, "safe-move");
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
  const valid = info.platform === "darwin"
    ? bytes.length >= 12 && bytes.readUInt32LE(0) === 0xfeedfacf && bytes.readUInt32LE(4) === cpu
    : bytes.length >= 64 && bytes.subarray(0,4).equals(Buffer.from([0x7f,0x45,0x4c,0x46])) &&
      bytes[4] === 2 && bytes[5] === 1 && bytes.readUInt16LE(18) === (info.arch === "arm64" ? 183 : 62) &&
      bytes.readUInt16LE(16) === 2;
  if (!valid) throw new MacosHelperError("invalid", `helper has wrong executable format or ${info.arch} architecture.`);

  const probe = spawnSync(executable, ["--probe"], {
    encoding: "utf8", timeout: 5000, maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"],
  });
  const expected = info.platform === "darwin" ? `chat-harness-macos-helper/1 darwin-${info.arch}\n` : `chat-harness-native-helper/1 linux-${info.arch}\n`;
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
  const result = spawnSync(executable, guardedArguments(args, info), {
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
  const result = spawnSync(executable, guardedArguments(args, info), {
    input: content, encoding: "utf8", timeout: 15000, maxBuffer: 4096,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    throw new MacosHelperError("failed",
      `exclusive native stage failed (exit ${result.status ?? "unknown"}). ${(result.stderr ?? "").trim()} Preserve the Workspace and inspect transaction state.`);
  }
}

/**
 * Reserve only .chat-harness/temp/reconcile inside an existing verified
 * Workspace. Returns on exclusive creation; never opens, adopts or removes
 * another process's transaction. Apply/recovery integration is separate.
 */
export function reserveMacosReconciliationLock(workspace: string, info: MacosHelperRuntime = runtime()): void {
  const executable = verifiedMacosHelper(info);
  const result = spawnSync(executable, guardedArguments(["reserve", workspace], info), {
    encoding: "utf8", timeout: 15000, maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    throw new MacosHelperError("failed",
      `exclusive reconciliation reservation failed (exit ${result.status ?? "unknown"}). Preserve existing transaction state and inspect it read-only.`);
  }
}

/** Fixed, descriptor-relative operations; namespace/ownership belongs to the engine. */
export function invokeMacosFilesystemOperation(
  operation: "mkdir" | "rmdir" | "verify" | "discard",
  workspace: string, relative: string, digest?: string, info: MacosHelperRuntime = runtime(),
): void {
  const parent = path.posix.dirname(relative), leaf = path.posix.basename(relative);
  if ((operation === "verify" || operation === "discard") && !/^[0-9a-f]{64}$/.test(digest ?? "")) {
    throw new MacosHelperError("invalid", "operation requires exact SHA-256");
  }
  const result = spawnSync(verifiedMacosHelper(info), guardedArguments([operation,workspace,parent,leaf,...(digest ? [digest] : [])], info),
    {encoding:"utf8",timeout:15000,maxBuffer:4096,stdio:["ignore","pipe","pipe"]});
  if (result.error || result.status !== 0) throw new MacosHelperError("failed", `${operation} failed for ${relative}; preserve transaction evidence.`);
}

/** Keep the native lease alive until the returned release function is called. */
function guardedArguments(args: string[], info: MacosHelperRuntime): string[] {
  if(info.rootIdentity !== undefined && !/^[0-9]+:[0-9]+$/.test(info.rootIdentity))throw new MacosHelperError("invalid","Invalid root identity");
  if(info.tempIdentity !== undefined && !/^[0-9]+:[0-9]+$/.test(info.tempIdentity))throw new MacosHelperError("invalid","Invalid temp identity");
  if(info.leasePid !== undefined && (!Number.isSafeInteger(info.leasePid) || info.leasePid<=0))throw new MacosHelperError("invalid","Invalid lease identity");
  if(info.ownerPid !== undefined && (!Number.isSafeInteger(info.ownerPid) || info.ownerPid<=0))throw new MacosHelperError("invalid","Invalid orchestrator identity");
  return [...args,...(info.rootIdentity ? ["--root-identity="+info.rootIdentity] : []),
    ...(info.tempIdentity ? ["--temp-identity="+info.tempIdentity] : []),...(info.ownerPid ? ["--owner-pid="+info.ownerPid] : []),...(info.leasePid ? ["--lease-pid="+info.leasePid] : [])];
}
export function withMacosRootIdentity(identity: string, info: MacosHelperRuntime = runtime()): MacosHelperRuntime {
  return {...info,rootIdentity:identity,ownerPid:process.pid};
}
export async function acquireMacosWorkspaceLease(workspace: string, info: MacosHelperRuntime = runtime()): Promise<{release:()=>Promise<void>;identity:string;pid:number;pin:()=>Promise<string>}> {
  const child = spawn(verifiedMacosHelper(info), ["lease",workspace], {stdio:["pipe","pipe","pipe"]});
  child.stdin.on("error",()=>{});
  const exited = new Promise<void>((resolve)=>child.once("close",()=>resolve()));
  let identity = "";
  await new Promise<void>((resolve,reject)=>{
    const timer = setTimeout(()=>{child.kill();reject(new MacosHelperError("failed","lease timeout"));},5000);
    let output = "";
    child.stdout.on("data",chunk=>{
      output += String(chunk);
      const match=output.match(/^locked ([0-9]+:[0-9]+)\n$/);
      if (match) {identity=match[1]!;clearTimeout(timer);resolve();}
      else if (output.length > 4096) {clearTimeout(timer);child.kill();reject(new MacosHelperError("invalid","lease protocol"));}
    });
    child.once("error",error=>{clearTimeout(timer);reject(error);});
    child.once("close",()=>{clearTimeout(timer);reject(new MacosHelperError("failed","Workspace is busy or unsafe"));});
  });
  return {identity,pid:child.pid!,release:async ()=>{child.stdin.end();await exited;},pin:()=>new Promise<string>((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(new MacosHelperError("failed","Temp registration timeout"));},5000);
    const receive=(chunk:Buffer)=>{const match=String(chunk).match(/^pinned ([0-9]+:[0-9]+)\n$/);clearTimeout(timer);child.stdout.off("data",receive);if(match)resolve(match[1]!);else reject(new MacosHelperError("invalid","Temp registration protocol"));};
    child.stdout.on("data",receive);child.stdin.write("pin\n");
  })};
}

/** Atomically move a settled reservation into its bounded cleanup namespace. */
export function retireMacosReconciliationLock(workspace: string, info: MacosHelperRuntime = runtime()): void {
  const result = spawnSync(verifiedMacosHelper(info), guardedArguments(["retire",workspace], info),
    {encoding:"utf8",timeout:15000,maxBuffer:4096,stdio:["ignore","pipe","pipe"]});
  if(result.error || result.status !== 0)throw new MacosHelperError("failed","Could not retire transaction; preserve evidence.");
}
