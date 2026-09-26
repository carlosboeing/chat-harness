import { intro, log, note, outro } from "@clack/prompts";

import type { CommandEnvelope } from "./result.js";
import {
  renderSetupTree,
  type SetupStructureEntry,
} from "../setup/presentation.js";

function setupStructure(envelope: CommandEnvelope): SetupStructureEntry[] {
  const value = envelope.result.structure;
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      !("path" in entry) ||
      !("kind" in entry) ||
      !("status" in entry)
    ) {
      return [];
    }

    const kind = String(entry.kind);
    const status = String(entry.status);
    if (
      (kind !== "directory" && kind !== "file") ||
      !["new", "created", "updated", "already_there"].includes(status)
    ) {
      return [];
    }

    return [
      {
        path: String(entry.path),
        kind: kind as SetupStructureEntry["kind"],
        status: status as SetupStructureEntry["status"],
      },
    ];
  });
}

function renderSetupInteractive(envelope: CommandEnvelope): void {
  if (!envelope.workspace) throw new Error("setup result is missing its Workspace path");
  const workspace = envelope.workspace;
  const structure = setupStructure(envelope);
  const state = envelope.result.state;

  if (state === "cancelled") {
    outro("Setup cancelled. No changes were applied.", { withGuide: false });
    return;
  }

  if (state === "changes_applied") {
    log.success("Your Chat Harness Workspace is ready.");
    log.info(`Workspace: ${envelope.workspace}`);

    if (structure.length > 0) {
      note(
        renderSetupTree(workspace, structure),
        "Workspace ready",
      );

      const created = structure.filter((entry) => entry.status === "created").length;
      const updated = structure.filter((entry) => entry.status === "updated").length;
      const summary = [
        created > 0 ? `${created} ${created === 1 ? "item" : "items"} created` : null,
        updated > 0 ? `${updated} ${updated === 1 ? "item" : "items"} updated` : null,
      ].filter(Boolean);

      if (summary.length > 0) log.info(summary.join(" · "));
    }

    log.info("Other existing files and folders were left unchanged.");
  } else if (state === "no_changes") {
    log.success("Everything is already up to date.");
    log.info(`Workspace: ${envelope.workspace}`);
    if (structure.length > 0) {
      note(
        renderSetupTree(workspace, structure),
        "Workspace structure",
      );
    }
    log.info("No files needed to be added or changed.");
  } else if (state === "changes_planned") {
    log.info("Dry run only — nothing was changed.");
    log.info(`Workspace: ${envelope.workspace}`);
    if (structure.length > 0) {
      note(
        renderSetupTree(workspace, structure),
        "Workspace preview",
      );
    }
  }

  for (const finding of envelope.findings) {
    const text = [
      finding.message,
      finding.location ? `Location: ${finding.location}` : null,
      finding.remediation ? `What to do: ${finding.remediation}` : null,
      `Technical detail: ${finding.code}`,
    ]
      .filter(Boolean)
      .join("\n");

    if (finding.severity === "error") log.error(text);
    else if (finding.severity === "warning") log.warn(text);
    else log.info(text);
  }

  const hostAction = envelope.result.host_action;
  if (typeof hostAction === "string" && hostAction.length > 0) {
    note(hostAction, "Next: connect this Workspace to ChatGPT");
  }

  outro(
    envelope.success
      ? state === "changes_planned"
        ? "Dry run complete"
        : "Setup complete"
      : "Setup needs your attention",
    { withGuide: false },
  );
}

export function renderInteractive(envelope: CommandEnvelope): void {
  if (envelope.command === "setup") {
    renderSetupInteractive(envelope);
    return;
  }

  intro(`Chat Harness ${envelope.command}`, { withGuide: false });
  if (envelope.workspace) log.info(`workspace: ${envelope.workspace}`);
  log.step(`state: ${envelope.result.state}`);

  for (const [label, key] of [
    ["Current", "current"],
    ["Latest", "latest"],
    ["Channel", "channel"],
    ["Path", "path"],
  ] as const) {
    const value = envelope.result[key];
    if (typeof value === "string" && value.length > 0) log.info(`${label}: ${value}`);
  }

  for (const finding of envelope.findings) {
    const text = [
      finding.code,
      finding.location ? `[${finding.location}]` : null,
      finding.message,
      finding.remediation ? `remediation: ${finding.remediation}` : null,
    ]
      .filter(Boolean)
      .join(" ");

    if (finding.severity === "error") log.error(text);
    else if (finding.severity === "warning") log.warn(text);
    else log.info(text);
  }

  outro(envelope.success ? "Done" : "Completed with findings", {
    withGuide: false,
  });
}
