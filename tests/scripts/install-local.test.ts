import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  findExecutableOnPath,
  getBinDir,
  getTargetName,
  installBinary,
  resolveLocalVersion,
  verifyInstalledVersion,
} from "../../scripts/install-local.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "chat-harness-local-install-"));
  roots.push(root);
  return root;
}

describe("local development installer", () => {
  test("resolves supported local build targets", () => {
    expect(getTargetName("darwin", "arm64")).toBe("bun-darwin-arm64");
    expect(getTargetName("darwin", "x64")).toBe("bun-darwin-x64");
    expect(getTargetName("linux", "arm64")).toBe("bun-linux-arm64");
    expect(getTargetName("linux", "x64")).toBe("bun-linux-x64");
    expect(() => getTargetName("win32", "x64")).toThrow(/macOS and Linux/);
  });

  test("uses CHAT_HARNESS_BIN_DIR or ~/.local/bin", () => {
    expect(getBinDir({ CHAT_HARNESS_BIN_DIR: "/custom/bin" })).toBe("/custom/bin");
    expect(getBinDir({})).toBe(path.join(os.homedir(), ".local", "bin"));
  });

  test("derives a git-identifiable development version", () => {
    const root = tempRoot();
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "0.2.0" }));

    const cleanExec = (_cmd: string, args: readonly string[]) =>
      args.includes("rev-parse") ? "f6bff65\n" : "";
    expect(resolveLocalVersion(cleanExec as never, root)).toBe("0.2.0-f6bff65");

    const dirtyExec = (_cmd: string, args: readonly string[]) =>
      args.includes("rev-parse") ? "f6bff65\n" : " M src/cli/main.ts\n";
    expect(resolveLocalVersion(dirtyExec as never, root)).toBe("0.2.0-f6bff65-dirty");
  });

  test("atomically installs an executable binary", () => {
    const root = tempRoot();
    const source = path.join(root, "source");
    const binDir = path.join(root, "nested", "bin");
    writeFileSync(source, "#!/bin/sh\necho local\n");
    chmodSync(source, 0o755);

    const installed = installBinary(binDir, source);

    expect(installed).toBe(path.join(binDir, "chat-harness"));
    expect(existsSync(installed)).toBe(true);
    expect(readFileSync(installed, "utf8")).toContain("echo local");
  });

  test("finds the first executable on PATH", () => {
    const root = tempRoot();
    const first = path.join(root, "first");
    const second = path.join(root, "second");
    mkdirSync(first);
    mkdirSync(second);
    const executable = path.join(second, "chat-harness");
    writeFileSync(executable, "#!/bin/sh\n");
    chmodSync(executable, 0o755);

    expect(findExecutableOnPath("chat-harness", { PATH: [first, second].join(path.delimiter) })).toBe(executable);
  });

  test("verifies the installed version exactly", () => {
    const exec = () => "0.2.0-f6bff65\n";
    expect(() => verifyInstalledVersion("/tmp/chat-harness", "0.2.0-f6bff65", exec as never)).not.toThrow();
    expect(() => verifyInstalledVersion("/tmp/chat-harness", "0.2.0-other", exec as never)).toThrow(/expected 0.2.0-other/);
  });
});
