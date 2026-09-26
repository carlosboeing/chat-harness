import { lstat } from "node:fs/promises";
import path from "node:path";
import type { Finding } from "../cli/result.js";
import { expectedManagedKind, type ManagedPath } from "../workspace/paths.js";
import type { ManagedPathObservation, PathKind, WorkspaceInspection } from "../workspace/inspect.js";
import { AGENTS_TEMPLATE, isManagedAgentsSource, SOURCE_POLICY_TEMPLATE, WORKSPACE_MAP_TEMPLATE, workspaceTemplate } from "./templates.js";
import { specialistDomainPaths, type SpecialistId } from "./specialists.js";

export type SetupOperationAction = "create_directory" | "create_file" | "replace_file";
export interface SetupOperation {
  action: SetupOperationAction;
  path: string;
  reason: string;
  content?: string;
  expectedContent?: string;
}
export interface SetupPlan {
  workspace: string;
  operations: ReadonlyArray<SetupOperation>;
  findings: ReadonlyArray<Finding>;
  snapshot: WorkspaceInspection;
  options: Readonly<SetupPlanOptions>;
  domain: ReadonlyArray<DomainPathObservation>;
}
export interface SetupPlanOptions {
  specialist: SpecialistId;
  scaffoldDomain: boolean;
  replaceAgents: boolean;
  replaceWorkspace: boolean;
}
export interface DomainPathObservation { path: string; kind: PathKind; }

const FILE_TEMPLATES: Partial<Record<ManagedPath, string>> = {
  "AGENTS.md": AGENTS_TEMPLATE,
  ".chat-harness/README.md": WORKSPACE_MAP_TEMPLATE,
  ".chat-harness/source-policy.yaml": SOURCE_POLICY_TEMPLATE,
};

function fileTemplate(pathValue: ManagedPath, specialist: SpecialistId): string | undefined {
  return pathValue === ".chat-harness/WORKSPACE.md" ? workspaceTemplate(specialist) : FILE_TEMPLATES[pathValue];
}

function collisionFinding(observation: ManagedPathObservation): Finding {
  const expected = expectedManagedKind(observation.path);
  const unsafe = observation.kind === "symlink";
  return {
    code: unsafe ? "setup.symlink_collision" : "setup.path_collision",
    severity: "error",
    message: unsafe ? "Managed path is a symlink; automatic setup will not follow it." : `Managed path must be a ${expected}, but found ${observation.kind}.`,
    location: observation.path,
    remediation: "Resolve the path manually, then rerun setup. Existing content will not be rewritten automatically.",
  };
}

export async function inspectDomainScaffold(workspace: string, specialist: SpecialistId): Promise<DomainPathObservation[]> {
  const observations: DomainPathObservation[] = [];
  for (const relative of specialistDomainPaths(specialist)) {
    const absolute = path.join(workspace, ...relative.split("/"));
    try {
      const info = await lstat(absolute);
      observations.push({ path: relative, kind: info.isSymbolicLink() ? "symlink" : info.isDirectory() ? "directory" : info.isFile() ? "file" : "other" });
    } catch (error) {
      if (error instanceof Error && "code" in error && ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) {
        observations.push({ path: relative, kind: "missing" });
      } else throw error;
    }
  }
  return observations;
}

export function buildSetupPlan(snapshot: WorkspaceInspection, options: SetupPlanOptions, domain: readonly DomainPathObservation[] = []): SetupPlan {
  const findings: Finding[] = [];
  const operations: SetupOperation[] = [];

  for (const observation of snapshot.observations) {
    const expected = expectedManagedKind(observation.path);
    if (observation.kind === "missing") {
      const content = fileTemplate(observation.path, options.specialist);
      operations.push({
        action: expected === "directory" ? "create_directory" : "create_file",
        path: observation.path,
        reason: observation.path === "AGENTS.md" ? "Create canonical generic Chat Harness Project Instructions."
          : observation.path === ".chat-harness/WORKSPACE.md" ? `Seed Workspace instructions from the ${options.specialist} specialist.`
          : observation.path === ".chat-harness/README.md" ? "Create the user-owned Workspace Map."
          : observation.path === ".chat-harness/source-policy.yaml" ? "Create the normal Source Policy scaffold."
          : "Create the v0.2 Chat Harness core scaffold.",
        ...(content !== undefined ? { content } : {}),
      });
      continue;
    }
    if (observation.kind !== expected) {
      findings.push(collisionFinding(observation));
      continue;
    }
    if (observation.path === "AGENTS.md") {
      const current = observation.content ?? "";
      if (isManagedAgentsSource(current)) {
        if (current !== AGENTS_TEMPLATE) operations.push({ action: "replace_file", path: observation.path, reason: "Replace recognized Chat Harness-managed AGENTS.md wholesale.", content: AGENTS_TEMPLATE, expectedContent: current });
      } else if (options.replaceAgents) {
        operations.push({ action: "replace_file", path: observation.path, reason: "Explicitly adopt and replace unmanaged AGENTS.md.", content: AGENTS_TEMPLATE, expectedContent: current });
      } else {
        findings.push({ code: "setup.unmanaged_agents_collision", severity: "error", message: "AGENTS.md exists but is not recognizably Chat Harness-managed; setup will not silently overwrite or adopt it.", location: observation.path, remediation: "Review it, then explicitly choose replacement if Chat Harness should own AGENTS.md." });
      }
      continue;
    }
    if (observation.path === ".chat-harness/WORKSPACE.md" && options.replaceWorkspace) {
      const current = observation.content ?? "";
      const replacement = workspaceTemplate(options.specialist);
      if (current !== replacement) operations.push({ action: "replace_file", path: observation.path, reason: `Explicitly replace WORKSPACE.md with the ${options.specialist} specialist seed.`, content: replacement, expectedContent: current });
    }
  }

  if (options.scaffoldDomain) {
    for (const observation of domain) {
      if (observation.kind === "missing") {
        operations.push({ action: "create_directory", path: observation.path, reason: `Create optional ${options.specialist} domain starter path.` });
      } else if (observation.kind !== "directory") {
        findings.push({ code: "setup.domain_path_collision", severity: "error", message: "Suggested domain path already exists but is not a real directory; setup will not touch it.", location: observation.path, remediation: "Resolve it manually or rerun without --scaffold-domain." });
      }
    }
  }

  return Object.freeze({
    workspace: snapshot.workspace,
    operations: Object.freeze(operations),
    findings: Object.freeze(findings),
    snapshot,
    options: Object.freeze({ ...options }),
    domain: Object.freeze([...domain]),
  });
}
