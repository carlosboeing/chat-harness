import { describe, expect, test } from "bun:test";

import {
  WORKSPACE_MANAGED_MARKER,
  WORKSPACE_USER_MARKER,
  WorkspaceBoundaryError,
  adoptUnmarkedWorkspaceInstructions,
  composeWorkspaceManagedPrefix,
  createWorkspaceInstructions,
  parseWorkspaceBoundary,
  recomposeWorkspaceInstructions,
} from "../../src/setup/workspace-boundary.js";

const finance = { id: "finance", label: "Finance", guidance: "Verify costs and assumptions.\n" };
const shopping = { id: "shopping", label: "Shopping", guidance: "Compare total ownership cost.\n" };

describe("mixed-ownership WORKSPACE composition", () => {
  test("fresh default Workspace has exact ownership markers and user heading", () => {
    const rendered = createWorkspaceInstructions([]);
    expect(rendered.startsWith(WORKSPACE_MANAGED_MARKER + "\n# Workspace Instructions")).toBe(true);
    expect(rendered).toContain(WORKSPACE_USER_MARKER + "\n## Workspace customization\n");
    expect(parseWorkspaceBoundary(rendered).userSuffix).toBe("\n## Workspace customization\n");
  });

  test("Specialist composition is lexical and idempotent", () => {
    const ordered = createWorkspaceInstructions([finance, shopping]);
    expect(createWorkspaceInstructions([shopping, finance])).toBe(ordered);
    expect(ordered.indexOf("Specialist — Finance")).toBeLessThan(ordered.indexOf("Specialist — Shopping"));
    expect(recomposeWorkspaceInstructions(ordered, [shopping, finance])).toBe(ordered);
  });

  test("recomposition preserves every user suffix byte including CRLF", () => {
    const suffix = "\r\n# My existing heading\r\nNotes  \r\n\r\n";
    const current = composeWorkspaceManagedPrefix([shopping]) + WORKSPACE_USER_MARKER + suffix;
    const next = recomposeWorkspaceInstructions(current, [finance]);
    expect(parseWorkspaceBoundary(next).userSuffix).toBe(suffix);
    expect(next.endsWith(WORKSPACE_USER_MARKER + suffix)).toBe(true);
    expect(next).not.toContain("Specialist — Shopping");
  });

  test("explicit adoption preserves an unmarked file without injecting a user heading", () => {
    const original = "# Local user instructions\r\n\r\nKeep  spaces \r\n";
    const adopted = adoptUnmarkedWorkspaceInstructions(original, [finance]);
    expect(parseWorkspaceBoundary(adopted).userSuffix).toBe(original);
    expect(adopted.endsWith(WORKSPACE_USER_MARKER + original)).toBe(true);
    expect(adopted).not.toContain("## Workspace customization");
  });

  test.each([
    "# unmarked",
    WORKSPACE_MANAGED_MARKER + "\n# Workspace Instructions\n",
    WORKSPACE_MANAGED_MARKER + "\n" + WORKSPACE_USER_MARKER + WORKSPACE_USER_MARKER,
    WORKSPACE_MANAGED_MARKER + "\n" + WORKSPACE_MANAGED_MARKER + "\n" + WORKSPACE_USER_MARKER,
    "prefix\n" + WORKSPACE_MANAGED_MARKER + "\n" + WORKSPACE_USER_MARKER,
  ])("rejects missing/duplicated/misplaced markers", (source) => {
    expect(() => parseWorkspaceBoundary(source)).toThrow(WorkspaceBoundaryError);
  });

  test("adoption refuses partial marker collisions without guessing", () => {
    expect(() => adoptUnmarkedWorkspaceInstructions(WORKSPACE_USER_MARKER, [])).toThrow(WorkspaceBoundaryError);
  });

  test("unknown, duplicated and invalid Specialist sections fail closed", () => {
    expect(() => composeWorkspaceManagedPrefix([finance, finance])).toThrow(WorkspaceBoundaryError);
    expect(() => composeWorkspaceManagedPrefix([{ ...finance, id: "../wrong" }])).toThrow(WorkspaceBoundaryError);
    expect(() => composeWorkspaceManagedPrefix([{ ...finance, guidance: " " }])).toThrow(WorkspaceBoundaryError);
  });

  test("the pure composition functions do not require a filesystem or mutate their inputs", () => {
    const sections = Object.freeze([Object.freeze(finance), Object.freeze(shopping)]);
    const before = JSON.stringify(sections);
    expect(createWorkspaceInstructions(sections)).toContain(WORKSPACE_USER_MARKER);
    expect(JSON.stringify(sections)).toBe(before);
  });
});
