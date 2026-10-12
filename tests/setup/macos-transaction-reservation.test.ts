import { describe, expect, test } from "bun:test";
import { reserveMacosReconciliationLock, type MacosHelperRuntime } from "../../src/workspace/macos-helper.js";

const linux: MacosHelperRuntime = {
  platform: "linux",
  arch: "x64",
  standalone: false,
  entryPath: "/path/to/dist/npm/chat-harness.js",
  executablePath: "/path/to/chat-harness",
};

describe("macOS native transaction reservation interface", () => {
  test("rejects unsupported platforms before using filesystem mutation", () => {
    expect(() => reserveMacosReconciliationLock("/unavailable", linux))
      .toThrow("unsupported");
  });
});
