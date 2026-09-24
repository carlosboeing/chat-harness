import { describe, expect, test } from "bun:test";

import { renderHuman, renderJson } from "../../src/cli/render.js";
import { commandEnvelope } from "../../src/cli/result.js";

describe("CLI rendering", () => {
  test("JSON is decoration-free and stable", () => {
    const envelope = commandEnvelope({
      command: "validate",
      workspace: "/workspace",
      result: { state: "failed" },
      findings: [
        {
          code: "workspace.required_missing",
          severity: "error",
          message: "Missing path.",
          location: "AGENTS.md",
        },
      ],
    });

    const output = renderJson(envelope);
    expect(output).not.toContain("\u001b[");
    const parsed = JSON.parse(output);
    expect(parsed.version).toBe(1);
    expect(parsed.findings[0].code).toBe("workspace.required_missing");
  });

  test("plain setup output includes operation receipts", () => {
    const envelope = commandEnvelope({
      command: "setup",
      workspace: "/workspace",
      result: {
        state: "changes_applied",
        operations: [
          {
            action: "create_file",
            path: "AGENTS.md",
          },
        ],
      },
    });

    const output = renderHuman(envelope, { color: false });
    expect(output).toContain("operation: create_file AGENTS.md");
    expect(output).not.toContain("\u001b[");
  });
});
