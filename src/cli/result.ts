export type FindingSeverity = "error" | "warning" | "info";

export interface Finding {
  code: string;
  severity: FindingSeverity;
  message: string;
  location?: string;
  remediation?: string;
}

export type CommandName = "setup" | "validate" | "doctor" | "update" | "uninstall";
export type WorkspaceCommandName = Extract<CommandName, "setup" | "validate" | "doctor">;

export interface CommandResultPayload {
  state: string;
  [key: string]: unknown;
}

export interface CommandEnvelope<
  TResult extends CommandResultPayload = CommandResultPayload,
> {
  version: 1;
  command: CommandName;
  workspace?: string;
  success: boolean;
  result: TResult;
  findings: Finding[];
}

export function hasErrorFinding(findings: readonly Finding[]): boolean {
  return findings.some((finding) => finding.severity === "error");
}

export function commandEnvelope<
  TResult extends CommandResultPayload = CommandResultPayload,
>(input: {
  command: CommandName;
  workspace?: string;
  result: TResult;
  findings?: Finding[];
  success?: boolean;
}): CommandEnvelope<TResult> {
  const findings = input.findings ?? [];
  return {
    version: 1,
    command: input.command,
    ...(input.workspace ? { workspace: input.workspace } : {}),
    success: input.success ?? !hasErrorFinding(findings),
    result: input.result,
    findings,
  };
}
