import type { CommandEnvelope, Finding } from "./result.js";

const ANSI_BOLD = "\u001b[1m";
const ANSI_RESET = "\u001b[0m";

export interface HumanRenderOptions {
  color: boolean;
}

function renderFinding(finding: Finding): string {
  const where = finding.location ? ` [${finding.location}]` : "";
  const remediation = finding.remediation
    ? `\n  remediation: ${finding.remediation}`
    : "";
  return `${finding.severity}: ${finding.code}${where}: ${finding.message}${remediation}`;
}

export function renderHuman(
  envelope: CommandEnvelope,
  options: HumanRenderOptions,
): string {
  const heading = `Chat Harness ${envelope.command}`;
  const renderedHeading = options.color
    ? `${ANSI_BOLD}${heading}${ANSI_RESET}`
    : heading;
  const lines = [
    renderedHeading,
    `workspace: ${envelope.workspace}`,
    `state: ${envelope.result.state}`,
  ];

  const operations = envelope.result.operations;
  if (Array.isArray(operations)) {
    for (const operation of operations) {
      if (
        operation &&
        typeof operation === "object" &&
        "action" in operation &&
        "path" in operation
      ) {
        lines.push(
          `operation: ${String(operation.action)} ${String(operation.path)}`,
        );
      }
    }
  }

  if (envelope.findings.length > 0) {
    lines.push(...envelope.findings.map(renderFinding));
  }

  const hostAction = envelope.result.host_action;
  if (typeof hostAction === "string" && hostAction.length > 0) {
    lines.push("", "Next steps:", hostAction);
  }

  return `${lines.join("\n")}\n`;
}

export function renderJson(envelope: CommandEnvelope): string {
  return `${JSON.stringify(envelope, null, 2)}\n`;
}
