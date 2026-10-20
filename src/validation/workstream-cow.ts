import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import type { Finding } from "../cli/result.js";

// Core COW names, including the dated backup observed in hosted acceptance.
// Do not infer duplicate ownership from titles, or reject all hidden Markdown.
const COW_BACKUP = /^\..+-backup-\d{8}(?:-[A-Za-z0-9]+)*\.md$/;

export async function workstreamCowFindings(workspace: string): Promise<Finding[]> {
  const root = path.join(workspace, ".chat-harness", "workstreams");
  const findings: Finding[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && COW_BACKUP.test(entry.name)) {
        findings.push({
          code: "workstream.cow_cleanup_incomplete",
          severity: "error",
          message: "Residual copy-on-write Workstream backup: checkpoint is incomplete, even if the canonical file is completed. Cleanup outcome is unknown.",
          location: file,
          remediation: "Preserve all copies. Verify canonical content, ownership and references before requesting any required cleanup approval. Never delete the last known-good copy. Restore the backup if promotion failed; otherwise remove only the verified obsolete backup with authorization and verify its absence. Report exact paths/IDs and a recovery Next action until resolved.",
        });
      }
      // Never follow symlinks, including links to another Workspace.
    }
  }
  try {
    if (!(await lstat(path.dirname(root))).isDirectory() || !(await lstat(root)).isDirectory()) return [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    return [{ code: "workstream.cow_inspection_failed", severity: "error",
      message: "Unable to inspect Workstream copy-on-write cleanup state.", location: root }];
  }
  try {
    await walk(root);
  } catch {
    findings.push({ code: "workstream.cow_inspection_failed", severity: "error",
      message: "Unable to inspect Workstream copy-on-write cleanup state.", location: root });
  }
  return findings.sort((a, b) => (a.location ?? "").localeCompare(b.location ?? ""));
}
