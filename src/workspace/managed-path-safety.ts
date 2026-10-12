import { link, lstat, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { MANAGED_DIRECTORY_PATHS, type ManagedPath } from "./paths.js";

export type ManagedFileOwner = "core" | "specialist" | "workspace" | "transaction" | "scaffold";

export class ManagedPathSafetyError extends Error {
  readonly code = "setup.managed_path_unsafe";
  readonly relativePath: string;
  constructor(relativePath: string, reason: string) {
    super("Unsafe managed path " + JSON.stringify(relativePath) + ": " + reason);
    this.relativePath = relativePath;
    this.name = "ManagedPathSafetyError";
  }
}

function fail(relative: string, reason: string): never {
  throw new ManagedPathSafetyError(relative, reason);
}

/** Validates a manifest/registry destination without normalizing dangerous input. */
export function assertCanonicalManagedPath(relative: string, owner: ManagedFileOwner): void {
  if (!relative || relative.includes("\0") || relative.includes("\\") || relative.includes(":")) {
    fail(relative, "empty name, NUL, backslash or colon");
  }
  if (relative.startsWith("/") || path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative)) {
    fail(relative, "absolute or drive-qualified path");
  }
  if (relative !== relative.normalize("NFC")) fail(relative, "noncanonical Unicode name");
  const segments = relative.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    fail(relative, "empty, dot or parent segment");
  }
  for (const segment of segments) {
    if (/[\x00-\x1f\x7f]/.test(segment) || /[ .]$/.test(segment) || /[<>"|?*]/.test(segment)) {
      fail(relative, "control, reserved or alias-prone filename");
    }
    if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)) {
      fail(relative, "reserved device filename");
    }
  }
  const permitted = owner === "core" ? relative === "AGENTS.md"
    : owner === "workspace" ? relative === ".chat-harness/WORKSPACE.md" || relative === ".chat-harness/manifest.yaml"
    : owner === "transaction" ? relative === ".chat-harness/temp/reconcile"
    : owner === "scaffold" ? relative === ".chat-harness/source-policy.yaml" ||
      MANAGED_DIRECTORY_PATHS.has(relative as ManagedPath) ||
      (segments.length === 1 && /^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(relative))
    : segments.length >= 3 && segments[0] === ".chat-harness" && segments[1] === "procedures";
  if (!permitted) fail(relative, "destination outside " + owner + " namespace");
}

function sameIdentity(a: { dev: number; ino: number }, b: { dev: number; ino: number }): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

/** Read-only inspection; repeat after directory creation and before mutation. */
export async function inspectManagedDestination(
  workspace: string,
  relative: string,
  owner: ManagedFileOwner,
): Promise<string> {
  assertCanonicalManagedPath(relative, owner);
  const root = path.resolve(workspace);
  const segments = relative.split("/");
  let parent = root;
  for (let index = 0; index < segments.length; index += 1) {
    let before;
    try {
      before = await lstat(parent);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
    if (!before.isDirectory() || before.isSymbolicLink()) {
      fail(relative, "Workspace root or an ancestor is not a real directory");
    }
    const name = segments[index]!;
    const entries = await readdir(parent);
    const aliases = entries.filter((entry) => entry.normalize("NFC").toLowerCase() === name.toLowerCase());
    if (aliases.some((entry) => entry !== name) || aliases.length > 1) {
      fail(relative, "case or Unicode alias at " + name);
    }
    const child = path.join(parent, name);
    let childInfo;
    try {
      childInfo = await lstat(child);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (childInfo?.isSymbolicLink()) fail(relative, "symlink at " + name);
    if (childInfo && index < segments.length - 1 && !childInfo.isDirectory()) {
      fail(relative, "non-directory ancestor at " + name);
    }
    const after = await lstat(parent);
    if (!sameIdentity(before, after) || !after.isDirectory() || after.isSymbolicLink()) {
      fail(relative, "parent changed during inspection");
    }
    parent = child;
  }
  return path.join(root, ...segments);
}

/**
 * Atomically creates the destination from a verified sibling stage, never replacing it.
 * Caller owns journaling, digest verification, and recovery after interruption.
 * Crash after link but before unlink may leave BOTH stage and target hardlinks.
 */
export async function promoteStageNoReplace(stage: string, target: string): Promise<void> {
  if (path.dirname(stage) !== path.dirname(target) || stage === target) {
    throw new Error("Stage and destination must be distinct sibling paths");
  }
  const info = await lstat(stage);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error("Stage must be a regular file, not a symlink");
  }
  await link(stage, target);
  await unlink(stage);
}
