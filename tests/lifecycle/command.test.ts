import { describe, expect, test } from "bun:test";
import path from "node:path";

import {
  runUninstall,
  runUpdate,
  type LifecycleDependencies,
  type NpmRunResult,
} from "../../src/lifecycle/command.js";
import type { InstallationInfo } from "../../src/lifecycle/installation.js";
import { sha256, type StandaloneRelease } from "../../src/lifecycle/standalone.js";

function installation(overrides: Partial<InstallationInfo> = {}): InstallationInfo {
  return {
    channel: "standalone",
    version: "0.3.0",
    executablePath: "/home/test/.local/bin/chat-harness",
    metadataPath: "/home/test/.local/bin/.chat-harness-install.json",
    provenance: "metadata",
    ...overrides,
  };
}

function release(binary = new TextEncoder().encode("candidate")): {
  release: StandaloneRelease;
  binary: Uint8Array;
  checksum: Uint8Array;
} {
  const name = "chat-harness-linux-x64";
  return {
    release: {
      version: "0.3.1",
      tag: "v0.3.1",
      binary: { name, url: "https://example/binary" },
      checksum: { name: name + ".sha256", url: "https://example/checksum" },
    },
    binary,
    checksum: new TextEncoder().encode(sha256(binary) + "  " + name + "\n"),
  };
}

function dependencies(
  install: InstallationInfo,
  overrides: Partial<LifecycleDependencies> = {},
): {
  deps: LifecycleDependencies;
  calls: {
    replaced: string[];
    metadata: string[];
    removed: string[];
    npm: readonly string[][];
    windowsUpdate: string[];
    windowsRemove: string[];
  };
} {
  const fixture = release();
  const calls = {
    replaced: [] as string[],
    metadata: [] as string[],
    removed: [] as string[],
    npm: [] as readonly string[][],
    windowsUpdate: [] as string[],
    windowsRemove: [] as string[],
  };

  const deps: LifecycleDependencies = {
    platform: "linux",
    inspect: () => install,
    activeExecutable: () => install.executablePath,
    realpath: (target) => path.resolve(target),
    latestStandalone: async () => fixture.release,
    download: async (url) =>
      url.endsWith("checksum") ? fixture.checksum : fixture.binary,
    replacePosix: (target) => { calls.replaced.push(target); },
    scheduleWindowsUpdate: (target) => { calls.windowsUpdate.push(target); },
    scheduleWindowsRemove: (target) => { calls.windowsRemove.push(target); },
    writeMetadata: (target) => {
      calls.metadata.push(target);
      return path.join(path.dirname(target), ".chat-harness-install.json");
    },
    removeFile: (target) => { calls.removed.push(target); },
    npm: (args): NpmRunResult => {
      calls.npm.push(args);
      return { status: 0, stdout: '"0.3.1"\n', stderr: "" };
    },
    packageVersion: () => "0.3.1",
    pathExists: () => false,
    ...overrides,
  };
  return { deps, calls };
}

