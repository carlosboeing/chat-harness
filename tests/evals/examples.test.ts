import { describe, expect, test } from "bun:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runValidate } from "../../src/validation/command.js";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testsDir, "../..");
const examples = [
  "travel-planning",
  "family-administration",
  "job-opportunity",
  "scientific-research",
];

describe("public examples", () => {
  for (const example of examples) {
    test(`${example} passes Chat Harness validation`, async () => {
      const result = await runValidate(path.join(root, "examples", example));
      const errors = result.findings.filter(
        (finding) => finding.severity === "error",
      );
      expect(errors).toEqual([]);
      expect(result.result.state).toBe("valid");
    });
  }
});
