import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

import type { Finding } from "../cli/result.js";
import { loadSourcePolicy } from "../source-policy/load.js";
import { inspectWorkspace } from "../workspace/inspect.js";
import { validateLifecycleFile } from "./lifecycle.js";
import { validateWorkstreamFile } from "./workstream.js";

async function collectMarkdownFiles(
  root: string,
): Promise<{ files: string[]; findings: Finding[] }> {
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
          message: "Validation does not follow symlinks in Chat Harness control state.",
          location: absolute,
        });
      } else if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(absolute);
      }
    }
  }

  await walk(root);
  return { files: files.sort(), findings };
}

export async function validateWorkspace(
  workspace: string,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const inspection = await inspectWorkspace(workspace);
  const expected = new Map([
    ["AGENTS.md", "file"],
    [".chat-harness", "directory"],
    [".chat-harness/README.md", "file"],
    [".chat-harness/workstreams", "directory"],
  ]);

  for (const observation of inspection.observations) {
    const expectedKind = expected.get(observation.path);
    if (observation.kind === "missing") {
      findings.push({
        code: "workspace.required_missing",
        severity: "error",
        message: `Required Chat Harness path is missing; expected ${expectedKind}.`,
        location: observation.path,
        remediation: "Run chat-harness setup, then rerun validation.",
      });
    } else if (observation.kind !== expectedKind) {
      findings.push({
        code: "workspace.path_type_invalid",
        severity: "error",
        message: `Required Chat Harness path must be ${expectedKind}, found ${observation.kind}.`,
        location: observation.path,
      });
    }
  }

  const workstreamsRoot = path.join(workspace, ".chat-harness", "workstreams");
  try {
    if ((await lstat(workstreamsRoot)).isDirectory()) {
      const collected = await collectMarkdownFiles(workstreamsRoot);
      findings.push(...collected.findings);
      for (const file of collected.files) {
        findings.push(
          ...(await validateWorkstreamFile(file, { workstreamsRoot })),
        );
      }
    }
  } catch {
    // Required-path findings above own this failure.
  }

  const lifecycleRoot = path.join(workspace, ".chat-harness", "lifecycle");
  try {
    const info = await lstat(lifecycleRoot);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      findings.push({
        code: "workspace.path_type_invalid",
        severity: "error",
        message: "Optional lifecycle path must be a real directory when present.",
        location: lifecycleRoot,
      });
    } else {
      const collected = await collectMarkdownFiles(lifecycleRoot);
      findings.push(...collected.findings);
      for (const file of collected.files) {
        findings.push(...(await validateLifecycleFile(file, lifecycleRoot)));
      }
    }
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      )
    ) {
      throw error;
    }
  }

  const policy = await loadSourcePolicy(workspace);
  if (policy.state === "unavailable") {
    findings.push({
      code: policy.code,
      severity: "error",
      message: policy.reason,
      location: ".chat-harness/source-policy.yaml",
    });
  }

  return findings.sort((a, b) => {
    const location = (a.location ?? "").localeCompare(b.location ?? "");
    return location !== 0 ? location : a.code.localeCompare(b.code);
  });
}
