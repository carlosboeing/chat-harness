import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
