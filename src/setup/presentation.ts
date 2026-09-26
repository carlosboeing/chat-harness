import path from "node:path";

import { expectedManagedKind } from "../workspace/paths.js";
import type { SetupOperation, SetupPlan } from "./plan.js";

export type SetupStructureKind = "directory" | "file";
export type SetupStructureStatus =
  | "new"
  | "created"
  | "updated"
  | "already_there";

export interface SetupStructureEntry {
  path: string;
  kind: SetupStructureKind;
  status: SetupStructureStatus;
}

export type SetupStructurePhase = "planned" | "applied";

function operationStatus(
  operation: SetupOperation | undefined,
  phase: SetupStructurePhase,
): SetupStructureStatus | null {
  if (!operation) return null;
  if (operation.action === "replace_file") return "updated";
  return phase === "applied" ? "created" : "new";
}

export function buildSetupStructure(
  plan: SetupPlan,
  phase: SetupStructurePhase,
): SetupStructureEntry[] {
  const operations = new Map(
    plan.operations.map((operation) => [operation.path, operation] as const),
  );

  const entries: SetupStructureEntry[] = plan.snapshot.observations
    .filter(
      (observation) =>
        observation.kind === expectedManagedKind(observation.path) ||
        operations.has(observation.path),
    )
    .map((observation) => ({
      path: observation.path,
      kind: expectedManagedKind(observation.path),
      status:
        operationStatus(operations.get(observation.path), phase) ??
        "already_there",
    }));

  if (plan.options.scaffoldDomain) {
    for (const observation of plan.domain) {
      if (
        observation.kind !== "directory" &&
        !operations.has(observation.path)
      ) {
        continue;
      }
      entries.push({
        path: observation.path,
        kind: "directory",
        status:
          operationStatus(operations.get(observation.path), phase) ??
          "already_there",
      });
    }
  }

  return entries;
}

interface TreeNode {
  name: string;
  kind: SetupStructureKind;
  status?: SetupStructureStatus;
  children: Map<string, TreeNode>;
}

function displayRank(name: string): number {
  if (name.startsWith("_")) return 0;
  if (name.startsWith(".")) return 1;
  return 2;
}

export function compareSetupTreeNames(
  a: Pick<TreeNode, "name" | "kind">,
  b: Pick<TreeNode, "name" | "kind">,
): number {
  if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;

  const rank = displayRank(a.name) - displayRank(b.name);
  if (rank !== 0) return rank;

  return a.name.localeCompare(b.name, "en", {
    numeric: true,
    sensitivity: "base",
  });
}

function tree(entries: readonly SetupStructureEntry[]): TreeNode {
  const root: TreeNode = {
    name: "",
    kind: "directory",
    children: new Map(),
  };

  for (const entry of entries) {
    const segments = entry.path.split("/").filter(Boolean);
    let current = root;

    for (const [index, segment] of segments.entries()) {
      const last = index === segments.length - 1;
      let child = current.children.get(segment);
      if (!child) {
        child = {
          name: segment,
          kind: last ? entry.kind : "directory",
          children: new Map(),
        };
        current.children.set(segment, child);
      }
      if (last) {
        child.kind = entry.kind;
        child.status = entry.status;
      }
      current = child;
    }
  }

  return root;
}

function statusLabel(status: SetupStructureStatus | undefined): string {
  switch (status) {
    case "new":
      return "new";
    case "created":
      return "created";
    case "updated":
      return "updated";
    case "already_there":
      return "already there";
    default:
      return "";
  }
}

export function renderSetupTree(
  workspace: string,
  entries: readonly SetupStructureEntry[],
): string {
  const root = tree(entries);
  const lines: Array<{ tree: string; status: string }> = [
    { tree: `${path.basename(workspace) || workspace}/`, status: "" },
  ];

  function walk(node: TreeNode, prefix: string): void {
    const children = [...node.children.values()].sort(compareSetupTreeNames);
    children.forEach((child, index) => {
      const last = index === children.length - 1;
      const connector = last ? "└── " : "├── ";
      const suffix = child.kind === "directory" ? "/" : "";
      lines.push({
        tree: `${prefix}${connector}${child.name}${suffix}`,
        status: statusLabel(child.status),
      });
      if (child.children.size > 0) {
        walk(child, `${prefix}${last ? "    " : "│   "}`);
      }
    });
  }

  walk(root, "");

  const width = Math.max(...lines.map((line) => line.tree.length)) + 4;
  return lines
    .map(({ tree: treeLine, status }) =>
      status ? `${treeLine.padEnd(width)}${status}` : treeLine,
    )
    .join("\n");
}
