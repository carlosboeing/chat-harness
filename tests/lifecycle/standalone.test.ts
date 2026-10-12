import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  compareStableVersions,
  lookupLatestStandaloneRelease,
  parseChecksumSidecar,
  parseGithubRelease,
  replaceStandalonePosix,
  sha256,
  standaloneAssetName,
  verifyDownloadedAsset,
} from "../../src/lifecycle/standalone.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "chat-harness-lifecycle-"));
  roots.push(root);
  return root;
}

describe("standalone lifecycle", () => {
  test("maps only released platform and architecture targets", () => {
    expect(standaloneAssetName("darwin", "arm64")).toBe("chat-harness-darwin-arm64");
    expect(standaloneAssetName("linux", "x64")).toBe("chat-harness-linux-x64");
    expect(standaloneAssetName("win32", "x64")).toBe("chat-harness-windows-x64.exe");
    expect(() => standaloneAssetName("win32", "arm64")).toThrow(/Unsupported Windows architecture/);
    expect(() => standaloneAssetName("freebsd", "x64")).toThrow(/Unsupported OS/);
  });

  test("requires the binary and checksum assets from a stable GitHub release", () => {
    const release = parseGithubRelease({
      tag_name: "v0.3.1",
      draft: false,
      prerelease: false,
      assets: [
        { name: "chat-harness-linux-x64", browser_download_url: "https://example/bin" },
        { name: "chat-harness-linux-x64.sha256", browser_download_url: "https://example/sha" },
      ],
    }, "linux", "x64");
    expect(release.version).toBe("0.3.1");
    expect(release.binary.name).toBe("chat-harness-linux-x64");

    expect(() => parseGithubRelease({
      tag_name: "v0.3.1",
      assets: [{ name: "chat-harness-linux-x64", browser_download_url: "https://example/bin" }],
    }, "linux", "x64")).toThrow(/SHA-256 sidecar/);
  });

  test("macOS release requires both native helper assets and leaves Linux untouched", () => {
    const asset = "chat-harness-darwin-arm64";
    const common = [
      { name: asset, browser_download_url: "https://example/bin" },
      { name: asset + ".sha256", browser_download_url: "https://example/checksum" },
    ];
    expect(() => parseGithubRelease({ tag_name: "v0.3.8", assets: common }, "darwin", "arm64"))
      .toThrow(/missing the required macOS native helper/);
    const loaded = parseGithubRelease({ tag_name: "v0.3.8", assets: [
      ...common,
      { name: asset + ".macos-safe-move", browser_download_url: "https://example/helper" },
      { name: asset + ".macos-safe-move.sha256", browser_download_url: "https://example/helper-sha" },
    ] }, "darwin", "arm64");
    expect(loaded.nativeHelper?.binary.name).toBe(asset + ".macos-safe-move");
    expect(loaded.nativeHelper?.checksum.url).toBe("https://example/helper-sha");
  });

  test("installs helper beside binary, rejects incomplete old pair, and rolls back a failed update", () => {
    const root = tempRoot();
    const target = path.join(root, "chat-harness");
    const companion = target + ".macos-safe-move";
    const checksum = companion + ".sha256";
    writeFileSync(target, "old binary");
    const helper = new TextEncoder().encode("new helper");
    const verifyNativeHelper = (candidate: string) => {
      expect(readFileSync(candidate + ".macos-safe-move", "utf8")).toBe("new helper");
      expect(readFileSync(candidate + ".macos-safe-move.sha256", "utf8"))
        .toBe(sha256(helper) + "  " + path.basename(candidate + ".macos-safe-move") + "\n");
    };
    replaceStandalonePosix({
      target,
      candidateBytes: new TextEncoder().encode("new binary"),
      nativeHelperBytes: helper,
      expectedVersion: "0.3.8",
      verifyVersion: () => {},
      verifyNativeHelper,
      uniqueSuffix: "good",
    });
    expect(readFileSync(target, "utf8")).toBe("new binary");
    expect(readFileSync(companion, "utf8")).toBe("new helper");
    expect(readFileSync(checksum, "utf8")).toBe(sha256(helper) + "  chat-harness.macos-safe-move\n");

    writeFileSync(target, "old again");
    writeFileSync(companion, "old companion");
    writeFileSync(checksum, "old checksum");
    let verified = 0;
    expect(() => replaceStandalonePosix({
      target,
      candidateBytes: new TextEncoder().encode("candidate binary"),
      nativeHelperBytes: helper,
      expectedVersion: "0.3.8",
      verifyVersion: () => {
        verified += 1;
        if (verified === 2) throw new Error("post-install failure");
      },
      verifyNativeHelper,
      uniqueSuffix: "rollback-pair",
    })).toThrow(/post-install failure/);
    expect(readFileSync(target, "utf8")).toBe("old again");
    expect(readFileSync(companion, "utf8")).toBe("old companion");
    expect(readFileSync(checksum, "utf8")).toBe("old checksum");

    rmSync(checksum);
    expect(() => replaceStandalonePosix({
      target,
      candidateBytes: new TextEncoder().encode("new"),
      nativeHelperBytes: helper,
      expectedVersion: "0.3.8",
      verifyVersion: () => {},
      verifyNativeHelper,
      uniqueSuffix: "incomplete",
    })).toThrow(/incomplete/);
    expect(readFileSync(target, "utf8")).toBe("old again");
    expect(readFileSync(companion, "utf8")).toBe("old companion");
    expect(existsSync(checksum)).toBe(false);
  });

  test("surfaces network and HTTP failures from release lookup", async () => {
    await expect(
      lookupLatestStandaloneRelease("linux", "x64", "0.3.0", async () => {
        throw new Error("offline");
      }),
    ).rejects.toThrow(/offline/);

    await expect(
      lookupLatestStandaloneRelease("linux", "x64", "0.3.0", async () =>
        new Response("unavailable", { status: 503 })),
    ).rejects.toThrow(/HTTP 503/);
  });

  test("verifies checksum sidecars strictly", () => {
    const binary = new TextEncoder().encode("candidate");
    const digest = sha256(binary);
    const sidecar = new TextEncoder().encode(digest + "  chat-harness-linux-x64\n");
    expect(() => verifyDownloadedAsset(binary, sidecar, "chat-harness-linux-x64")).not.toThrow();

    const bad = new TextEncoder().encode("0".repeat(64) + "  chat-harness-linux-x64\n");
    expect(() => verifyDownloadedAsset(binary, bad, "chat-harness-linux-x64")).toThrow(/Checksum verification failed/);
    expect(() => parseChecksumSidecar(digest + "  another-file", "chat-harness-linux-x64")).toThrow(/expected/);
  });

  test("compares stable release versions without prerelease ambiguity", () => {
    expect(compareStableVersions("0.3.0", "0.3.1")).toBe(-1);
    expect(compareStableVersions("0.3.1", "0.3.1")).toBe(0);
    expect(compareStableVersions("1.0.0", "0.9.9")).toBe(1);
    expect(() => compareStableVersions("0.3.0-dev", "0.3.1")).toThrow(/stable/);
  });

  test("stages and replaces on the same filesystem after candidate verification", () => {
    const root = tempRoot();
    const target = path.join(root, "chat-harness");
    writeFileSync(target, "old");

    const verified: string[] = [];
    replaceStandalonePosix({
      target,
      candidateBytes: new TextEncoder().encode("new"),
      expectedVersion: "0.3.1",
      uniqueSuffix: "test",
      verifyVersion: (binary) => {
        verified.push(readFileSync(binary, "utf8"));
      },
    });

    expect(verified).toEqual(["new", "new"]);
    expect(readFileSync(target, "utf8")).toBe("new");
  });

  test("rolls back when post-replacement version verification fails", () => {
    const root = tempRoot();
    const target = path.join(root, "chat-harness");
    writeFileSync(target, "old");
    let calls = 0;

    expect(() => replaceStandalonePosix({
      target,
      candidateBytes: new TextEncoder().encode("new"),
      expectedVersion: "0.3.1",
      uniqueSuffix: "rollback",
      verifyVersion: () => {
        calls += 1;
        if (calls === 2) throw new Error("wrong version");
      },
    })).toThrow(/wrong version/);

    expect(readFileSync(target, "utf8")).toBe("old");
  });
});
