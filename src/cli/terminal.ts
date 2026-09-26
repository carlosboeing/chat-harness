import { intro, log, outro } from "@clack/prompts";

import type { CommandEnvelope } from "./result.js";

export function renderInteractive(envelope: CommandEnvelope): void {
  intro(`Chat Harness ${envelope.command}`, { withGuide: false });
  log.info(`workspace: ${envelope.workspace}`);
  log.step(`state: ${envelope.result.state}`);

  const operations = envelope.result.operations;
  if (Array.isArray(operations) && operations.length > 0) {
    for (const operation of operations) {
      if (
        operation &&
        typeof operation === "object" &&
        "action" in operation &&
        "path" in operation
      ) {
        log.step(
          `${String(operation.action)}: ${String(operation.path)}`,
        );
      }
    }
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

  const hostAction = envelope.result.host_action;
  if (typeof hostAction === "string" && hostAction.length > 0) {
    log.info(`Next steps:\n${hostAction}`);
  }

  outro(envelope.result.state === "cancelled"
    ? "Setup cancelled; no changes were applied"
    : envelope.success
      ? "Done"
      : "Completed with findings", {
    withGuide: false,
  });
}
