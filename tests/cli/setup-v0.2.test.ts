import { afterEach, describe, expect, test } from "bun:test";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runCli, type CliRuntime } from "../../src/cli/main.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "chat-harness-cli-v02-"));
  roots.push(root);
  return root;
}

function capture(cwd: string): { runtime: Partial<CliRuntime>; stdout: () => string } {
  let stdout = "";
  return {
    runtime: {
      cwd,
      env: {},
      isTTY: false,
      nativeTerminal: false,
      stdout: (text) => { stdout += text; },
      stderr: () => {},
    },
    stdout: () => stdout,
  };
}

describe("setup v0.2 CLI", () => {
  test("--specialist seeds WORKSPACE and --scaffold-domain is explicit", async () => {
    const root = await workspace();
    const io = capture(root);
    expect(await runCli(["setup", root, "--specialist", "career", "--scaffold-domain", "--json"], io.runtime)).toBe(0);

    const envelope = JSON.parse(io.stdout());
    expect(envelope.result.specialist).toBe("career");
    expect(envelope.result.host_action).toContain("complete current AGENTS.md");
    expect(await readFile(path.join(root, ".chat-harness", "WORKSPACE.md"), "utf8")).toContain("evidence-grounded");
    expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toContain("chat-harness-managed: agents");
    expect((await lstat(path.join(root, "Profile"))).isDirectory()).toBe(true);\n    expect((await lstat(path.join(root, "Opportunities"))).isDirectory()).toBe(true);
  });

  test("omitted specialist is deterministically general in non-interactive mode", async () => {
    const root = await workspace();
    const io = capture(root);
    expect(await runCli(["setup", root, "--json"], io.runtime)).toBe(0);
    const envelope = JSON.parse(io.stdout());
    expect(envelope.result.specialist).toBe("general");
    expect(await readFile(path.join(root, ".chat-harness", "WORKSPACE.md"), "utf8")).toContain("General");
  });

  test("invalid specialist is a usage error", async () => {
    const root = await workspace();
    const io = capture(root);
    expect(await runCli(["setup", root, "--specialist", "unknown"], io.runtime)).toBe(2);
  });
});
