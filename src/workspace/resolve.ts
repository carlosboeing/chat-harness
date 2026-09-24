import { realpath, stat } from "node:fs/promises";
import path from "node:path";

export class WorkspaceResolutionError extends Error {
  readonly code: "workspace.not_found" | "workspace.not_directory";
  readonly location: string;

  constructor(
    code: "workspace.not_found" | "workspace.not_directory",
    location: string,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceResolutionError";
    this.code = code;
    this.location = location;
  }
}

export async function resolveWorkspaceRoot(
  inputPath: string | undefined,
  cwd: string,
): Promise<string> {
  const absolute = path.resolve(cwd, inputPath ?? ".");

  let info;
  try {
    info = await stat(absolute);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new WorkspaceResolutionError(
        "workspace.not_found",
        absolute,
        "Workspace root does not exist.",
      );
    }
    throw error;
  }

  if (!info.isDirectory()) {
    throw new WorkspaceResolutionError(
      "workspace.not_directory",
      absolute,
      "Workspace root must be a directory.",
    );
  }

  return await realpath(absolute);
}
