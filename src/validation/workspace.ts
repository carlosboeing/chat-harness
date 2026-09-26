import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import type { Finding } from "../cli/result.js";
import { loadSourcePolicy } from "../source-policy/load.js";
import { inspectWorkspace } from "../workspace/inspect.js";
import { expectedManagedKind } from "../workspace/paths.js";
import { AGENTS_TEMPLATE, isManagedAgentsSource } from "../setup/templates.js";
import { validateWorkstreamFile } from "./workstream.js";

async function collectMarkdownFiles(root: string): Promise<{ files: string[]; findings: Finding[] }> {
  const files: string[] = [];
  const findings: Finding[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a,b)=>a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) findings.push({ code:"workspace.path_type_invalid", severity:"error", message:"Validation does not follow symlinks in Chat Harness control state.", location:absolute });
      else if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(absolute);
    }
  }
  await walk(root);
  return { files: files.sort(), findings };
}

export async function validateWorkspace(workspace: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  const inspection = await inspectWorkspace(workspace);
  for (const observation of inspection.observations) {
    const expected = expectedManagedKind(observation.path);
    if (observation.kind === "missing") findings.push({ code:"workspace.required_missing", severity:"error", message:`Required Chat Harness path is missing; expected ${expected}.`, location:observation.path, remediation:"Run chat-harness setup, then rerun validation." });
    else if (observation.kind !== expected) findings.push({ code:"workspace.path_type_invalid", severity:"error", message:`Required Chat Harness path must be ${expected}, found ${observation.kind}.`, location:observation.path });
    else if (observation.path === "AGENTS.md") {
      const source = observation.content ?? "";
      if (!isManagedAgentsSource(source)) findings.push({ code:"workspace.agents_unmanaged", severity:"error", message:"AGENTS.md is not recognizably Chat Harness-managed.", location:observation.path, remediation:"Review the collision and explicitly adopt/replace AGENTS.md with chat-harness setup." });
      else if (source !== AGENTS_TEMPLATE) findings.push({ code:"workspace.agents_outdated", severity:"error", message:"AGENTS.md is Chat Harness-managed but does not match the current canonical version.", location:observation.path, remediation:"Run chat-harness setup to replace it wholesale." });
    }
  }

  const workstreamsRoot = path.join(workspace, ".chat-harness", "workstreams");
  try {
    if ((await lstat(workstreamsRoot)).isDirectory()) {
      const collected = await collectMarkdownFiles(workstreamsRoot);
      findings.push(...collected.findings);
      for (const file of collected.files) findings.push(...(await validateWorkstreamFile(file, { workstreamsRoot })));
    }
  } catch { /* required-path findings own this */ }

  const policyObservation = inspection.observations.find((item)=>item.path === ".chat-harness/source-policy.yaml");
  if (policyObservation?.kind === "file") {
    const policy = await loadSourcePolicy(workspace);
    if (policy.state === "unavailable") findings.push({ code:policy.code, severity:"error", message:policy.reason, location:".chat-harness/source-policy.yaml" });
  }

  return findings.sort((a,b)=> {
    const location=(a.location ?? "").localeCompare(b.location ?? "");
    return location !== 0 ? location : a.code.localeCompare(b.code);
  });
}
