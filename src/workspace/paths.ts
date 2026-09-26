import path from "node:path";

export const MANAGED_PATHS = [
  "AGENTS.md",
  "_inbox",
  ".chat-harness",
  ".chat-harness/WORKSPACE.md",
  ".chat-harness/README.md",
  ".chat-harness/source-policy.yaml",
  ".chat-harness/workstreams",
  ".chat-harness/workbench",
  ".chat-harness/workbench/0-ideas",
  ".chat-harness/workbench/1-research",
  ".chat-harness/workbench/2-decisions",
  ".chat-harness/workbench/3-plans",
  ".chat-harness/workbench/4-reviews",
  ".chat-harness/procedures",
  ".chat-harness/temp",
] as const;

export type ManagedPath = (typeof MANAGED_PATHS)[number];

export const MANAGED_DIRECTORY_PATHS = new Set<ManagedPath>([
  "_inbox",
  ".chat-harness",
  ".chat-harness/workstreams",
  ".chat-harness/workbench",
  ".chat-harness/workbench/0-ideas",
  ".chat-harness/workbench/1-research",
  ".chat-harness/workbench/2-decisions",
  ".chat-harness/workbench/3-plans",
  ".chat-harness/workbench/4-reviews",
  ".chat-harness/procedures",
  ".chat-harness/temp",
]);

export function expectedManagedKind(
  pathValue: ManagedPath,
): "directory" | "file" {
  return MANAGED_DIRECTORY_PATHS.has(pathValue) ? "directory" : "file";
}

export function absoluteManagedPath(
  workspace: string,
  managedPath: ManagedPath,
): string {
  return path.join(workspace, ...managedPath.split("/"));
}

export function absoluteSetupPath(
  workspace: string,
  relativePath: string,
): string {
  return path.join(workspace, ...relativePath.split("/"));
}
