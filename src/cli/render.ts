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

  if (envelope.findings.length > 0) {
    lines.push(...envelope.findings.map(renderFinding));
  }

  return `${lines.join("\n")}\n`;
}

export function renderJson(envelope: CommandEnvelope): string {
  return `${JSON.stringify(envelope, null, 2)}\n`;
}
