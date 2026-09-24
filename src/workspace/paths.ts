import path from "node:path";

export const MANAGED_PATHS = [
  "AGENTS.md",
  ".chat-harness",
  ".chat-harness/README.md",
  ".chat-harness/workstreams",
] as const;

export type ManagedPath = (typeof MANAGED_PATHS)[number];

export const MANAGED_DIRECTORY_PATHS = new Set<ManagedPath>([
  ".chat-harness",
  ".chat-harness/workstreams",
]);

export function absoluteManagedPath(
  workspace: string,
  managedPath: ManagedPath,
): string {
  return path.join(workspace, ...managedPath.split("/"));
}