describe("lifecycle commands", () => {
  test("update --check reports availability without mutation", async () => {
    const fixture = dependencies(installation());
    const result = await runUpdate("0.3.0", { check: true, json: true }, fixture.deps);

    expect(result.result.state).toBe("update_available");
    expect(result.result.latest).toBe("0.3.1");
    expect(fixture.calls.replaced).toEqual([]);
    expect(fixture.calls.metadata).toEqual([]);
  });

  test("standalone update verifies downloads before metadata or replacement", async () => {
    const fixture = dependencies(installation(), {
      download: async () => new TextEncoder().encode("not a valid sidecar"),
    });
    const result = await runUpdate("0.3.0", { check: false, json: true }, fixture.deps);

    expect(result.result.state).toBe("update_failed");
    expect(result.findings?.[0]?.message).toMatch(/checksum sidecar|Checksum/);
    expect(fixture.calls.replaced).toEqual([]);
    expect(fixture.calls.metadata).toEqual([]);
  });

  test("download failure leaves the installed standalone binary untouched", async () => {
    const fixture = dependencies(installation(), {
      download: async () => { throw new Error("connection reset"); },
    });
    const result = await runUpdate("0.3.0", { check: false, json: true }, fixture.deps);

    expect(result.result.state).toBe("update_failed");
    expect(result.findings?.[0]?.message).toContain("connection reset");
    expect(fixture.calls.metadata).toEqual([]);
    expect(fixture.calls.replaced).toEqual([]);
  });

  test("unwritable standalone replacement fails without a fallback mutation path", async () => {
    const fixture = dependencies(installation(), {
      replacePosix: () => { throw new Error("EACCES: install directory is not writable"); },
    });
    const result = await runUpdate("0.3.0", { check: false, json: true }, fixture.deps);

    expect(result.result.state).toBe("update_failed");
    expect(result.findings?.[0]?.message).toContain("EACCES");
    expect(fixture.calls.replaced).toEqual([]);
  });

  test("standalone update records provenance then replaces the exact running binary", async () => {
    const fixture = dependencies(installation());
    const result = await runUpdate("0.3.0", { check: false, json: true }, fixture.deps);

    expect(result.result.state).toBe("updated");
    expect(fixture.calls.metadata).toEqual(["/home/test/.local/bin/chat-harness"]);
    expect(fixture.calls.replaced).toEqual(["/home/test/.local/bin/chat-harness"]);
  });

  test("current standalone exits successfully without modification", async () => {
    const fixture = dependencies(installation(), {
      latestStandalone: async () => ({
        ...release().release,
        version: "0.3.0",
        tag: "v0.3.0",
      }),
    });
    const result = await runUpdate("0.3.0", { check: false, json: true }, fixture.deps);

    expect(result.result.state).toBe("current");
    expect(fixture.calls.replaced).toEqual([]);
  });

  test("unknown and development installs are never replaced", async () => {
    const unknown = dependencies(installation({
      channel: "unknown",
      provenance: "unknown",
      detail: "custom",
    }));
    const unknownResult = await runUpdate("0.3.0", { check: false, json: true }, unknown.deps);
    expect(unknownResult.result.state).toBe("unknown_installation");
    expect(unknown.calls.replaced).toEqual([]);

    const development = dependencies(installation({
      channel: "development",
      version: "0.3.0-abcdef1",
      provenance: "development-version",
    }));
    const developmentResult = await runUpdate("0.3.0-abcdef1", { check: false, json: true }, development.deps);
    expect(developmentResult.result.state).toBe("development_install");
    expect(development.calls.replaced).toEqual([]);
  });

  test("PATH ambiguity blocks standalone mutation", async () => {
    const fixture = dependencies(installation(), {
      activeExecutable: () => "/other/bin/chat-harness",
    });
    const result = await runUpdate("0.3.0", { check: false, json: true }, fixture.deps);

    expect(result.result.state).toBe("path_mismatch");
    expect(fixture.calls.replaced).toEqual([]);
  });

  test("update --check reports through PATH ambiguity without mutation", async () => {
    const fixture = dependencies(installation(), {
      activeExecutable: () => "/other/bin/chat-harness",
    });
    const result = await runUpdate("0.3.0", { check: true, json: true }, fixture.deps);

    expect(result.result.state).toBe("update_available");
    expect(result.findings?.[0]?.severity).toBe("warning");
    expect(result.findings?.[0]?.code).toBe("lifecycle.path_mismatch");
    expect(fixture.calls.metadata).toEqual([]);
    expect(fixture.calls.replaced).toEqual([]);
  });

  test("npm update delegates to the global npm owner and verifies the installed version", async () => {
    const npmInstall = installation({
      channel: "npm",
      executablePath: "/prefix/lib/node_modules/chat-harness/dist/npm/chat-harness.js",
      packageRoot: "/prefix/lib/node_modules/chat-harness",
      metadataPath: undefined,
      provenance: "npm-global",
    });
    const fixture = dependencies(npmInstall);
    const result = await runUpdate("0.3.0", { check: false, json: true }, fixture.deps);

    expect(result.result.state).toBe("updated");
    expect(fixture.calls.npm).toEqual([
      ["view", "chat-harness@latest", "version", "--json"],
      ["install", "-g", "chat-harness@latest"],
    ]);
  });

  test("npm-managed update fails safely when npm cannot be started", async () => {
    const npmInstall = installation({
      channel: "npm",
      packageRoot: "/prefix/lib/node_modules/chat-harness",
      provenance: "npm-global",
    });
    const fixture = dependencies(npmInstall, {
      npm: () => { throw new Error("npm could not be started: ENOENT"); },
    });
    const result = await runUpdate("0.3.0", { check: false, json: true }, fixture.deps);

    expect(result.result.state).toBe("update_failed");
    expect(result.findings?.[0]?.message).toContain("npm could not be started");
    expect(fixture.calls.replaced).toEqual([]);
  });

  test("npm failures remain explicit and do not fall back to standalone mutation", async () => {
    const npmInstall = installation({
      channel: "npm",
      packageRoot: "/prefix/lib/node_modules/chat-harness",
      provenance: "npm-global",
    });
    let call = 0;
    const fixture = dependencies(npmInstall, {
      npm: (args) => {
        call += 1;
        fixture.calls.npm.push(args);
        return call === 1
          ? { status: 0, stdout: '"0.3.1"\n', stderr: "" }
          : { status: 7, stdout: "", stderr: "permission denied" };
      },
    });
    const result = await runUpdate("0.3.0", { check: false, json: true }, fixture.deps);

    expect(result.result.state).toBe("update_failed");
    expect(result.findings?.[0]?.code).toBe("lifecycle.npm_update_failed");
    expect(fixture.calls.replaced).toEqual([]);
  });

  test("Windows update schedules post-exit replacement instead of replacing in-process", async () => {
    const fixture = dependencies(installation(), { platform: "win32" });
    const result = await runUpdate("0.3.0", { check: false, json: true }, fixture.deps);

    expect(result.result.state).toBe("update_scheduled");
    expect(result.result.deferred).toBe(true);
    expect(fixture.calls.windowsUpdate).toEqual(["/home/test/.local/bin/chat-harness"]);
    expect(fixture.calls.replaced).toEqual([]);
  });

  test("standalone uninstall removes only executable and install metadata", async () => {
    const fixture = dependencies(installation());
    const result = await runUninstall("0.3.0", { json: true }, fixture.deps);

    expect(result.result.state).toBe("uninstalled");
    expect(fixture.calls.removed).toEqual([
      "/home/test/.local/bin/chat-harness",
      "/home/test/.local/bin/.chat-harness-install.json",
    ]);
    expect(fixture.calls.removed.some((target) => target.includes("AGENTS.md"))).toBe(false);
    expect(fixture.calls.removed.some((target) => target.includes(".chat-harness/workbench"))).toBe(false);
  });

  test("source-runtime uninstall is refused so source files cannot self-delete", async () => {
    const fixture = dependencies(installation({
      channel: "development",
      executablePath: "/repo/src/cli/main.ts",
      metadataPath: undefined,
      provenance: "runtime",
    }));
    const result = await runUninstall("0.3.0", { json: true }, fixture.deps);

    expect(result.result.state).toBe("development_runtime");
    expect(fixture.calls.removed).toEqual([]);
  });

  test("npm uninstall delegates to npm and verifies package removal", async () => {
    const npmInstall = installation({
      channel: "npm",
      packageRoot: "/prefix/lib/node_modules/chat-harness",
      provenance: "npm-global",
    });
    const fixture = dependencies(npmInstall);
    const result = await runUninstall("0.3.0", { json: true }, fixture.deps);

    expect(result.result.state).toBe("uninstalled");
    expect(fixture.calls.npm).toEqual([["uninstall", "-g", "chat-harness"]]);
  });

  test("Windows uninstall schedules self-removal and performs no direct delete", async () => {
    const fixture = dependencies(installation(), { platform: "win32" });
    const result = await runUninstall("0.3.0", { json: true }, fixture.deps);

    expect(result.result.state).toBe("uninstall_scheduled");
    expect(fixture.calls.windowsRemove).toEqual(["/home/test/.local/bin/chat-harness"]);
    expect(fixture.calls.removed).toEqual([]);
  });
});
