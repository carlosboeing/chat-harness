import { copyFileSync, existsSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { INSTALL_METADATA_BASENAME } from "./installation.js";
import { verifiedMacosHelper } from "../workspace/macos-helper.js";
import { createHash } from "node:crypto";

export interface WindowsLifecycleJob {
  schema: 1;
  action: "replace" | "remove";
  parentPid: number;
  target: string;
  metadataPath?: string;
  staged?: string;
  expectedVersion?: string;
  backupPath?: string;
  nativeHelper?: {staged:string;backupPath:string;digest:string};
  helperPath: string;
  jobPath: string;
}

export interface WindowsHelperDependencies {
  exists(target: string): boolean;
  rename(source: string, destination: string): void;
  remove(target: string): void;
  verifyVersion(binary: string, expected: string): void;
  verifyNativeHelper?(binary: string, digest:string): void;
  isProcessRunning(pid: number): boolean;
  sleep(milliseconds: number): Promise<void>;
  scheduleCleanup(paths: string[]): void;
}

function verifyVersion(binary: string, expected: string): void {
  const result = spawnSync(binary, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0 || (result.stdout ?? "").trim() !== expected) {
    throw new Error("Updated executable did not report expected version " + expected + ".");
  }
}

function isProcessRunning(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function scheduleCleanup(paths: string[]): void {
  if (process.platform !== "win32" || paths.length === 0) return;

  const env = { ...process.env };
  const variables = paths.map((value, index) => {
    const name = "CHAT_HARNESS_CLEANUP_" + index;
    env[name] = value;
    return "%" + name + "%";
  });
  const quoted = variables.map((value) => '"' + value + '"').join(" ");
  const command = "ping 127.0.0.1 -n 2 > nul & del /f /q " + quoted;

  try {
    const child = spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env,
    });
    child.unref();
  } catch {
    // Temp helper cleanup is best effort after the lifecycle operation succeeds.
  }
}

export const defaultWindowsHelperDependencies: WindowsHelperDependencies = {
  exists: existsSync,
  rename: renameSync,
  remove: (target) => rmSync(target, { force: true }),
  verifyVersion,
  verifyNativeHelper:(binary,digest)=>{
    const file=binary+".windows-safe-move.exe";
    if(createHash("sha256").update(readFileSync(file)).digest("hex")!==digest)throw new Error("Installed Windows native helper digest differs from approved download.");
    writeFileSync(file+".sha256",digest+"  "+path.basename(file)+"\n");
    verifiedMacosHelper({platform:"win32",arch:"x64",standalone:true,entryPath:"unused",executablePath:binary});
  },
  isProcessRunning,
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  scheduleCleanup,
};

function normalizedPath(value: string): string {
  try { return realpathSync(value).toLowerCase(); }
  catch { return path.resolve(value).toLowerCase(); }
}

