import { afterEach, describe, expect, test } from "bun:test";
import { constants } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  detectInstallationMode,
  hostedStateFindings,
  runtimeFindings,
  workspaceAccessFindings,
} from "../../src/doctor/checks.js";
import { runDoctor } from "../../src/doctor/command.js";
import { runSetup } from "../../src/setup/command.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "chat-harness-doctor-"));
  roots.push(root);
  return root;
}

async function snapshot(root: string): Promise<string[]> {
  const output: string[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute);
      output.push(`${entry.isDirectory() ? "d" : "f"}:${relative}`);
      if (entry.isDirectory()) await walk(absolute);
      if (entry.isFile()) {
        output.push(
          `c:${relative}:${await readFile(absolute, "utf8")}`,
        );
      }
    }
  }
  await walk(root);
  return output;
}

describe("doctor", () => {
  test("is read-only on a healthy minimal workspace", async () => {
    const root = await workspace();
    await runSetup(root, { dryRun: false });
    const before = await snapshot(root);

    const output = await runDoctor(root, {
      runtimeFacts: {
        execPath: "/usr/local/bin/chat-harness",
      },
    });

    expect(output.result.state).toBe("healthy");
    expect(await snapshot(root)).toEqual(before);
    expect(output.findings.some((finding) => finding.code === "doctor.host_state_unknown"))
      .toBe(true);
  });

  test("reports missing scaffolding as warnings without failure", async () => {
    const root = await workspace();
    const output = await runDoctor(root, {
      runtimeFacts: {
        execPath: "/usr/local/bin/chat-harness",
      },
    });

    expect(output.result.state).toBe("healthy");
    expect(output.findings.filter((finding) => finding.code === "doctor.scaffold_missing").length)
      .toBe(4);
  });

  test("detects standalone, npm, and development runtime modes", () => {
    expect(
      detectInstallationMode({
        execPath: "/usr/local/bin/chat-harness",
      }),
    ).toBe("standalone");
    expect(
      detectInstallationMode({
        execPath: "/usr/bin/node",
        nodeVersion: "20.19.0",
      }),
    ).toBe("npm");
    expect(
      detectInstallationMode({
        execPath: "/usr/local/bin/bun",
        bunVersion: "1.4.2",
      }),
    ).toBe("development");
  });

  test("runtime prerequisite branches are explicit", () => {
    expect(
      runtimeFindings("standalone", {
        execPath: "/usr/local/bin/chat-harness",
      })[0]?.code,
    ).toBe("doctor.runtime_embedded");
    expect(
      runtimeFindings("npm", {
        execPath: "/usr/bin/node",
        nodeVersion: "18.20.0",
      })[0]?.code,
    ).toBe("doctor.node_unsupported");
    expect(
      runtimeFindings("development", {
        execPath: "/usr/local/bin/bun",
        bunVersion: "1.3.9",
      })[0]?.code,
    ).toBe("doctor.bun_unsupported");
    expect(
      runtimeFindings("development", {
        execPath: "/usr/local/bin/bun",
        bunVersion: "1.4.2",
      }),
    ).toEqual([]);
  });

  test("readability and writability checks are testable without mutation", async () => {
    const root = await workspace();
    const accessCheck = async (_target: string, mode: number): Promise<void> => {
      if (mode === constants.R_OK || mode === constants.W_OK) {
        throw new Error("denied");
      }
    };

    const findings = await workspaceAccessFindings(root, accessCheck);
    expect(findings.map((finding) => finding.code)).toEqual([
      "doctor.workspace_unreadable",
      "doctor.workspace_unwritable",
    ]);
  });

  test("invalid registry is diagnosed but not rewritten", async () => {
    const root = await workspace();
    await runSetup(root, { dryRun: false });
    await writeFile(path.join(root, "registry.json"), "{");
    const before = await readFile(path.join(root, "registry.json"), "utf8");

    const output = await runDoctor(root, {
      runtimeFacts: {
        execPath: "/usr/local/bin/chat-harness",
      },
    });

    expect(output.result.state).toBe("issues_found");
    expect(output.findings.some((finding) => finding.code === "doctor.registry_invalid"))
      .toBe(true);
    expect(await readFile(path.join(root, "registry.json"), "utf8")).toBe(before);
  });

  test("hosted state is explicitly unknown rather than guessed", () => {
    expect(hostedStateFindings()).toEqual([
      expect.objectContaining({
        code: "doctor.host_state_unknown",
        severity: "info",
      }),
    ]);
  });

  test("Git is not required merely because .git exists", async () => {
    const root = await workspace();
    await mkdir(path.join(root, ".git"));
    const output = await runDoctor(root, {
      runtimeFacts: {
        execPath: "/usr/local/bin/chat-harness",
      },
    });
    expect(output.findings.some((finding) => finding.code === "doctor.git_unavailable"))
      .toBe(false);
  });
});
