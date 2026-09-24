import { validateWorkspace } from "./workspace.js";

export async function runValidate(workspace: string) {
  const findings = await validateWorkspace(workspace);
  return {
    result: {
      state: findings.some((finding) => finding.severity === "error")
        ? "failed"
        : "valid",
    },
    findings,
  };
}