function validateJobPaths(
  job: WindowsLifecycleJob,
  actualHelperPath?: string,
  actualJobPath?: string,
): void {
  if (path.basename(job.target).toLowerCase() !== "chat-harness.exe") {
    throw new Error("Windows lifecycle target must be chat-harness.exe.");
  }

  const installDirectory = path.resolve(path.dirname(job.target));
  if (
    job.metadataPath &&
    path.resolve(job.metadataPath) !== path.join(installDirectory, INSTALL_METADATA_BASENAME)
  ) {
    throw new Error("Windows lifecycle metadata path is outside the installation boundary.");
  }

  if (job.action === "replace") {
    if (!job.staged || !job.expectedVersion || !job.backupPath) {
      throw new Error("Windows replacement job is incomplete.");
    }

    const stagedName = path.basename(job.staged).toLowerCase();
    if (
      path.resolve(path.dirname(job.staged)) !== installDirectory ||
      !stagedName.startsWith(".chat-harness-update.") ||
      !stagedName.endsWith(".exe")
    ) {
      throw new Error("Windows staged update is outside the installation boundary.");
    }

    const backupName = path.basename(job.backupPath).toLowerCase();
    if (
      path.resolve(path.dirname(job.backupPath)) !== installDirectory ||
      !backupName.startsWith(".chat-harness-backup.") ||
      !backupName.endsWith(".exe")
    ) {
      throw new Error("Windows backup path is outside the installation boundary.");
    }
    if(job.nativeHelper && (job.nativeHelper.staged!==job.staged+".windows-safe-move.exe" ||
      job.nativeHelper.backupPath!==job.backupPath+".windows-safe-move.exe" || !/^[0-9a-f]{64}$/.test(job.nativeHelper.digest)))throw new Error("Windows native helper paths or digest are outside the software update boundary.");
  }

  const tempDirectory = path.resolve(os.tmpdir());
  const helperName = path.basename(job.helperPath).toLowerCase();
  const jobName = path.basename(job.jobPath).toLowerCase();
  if (
    path.resolve(path.dirname(job.helperPath)) !== tempDirectory ||
    !helperName.startsWith("chat-harness-lifecycle-") ||
    !helperName.endsWith(".exe")
  ) {
    throw new Error("Invalid Windows lifecycle helper path.");
  }
  if (
    path.resolve(path.dirname(job.jobPath)) !== tempDirectory ||
    !jobName.startsWith("chat-harness-lifecycle-") ||
    !jobName.endsWith(".json")
  ) {
    throw new Error("Invalid Windows lifecycle job path.");
  }

  if (actualHelperPath && normalizedPath(job.helperPath) !== normalizedPath(actualHelperPath)) {
    throw new Error("Lifecycle job does not belong to this helper executable.");
  }
  if (actualJobPath && normalizedPath(job.jobPath) !== normalizedPath(actualJobPath)) {
    throw new Error("Lifecycle job path does not match the requested job.");
  }
}

export async function runWindowsLifecycleJob(
  job: WindowsLifecycleJob,
  dependencies: WindowsHelperDependencies = defaultWindowsHelperDependencies,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (dependencies.isProcessRunning(job.parentPid)) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for parent process " + job.parentPid + " to exit.");
    }
    await dependencies.sleep(100);
  }

  if (job.action === "remove") {
    dependencies.remove(job.target);
    dependencies.remove(job.target+".windows-safe-move.exe");
    dependencies.remove(job.target+".windows-safe-move.exe.sha256");
    if (job.metadataPath) dependencies.remove(job.metadataPath);
    dependencies.scheduleCleanup([job.helperPath, job.jobPath]);
    return;
  }

  const staged = job.staged;
  const expectedVersion = job.expectedVersion;
  const backupPath = job.backupPath;
  if (!staged || !expectedVersion || !backupPath) {
    throw new Error("Windows replacement job is incomplete.");
  }
  const replacements=[{target:job.target,staged,backup:backupPath}];
  if(job.nativeHelper) {
    const companion=job.target+".windows-safe-move.exe";
    if(dependencies.exists(companion)!==dependencies.exists(companion+".sha256"))throw new Error("Existing Windows native helper pair is incomplete; preserve installation.");
    replacements.push({target:companion,staged:job.nativeHelper.staged,backup:job.nativeHelper.backupPath},
      {target:companion+".sha256",staged:job.nativeHelper.staged+".sha256",backup:job.nativeHelper.backupPath+".sha256"});
  }
  for(const file of replacements)if(dependencies.exists(file.backup))throw new Error("Refusing to overwrite existing update backup: "+file.backup);
  const backedUp=new Set<string>(),installed=new Set<string>();
  try {
    for(const file of replacements) {
      if(dependencies.exists(file.target)){dependencies.rename(file.target,file.backup);backedUp.add(file.target);}
      dependencies.rename(file.staged,file.target);installed.add(file.target);
    }
    dependencies.verifyVersion(job.target, expectedVersion);
    if(job.nativeHelper) {
      if(!dependencies.verifyNativeHelper)throw new Error("Windows native verification is unavailable.");
      dependencies.verifyNativeHelper(job.target,job.nativeHelper.digest);
    }
  } catch (error) {
    try {
      for(const file of [...replacements].reverse()) {
        if(installed.has(file.target))dependencies.remove(file.target);
        if(backedUp.has(file.target))dependencies.rename(file.backup,file.target);
      }
    } catch {
      throw new Error(
        "Windows update failed and rollback also failed: " +
        (error instanceof Error ? error.message : String(error)),
      );
    }
    throw error;
  } finally {
    for(const file of replacements)if(dependencies.exists(file.staged))dependencies.remove(file.staged);
  }
  for(const file of replacements)if(backedUp.has(file.target))dependencies.remove(file.backup);
  dependencies.scheduleCleanup([job.helperPath, job.jobPath]);
}

