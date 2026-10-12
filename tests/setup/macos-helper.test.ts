import { describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { macosHelperPath, verifiedMacosHelper, invokeMacosSafeMove, type MacosHelperRuntime } from "../../src/workspace/macos-helper.js";

const arch = process.arch;
const base: MacosHelperRuntime = {
  platform: "darwin", arch: arch === "x64" ? "x64" : "arm64",
  standalone: false, entryPath: "/tmp/chat-harness-package/dist/npm/chat-harness.js",
  executablePath: "/tmp/chat-harness-binary",
};
const root = path.resolve(import.meta.dir, "../..");
const npmEntry = path.join(root, "dist/npm/chat-harness.js");
const binary = path.join(root, "dist/bin", `chat-harness-darwin-${base.arch}`);

describe("macOS packaged native primitive", () => {
  test("locates npm and standalone helpers independently of cwd and PATH", () => {
    expect(macosHelperPath(base)).toBe(`/tmp/chat-harness-package/dist/npm/native/macos/darwin-${base.arch}/safe-move`);
    expect(macosHelperPath({ ...base, standalone: true })).toBe("/tmp/chat-harness-binary.macos-safe-move");
  });

  test("fails closed before filesystem activity on unsupported platforms", () => {
    for (const [platform, arch] of [["linux", "x64"], ["win32", "x64"], ["darwin", "ia32"]]) {
      expect(() => verifiedMacosHelper({ ...base, platform, arch })).toThrow(/unsupported/);
    }
  });

  test("rejects missing helper and missing checksum", () => {
    expect(() => verifiedMacosHelper(base)).toThrow(/missing packaged file/);
    const tmp = mkdtempSync(path.join(os.tmpdir(), "chat-harness-helper-"));
    try {
      const entryPath = path.join(tmp, "chat-harness.js");
      const p = macosHelperPath({ ...base, entryPath });
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, "not Mach-O");
      chmodSync(p, 0o755);
      expect(() => verifiedMacosHelper({ ...base, entryPath })).toThrow(/missing packaged file/);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });

  test("rejects symlink helpers, altered hashes and fake Mach-O", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "chat-harness-helper-"));
    try {
      const entryPath = path.join(tmp, "chat-harness.js");
      const p = macosHelperPath({ ...base, entryPath });
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(path.join(tmp, "other"), "fake");
      symlinkSync(path.join(tmp, "other"), p);
      expect(() => verifiedMacosHelper({ ...base, entryPath })).toThrow(/unsafe file type/);
      rmSync(p);
      writeFileSync(p, "not Mach-O");
      chmodSync(p, 0o755);
      writeFileSync(p + ".sha256", `bad  ${path.basename(p)}\n`);
      expect(() => verifiedMacosHelper({ ...base, entryPath })).toThrow(/checksum/);
      const fake = readFileSync(p);
      writeFileSync(p + ".sha256", `${createHash("sha256").update(fake).digest("hex")}  ${path.basename(p)}\n`);
      expect(() => verifiedMacosHelper({ ...base, entryPath })).toThrow(/Mach-O/);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });

  test.skipIf(process.platform !== "darwin" || process.env.CHAT_HARNESS_TEST_PACKAGING !== "1")(
    "runs npm and standalone precompiled helpers without compiler or network at invocation",
    () => {
      const scratch = mkdtempSync(path.join(os.tmpdir(), "chat-harness-native-bundle-"));
      try {
        const platforms: MacosHelperRuntime[] = [
          { ...base, entryPath: npmEntry },
          { ...base, standalone: true, executablePath: binary },
        ];
        const workspace = path.join(scratch, "workspace");
        mkdirSync(workspace);
        for (const [index, info] of platforms.entries()) {
          expect(existsSync(verifiedMacosHelper(info))).toBe(true);
          const source = `source-${index}.md`;
          const destination = `backup-${index}.md`;
          const body = Buffer.from(`safe content ${index}\n`);
          writeFileSync(path.join(workspace, source), body);
          const digest = createHash("sha256").update(body).digest("hex");
          invokeMacosSafeMove({ operation: "move", workspace, parent: ".", source, destination, digest }, info);
          expect(existsSync(path.join(workspace, source))).toBe(false);
          expect(readFileSync(path.join(workspace, destination))).toEqual(body);
          invokeMacosSafeMove({ operation: "restore", workspace, parent: ".", source: destination, destination: source, digest }, info);
          expect(readFileSync(path.join(workspace, source))).toEqual(body);
          writeFileSync(path.join(workspace, destination), "collision");
          expect(() => invokeMacosSafeMove({ operation: "move", workspace, parent: ".", source, destination, digest }, info)).toThrow(/failed/);
          expect(readFileSync(path.join(workspace, destination), "utf8")).toBe("collision");
        }
      } finally { rmSync(scratch, { recursive: true, force: true }); }
    },
  );
});
