import path from "node:path";

export class WorkspaceSafetyError extends Error {
  readonly code = "setup.path_escape";

  constructor(
    readonly workspace: string,
    readonly target: string,
  ) {
    super("Managed setup path must remain inside the Workspace root.");
    this.name = "WorkspaceSafetyError";
  }
}

export function assertContainedPath(
  workspace: string,
  target: string,
): void {
  const relative = path.relative(workspace, target);
  if (
    relative === "" ||
    relative === "." ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  ) {
    return;
  }

  throw new WorkspaceSafetyError(workspace, target);
}
