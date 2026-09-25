import { lstat, readFile } from "node:fs/promises";
import { absoluteManagedPath, MANAGED_PATHS, type ManagedPath } from "./paths.js";

export type PathKind = "missing" | "file" | "directory" | "symlink" | "other";
export interface ManagedPathObservation {
  path: ManagedPath;
  absolutePath: string;
  kind: PathKind;
  content?: string;
}
export interface WorkspaceInspection {
  workspace: string;
  observations: ReadonlyArray<ManagedPathObservation>;
}

async function inspectPath(workspace: string, managedPath: ManagedPath): Promise<ManagedPathObservation> {
  const absolutePath = absoluteManagedPath(workspace, managedPath);
  try {
    const info = await lstat(absolutePath);
    const kind: PathKind = info.isSymbolicLink() ? "symlink" : info.isDirectory() ? "directory" : info.isFile() ? "file" : "other";
    const shouldRead = kind === "file" && (managedPath === "AGENTS.md" || managedPath === ".chat-harness/WORKSPACE.md");
    return { path: managedPath, absolutePath, kind, ...(shouldRead ? { content: await readFile(absolutePath, "utf8") } : {}) };
  } catch (error) {
    if (error instanceof Error && "code" in error && ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) {
      return { path: managedPath, absolutePath, kind: "missing" };
    }
    throw error;
  }
}

export async function inspectWorkspace(workspace: string): Promise<WorkspaceInspection> {
  const observations: ManagedPathObservation[] = [];
  for (const managedPath of MANAGED_PATHS) observations.push(await inspectPath(workspace, managedPath));
  return Object.freeze({ workspace, observations: Object.freeze(observations) });
}
