/** Pure Workspace instruction composition. No filesystem mutation or ownership adoption. */
export const WORKSPACE_MANAGED_MARKER = "<!-- chat-harness-managed: workspace -->";
export const WORKSPACE_USER_MARKER = "<!-- chat-harness-user: workspace -->";

export class WorkspaceBoundaryError extends Error {
  readonly code = "workspace.boundary_invalid";
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceBoundaryError";
  }
}

export interface WorkspaceSpecialistSection {
  id: string;
  label: string;
  guidance: string;
}

export interface ParsedWorkspaceBoundary {
  /** Includes the managed top marker but excludes the user boundary marker. */
  managedPrefix: string;
  /** Exact bytes after the user boundary marker. Must not be normalized. */
  userSuffix: string;
}

function invalid(message: string): never {
  throw new WorkspaceBoundaryError(message);
}

/** Exact sentinel validation. No automatic repair, guessing or partial recovery. */
export function parseWorkspaceBoundary(source: string): ParsedWorkspaceBoundary {
  if (!source.startsWith(WORKSPACE_MANAGED_MARKER + "\n") &&
      !source.startsWith(WORKSPACE_MANAGED_MARKER + "\r\n")) {
    invalid("WORKSPACE.md must begin with the exact managed marker.");
  }

  const userIndex = source.indexOf(WORKSPACE_USER_MARKER);
  if (
    source.indexOf(WORKSPACE_MANAGED_MARKER, WORKSPACE_MANAGED_MARKER.length) !== -1 ||
    userIndex < WORKSPACE_MANAGED_MARKER.length ||
    source.indexOf(WORKSPACE_USER_MARKER, userIndex + WORKSPACE_USER_MARKER.length) !== -1
  ) {
    invalid("Missing or duplicated Workspace ownership markers.");
  }

  return {
    managedPrefix: source.slice(0, userIndex),
    userSuffix: source.slice(userIndex + WORKSPACE_USER_MARKER.length),
  };
}

/** Deterministic Core + selected Specialist prefix, independent of selection order. */
export function composeWorkspaceManagedPrefix(
  sections: readonly WorkspaceSpecialistSection[],
): string {
  const seen = new Set<string>();
  const sorted = [...sections].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  let result = WORKSPACE_MANAGED_MARKER + "\n# Workspace Instructions\n\n";

  for (const section of sorted) {
    if (!/^[a-z][a-z0-9-]*$/.test(section.id) || seen.has(section.id)) {
      invalid("Invalid or duplicated Specialist ID: " + section.id);
    }
    if (!section.label.trim() || section.label.includes("\n") || !section.guidance.trim()) {
      invalid("Specialist label and guidance must be non-empty.");
    }
    seen.add(section.id);
    result += "## Specialist — " + section.label.trim() + "\n\n";
    result += section.guidance.replace(/\r\n/g, "\n").trimEnd() + "\n\n";
  }

  return result;
}

/** Fresh install: a visible customization heading follows the user marker. */
export function createWorkspaceInstructions(
  sections: readonly WorkspaceSpecialistSection[],
): string {
  return composeWorkspaceManagedPrefix(sections) +
    WORKSPACE_USER_MARKER + "\n## Workspace customization\n";
}

/**
 * Adoption is an EXPLICITLY AUTHORIZED caller action. All existing bytes
 * follow the user marker, even when those bytes include CRLF or a second H1.
 * No automatic semantic merging, whitespace repair, or injected user heading.
 */
export function adoptUnmarkedWorkspaceInstructions(
  previous: string,
  sections: readonly WorkspaceSpecialistSection[],
): string {
  if (previous.includes(WORKSPACE_MANAGED_MARKER) ||
      previous.includes(WORKSPACE_USER_MARKER)) {
    invalid("Unmarked Workspace adoption cannot guess from existing markers.");
  }
  return composeWorkspaceManagedPrefix(sections) + WORKSPACE_USER_MARKER + previous;
}

/** Recompose managed bytes; copy the entire original user-owned suffix unchanged. */
export function recomposeWorkspaceInstructions(
  previous: string,
  sections: readonly WorkspaceSpecialistSection[],
): string {
  const { userSuffix } = parseWorkspaceBoundary(previous);
  return composeWorkspaceManagedPrefix(sections) + WORKSPACE_USER_MARKER + userSuffix;
}