export function parseWindowsLifecycleJob(source: string): WindowsLifecycleJob {
  let value: Partial<WindowsLifecycleJob>;
  try {
    value = JSON.parse(source) as Partial<WindowsLifecycleJob>;
  } catch {
    throw new Error("Invalid Windows lifecycle job.");
  }

  if (
    value.schema !== 1 ||
    (value.action !== "replace" && value.action !== "remove") ||
    !Number.isInteger(value.parentPid) ||
    !value.target ||
    !value.helperPath ||
    !value.jobPath
  ) {
    throw new Error("Invalid Windows lifecycle job.");
  }
  return value as WindowsLifecycleJob;
}

export async function runWindowsLifecycleHelper(jobPath: string): Promise<void> {
  const job = parseWindowsLifecycleJob(readFileSync(jobPath, "utf8"));
  validateJobPaths(job, process.execPath, jobPath);
  await runWindowsLifecycleJob(job);
}

export interface ScheduleWindowsLifecycleJobInput {
  action: "replace" | "remove";
  target: string;
  metadataPath?: string;
  staged?: string;
  expectedVersion?: string;
  currentExecutable: string;
  parentPid?: number;
  withNativeHelper?: boolean;
}

export function scheduleWindowsLifecycleJob(
  input: ScheduleWindowsLifecycleJobInput,
): { helperPath: string; jobPath: string } {
  const suffix = process.pid + "-" + Date.now();
  const helperPath = path.join(os.tmpdir(), "chat-harness-lifecycle-" + suffix + ".exe");
  const jobPath = path.join(os.tmpdir(), "chat-harness-lifecycle-" + suffix + ".json");
  const backupPath = input.action === "replace"
    ? path.join(path.dirname(input.target), ".chat-harness-backup." + suffix + ".exe")
    : undefined;

  try {
    copyFileSync(input.currentExecutable, helperPath);
    const job: WindowsLifecycleJob = {
      schema: 1,
      action: input.action,
      parentPid: input.parentPid ?? process.pid,
      target: input.target,
      ...(input.metadataPath ? { metadataPath: input.metadataPath } : {}),
      ...(input.staged ? { staged: input.staged } : {}),
      ...(input.expectedVersion ? { expectedVersion: input.expectedVersion } : {}),
      ...(backupPath ? { backupPath } : {}),
      ...(input.withNativeHelper && input.staged && backupPath ? {nativeHelper:{staged:input.staged+".windows-safe-move.exe",backupPath:backupPath+".windows-safe-move.exe",digest:createHash("sha256").update(readFileSync(input.staged+".windows-safe-move.exe")).digest("hex")}} : {}),
      helperPath,
      jobPath,
    };
    validateJobPaths(job);
    writeFileSync(jobPath, JSON.stringify(job) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });

    const child = spawn(helperPath, ["__lifecycle-helper", jobPath], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    if (child.pid === undefined) throw new Error("Could not start Windows lifecycle helper.");
    child.unref();
    return { helperPath, jobPath };
  } catch (error) {
    rmSync(helperPath, { force: true });
    rmSync(jobPath, { force: true });
    throw error;
  }
}
