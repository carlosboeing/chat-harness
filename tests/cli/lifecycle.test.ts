import { describe, expect, test } from "bun:test";
import path from "node:path";

import { runCli, type CliRuntime } from "../../src/cli/main.js";
import type { LifecycleDependencies } from "../../src/lifecycle/command.js";
import type { InstallationInfo } from "../../src/lifecycle/installation.js";

function lifecycle(
  removed: string[] = [],
  installation: InstallationInfo = {
    channel: "standalone",
    version: "0.3.0",
    executablePath: "/home/test/.local/bin/chat-harness",
    metadataPath: "/home/test/.local/bin/.chat-harness-install.json",
    provenance: "metadata",
  },
): LifecycleDependencies {
  return {
    platform: "linux",
    inspect: () => installation,
    activeExecutable: () => installation.executablePath,
    realpath: (target) => path.resolve(target),
    latestStandalone: async () => ({
      version: "0.3.0",
      tag: "v0.3.0",
      binary: { name: "chat-harness-linux-x64", url: "https://example/bin" },
      checksum: { name: "chat-harness-linux-x64.sha256", url: "https://example/sha" },
    }),
    download: async () => new Uint8Array(),
    replacePosix: () => { throw new Error("unexpected replacement"); },
    scheduleWindowsUpdate: () => { throw new Error("unexpected Windows update"); },
    scheduleWindowsRemove: () => { throw new Error("unexpected Windows remove"); },
    writeMetadata: () => "/home/test/.local/bin/.chat-harness-install.json",
    removeFile: (target) => { removed.push(target); },
    npm: () => ({ status: 0, stdout: "", stderr: "" }),
    packageVersion: () => null,
    pathExists: () => false,
  };
}

function capture(overrides: Partial<CliRuntime> = {}) {
  let stdout = "";
  let stderr = "";
  return {
    runtime: {
      cwd: "/workspace",
      env: {},
      isTTY: false,
      stdout: (value: string) => { stdout += value; },
      stderr: (value: string) => { stderr += value; },
      version: "0.3.0",
      ...overrides,
    } satisfies Partial<CliRuntime>,
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

describe("CLI lifecycle UX", () => {
  test("update --check emits lifecycle JSON without pretending to target a Workspace", async () => {
    const io = capture({ lifecycle: lifecycle() });
    const code = await runCli(["update", "--check", "--json"], io.runtime);

    expect(code).toBe(0);
    const output = JSON.parse(io.stdout());
    expect(output.command).toBe("update");
    expect(output.workspace).toBeUndefined();
    expect(output.result.state).toBe("current");
    expect(output.result.channel).toBe("standalone");
    expect(output.result.current).toBe("0.3.0");
    expect(output.result.latest).toBe("0.3.0");
  });

  test("uninstall requires explicit authorization outside an interactive terminal", async () => {
    const removed: string[] = [];
    const io = capture({ lifecycle: lifecycle(removed) });
    const code = await runCli(["uninstall", "--json"], io.runtime);

    expect(code).toBe(1);
    const output = JSON.parse(io.stdout());
    expect(output.result.state).toBe("confirmation_required");
    expect(output.findings[0].code).toBe("lifecycle.confirmation_required");
    expect(removed).toEqual([]);
  });

  test("uninstall --yes removes only the detected installation files", async () => {
    const removed: string[] = [];
    const io = capture({ lifecycle: lifecycle(removed) });
    const code = await runCli(["uninstall", "--yes", "--json"], io.runtime);

    expect(code).toBe(0);
    expect(JSON.parse(io.stdout()).result.state).toBe("uninstalled");
    expect(removed).toEqual([
      "/home/test/.local/bin/chat-harness",
      "/home/test/.local/bin/.chat-harness-install.json",
    ]);
  });

  test("lifecycle help keeps update and migration authority separate", async () => {
    const update = capture({ lifecycle: lifecycle() });
    expect(await runCli(["update", "--help"], update.runtime)).toBe(0);
    expect(update.stdout()).toContain("--check");
    expect(update.stdout()).toContain("never migrates or modifies");

    const uninstall = capture({ lifecycle: lifecycle() });
    expect(await runCli(["uninstall", "--help"], uninstall.runtime)).toBe(0);
    expect(uninstall.stdout()).toContain("--yes");
    expect(uninstall.stdout()).toContain("AGENTS.md");
    expect(uninstall.stdout()).toContain("never removed");
  });
});
