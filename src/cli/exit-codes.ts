import type { CommandEnvelope } from "./result.js";
import { hasErrorFinding } from "./result.js";

export const EXIT_SUCCESS = 0;
export const EXIT_FINDING_FAILURE = 1;
export const EXIT_USAGE = 2;
export const EXIT_INTERNAL = 3;

export type ExitCode =
  | typeof EXIT_SUCCESS
  | typeof EXIT_FINDING_FAILURE
  | typeof EXIT_USAGE
  | typeof EXIT_INTERNAL;

export function exitCodeForEnvelope(envelope: CommandEnvelope): ExitCode {
  if (envelope.result.state === "execution_failure") {
    return EXIT_INTERNAL;
  }

  if (!envelope.success || hasErrorFinding(envelope.findings)) {
    return EXIT_FINDING_FAILURE;
  }

  return EXIT_SUCCESS;
}
