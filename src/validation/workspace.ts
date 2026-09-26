import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import type { Finding } from "../cli/result.js";
import { loadSourcePolicy } from "../source-policy/load.js";
import {
  AGENTS_TEMPLATE,
  isManagedAgentsSource,
} from "../setup/templates.js";
import { inspectWorkspace } from "../workspace/inspect.js";
import { expectedManagedKind } from "../workspace/paths.js";
import {
  validateWorkbenchFile,
  type WorkbenchArtifactType,
} from "./workbench.js";
import { validateWorkstreamFile } from "./workstream.js";

interface CollectedMarkdown {
  files: string[];
  findings: Finding[];
}

async function collectMarkdownFiles(
  root: string,
  findingPrefix: "workstream" | "workbench",
): Promise<CollectedMarkdown> {
  const files: string[] = [];
  const findings: Finding[] = [];

  async function walk(directory: string): Promise<void> {
    const entries = (await readdir(directory, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        findings.push({
          code: "workspace.path_type_invalid",
          severity: "error",
          message:
            "Validation does not follow symlinks in Chat Harness control state.",
          location: absolute,
        });
      } else if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        if (entry.name === ".gitkeep") continue;
        if (!entry.name.endsWith(".md")) {
          findings.push({
            code: `${findingPrefix}.file_extension_invalid`,
            severity: "error",
            message: `${
              findingPrefix === "workstream"
                ? "Workstreams"
                : "Workbench artifacts"
            } must be raw .md files.`,
            location: absolute,
          });
        } else {
          files.push(absolute);
        }
      }
    }
  }

  await walk(root);
  return { files: files.sort(), findings };
}

const WORKBENCH_FOLDERS: ReadonlyArray<{
  directory: string;
  type: WorkbenchArtifactType;
}> = [
  { directory: "0-ideas", type: "idea" },
  { directory: "1-research", type: "research" },
  { directory: "2-decisions", type: "decision" },
  { directory: "3-plans", type: "plan" },
  { directory: "4-reviews", type: "review" },
];

export async function validateWorkspace(workspace: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  const inspection = await inspectWorkspace(workspace);

  for (const observation of inspection.observations) {
    const expected = expectedManagedKind(observation.path);
    if (observation.kind === "missing") {
      findings.push({
        code: "workspace.required_missing",
        severity: "error",
        message: `Required Chat Harness path is missing; expected ${expected}.`,
        location: observation.path,
        remediation: "Run chat-harness setup, then rerun validation.",
      });
    } else if (observation.kind !== expected) {
      findings.push({
        code: "workspace.path_type_invalid",
        severity: "error",
        message: `Required Chat Harness path must be ${expected}, found ${observation.kind}.`,
        location: observation.path,
      });
    } else if (observation.path === "AGENTS.md") {
      const source = observation.content ?? "";
      if (!isManagedAgentsSource(source)) {
        findings.push({
          code: "workspace.agents_unmanaged",
          severity: "error",
          message: "AGENTS.md is not recognizably Chat Harness-managed.",
          location: observation.path,
          remediation:
            "Review the collision and explicitly adopt/replace AGENTS.md with chat-harness setup.",
        });
      } else if (source !== AGENTS_TEMPLATE) {
        findings.push({
          code: "workspace.agents_outdated",
          severity: "error",
          message:
            "AGENTS.md is Chat Harness-managed but does not match the current canonical version.",
          location: observation.path,
          remediation: "Run chat-harness setup to replace it wholesale.",
        });
      }
    }
  }

  const workstreamsRoot = path.join(
    workspace,
    ".chat-harness",
    "workstreams",
  );
  try {
    if ((await lstat(workstreamsRoot)).isDirectory()) {
      const collected = await collectMarkdownFiles(
        workstreamsRoot,
        "workstream",
      );
      findings.push(...collected.findings);
      for (const file of collected.files) {
        findings.push(
          ...(await validateWorkstreamFile(file, { workstreamsRoot })),
        );
      }
    }
  } catch {
    // Required-path findings own this.
  }

  const workbenchRoot = path.join(workspace, ".chat-harness", "workbench");
  try {
    if ((await lstat(workbenchRoot)).isDirectory()) {
      for (const folder of WORKBENCH_FOLDERS) {
        const categoryRoot = path.join(workbenchRoot, folder.directory);
        try {
          if (!(await lstat(categoryRoot)).isDirectory()) continue;
          const collected = await collectMarkdownFiles(
            categoryRoot,
            "workbench",
          );
          findings.push(...collected.findings);
          for (const file of collected.files) {
            findings.push(
              ...(await validateWorkbenchFile(file, {
                workbenchRoot,
                workstreamsRoot,
                expectedType: folder.type,
              })),
            );
          }
        } catch {
          // Required-path findings own this.
        }
      }
    }
  } catch {
    // Required-path findings own this.
  }

  const policyObservation = inspection.observations.find(
    (item) => item.path === ".chat-harness/source-policy.yaml",
  );
  if (policyObservation?.kind === "file") {
    const policy = await loadSourcePolicy(workspace);
    if (policy.state === "unavailable") {
      findings.push({
        code: policy.code,
        severity: "error",
        message: policy.reason,
        location: ".chat-harness/source-policy.yaml",
      });
    }
  }

  return findings.sort((a, b) => {
    const location = (a.location ?? "").localeCompare(b.location ?? "");
    return location !== 0 ? location : a.code.localeCompare(b.code);
  });
}
