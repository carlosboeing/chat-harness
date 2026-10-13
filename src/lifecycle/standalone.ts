import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { verifiedMacosHelper } from "../workspace/macos-helper.js";

const REPOSITORY = "carlosboeing/chat-harness";

export interface ReleaseAsset {
  name: string;
  url: string;
}

export interface StandaloneRelease {
  version: string;
  tag: string;
  binary: ReleaseAsset;
  checksum: ReleaseAsset;
  nativeHelper?: { binary: ReleaseAsset; checksum: ReleaseAsset };
}

interface GithubReleaseAsset {
  name?: string;
  browser_download_url?: string;
}

interface GithubRelease {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: GithubReleaseAsset[];
}

export type FetchFn = typeof fetch;

export function standaloneAssetName(platform: NodeJS.Platform, arch: string): string {
  const osName =
    platform === "darwin" ? "darwin" :
    platform === "linux" ? "linux" :
    platform === "win32" ? "windows" :
    null;
  if (!osName) throw new Error("Unsupported OS: " + platform);

  const machine =
    ["arm64", "aarch64"].includes(arch) ? "arm64" :
    ["x64", "x86_64", "amd64"].includes(arch) ? "x64" :
    null;
  if (!machine) throw new Error("Unsupported architecture: " + arch);
  if (platform === "win32" && machine !== "x64") {
    throw new Error("Unsupported Windows architecture: " + arch);
  }

  return "chat-harness-" + osName + "-" + machine + (platform === "win32" ? ".exe" : "");
}

export function parseGithubRelease(
  payload: GithubRelease,
  platform: NodeJS.Platform,
  arch: string,
): StandaloneRelease {
  const tag = payload.tag_name;
  if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag) || payload.draft || payload.prerelease) {
    throw new Error("GitHub latest release is not a stable Chat Harness release.");
  }

  const binaryName = standaloneAssetName(platform, arch);
  const assets = payload.assets ?? [];
  const binary = assets.find((asset) => asset.name === binaryName);
  const checksum = assets.find((asset) => asset.name === binaryName + ".sha256");
  if (!binary?.browser_download_url || !checksum?.browser_download_url) {
    throw new Error("Release " + tag + " does not contain " + binaryName + " and its SHA-256 sidecar.");
  }

  let nativeHelper: StandaloneRelease["nativeHelper"];
  const helperSuffix=platform === "win32" ? ".windows-safe-move.exe" : platform === "linux" ? ".linux-safe-move" : ".macos-safe-move";
  if (platform === "darwin" || (["linux","win32"].includes(platform) && (assets.some(a=>a.name === binaryName+helperSuffix) || Number(tag.slice(1).split(".")[0])>=1))) {
    const helperName = binaryName + helperSuffix;
    const helperBinary = assets.find((asset) => asset.name === helperName);
    const helperChecksum = assets.find((asset) => asset.name === helperName + ".sha256");
    if (!helperBinary?.browser_download_url || !helperChecksum?.browser_download_url) {
      throw new Error("Release " + tag + " is missing the required "+(platform === "darwin" ? "macOS" : platform === "win32" ? "Windows" : "Linux")+" native helper and its SHA-256 checksum.");
    }
    nativeHelper = {
      binary: { name: helperName, url: helperBinary.browser_download_url },
      checksum: { name: helperName + ".sha256", url: helperChecksum.browser_download_url },
    };
  }

  return {
    version: tag.slice(1),
    tag,
    binary: { name: binaryName, url: binary.browser_download_url },
    checksum: { name: binaryName + ".sha256", url: checksum.browser_download_url },
    ...(nativeHelper ? { nativeHelper } : {}),
  };
}

export async function lookupLatestStandaloneRelease(
  platform: NodeJS.Platform,
  arch: string,
  currentVersion: string,
  fetchFn: FetchFn = fetch,
): Promise<StandaloneRelease> {
  let response: Response;
  try {
    response = await fetchFn("https://api.github.com/repos/" + REPOSITORY + "/releases/latest", {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "chat-harness/" + currentVersion,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch (error) {
    throw new Error("Could not query the latest GitHub release: " + (error instanceof Error ? error.message : String(error)));
  }
  if (!response.ok) {
    throw new Error("GitHub latest release request failed with HTTP " + response.status + ".");
  }
  return parseGithubRelease(await response.json() as GithubRelease, platform, arch);
}

export async function downloadBytes(url: string, fetchFn: FetchFn = fetch): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetchFn(url, { redirect: "follow" });
  } catch (error) {
    throw new Error("Download failed: " + (error instanceof Error ? error.message : String(error)));
  }
  if (!response.ok) throw new Error("Download failed with HTTP " + response.status + ": " + url);
  return new Uint8Array(await response.arrayBuffer());
}

export function parseChecksumSidecar(source: string, expectedAssetName?: string): string {
  const match = source.trim().match(/^([0-9a-fA-F]{64})(?:\s+[*]?(.+))?$/);
  if (!match) throw new Error("Release checksum sidecar is malformed.");
  const listedName = match[2]?.trim();
  if (expectedAssetName && listedName && path.basename(listedName) !== expectedAssetName) {
    throw new Error("Checksum sidecar names " + listedName + ", expected " + expectedAssetName + ".");
  }
  return match[1]!.toLowerCase();
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function verifyDownloadedAsset(
  binary: Uint8Array,
  sidecar: Uint8Array,
  assetName: string,
): void {
  const expected = parseChecksumSidecar(new TextDecoder().decode(sidecar), assetName);
  const actual = sha256(binary);
  if (actual !== expected) throw new Error("Checksum verification failed for " + assetName + ".");
}

export function compareStableVersions(left: string, right: string): number {
  const parse = (value: string): [number, number, number] => {
    const match = value.match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (!match) throw new Error("Expected a stable x.y.z version, got " + value + ".");
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index]! < b[index]!) return -1;
    if (a[index]! > b[index]!) return 1;
  }
  return 0;
}

export type VerifyVersionFn = (binary: string, expectedVersion: string) => void;

export function verifyBinaryVersion(binary: string, expectedVersion: string): void {
  const result = spawnSync(binary, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error("Candidate binary exited with status " + result.status + ".");
  }
  const actual = (result.stdout ?? "").trim();
  if (actual !== expectedVersion) {
    throw new Error("Candidate binary reported " + (actual || "(no version)") + ", expected " + expectedVersion + ".");
  }
}

export interface PosixReplacementInput {
  target: string;
  candidateBytes: Uint8Array;
  expectedVersion: string;
  nativeHelperBytes?: Uint8Array;
  nativeHelperPlatform?: "darwin" | "linux";
  verifyVersion?: VerifyVersionFn;
  /** Allows deterministic tests without executing an architecture-specific helper on Linux. */
  verifyNativeHelper?: (stagedExecutable: string) => void;
  uniqueSuffix?: string;
}

/**
 * Replaces only software-owned executable artifacts; never Workspace files.
 * Companion helper is staged and verified before any installed artifact changes.
 * If the process is interrupted between renames, the next invocation of the
 * native primitive fails closed on its checksum/protocol, never falls back.
 */
export function replaceStandalonePosix(input: PosixReplacementInput): void {
  const verifyVersion = input.verifyVersion ?? verifyBinaryVersion;
  const suffix = input.uniqueSuffix ?? process.pid + "." + Date.now();
  const directory = path.dirname(input.target);
  const candidate = path.join(directory, ".chat-harness-update." + suffix);
  const backup = path.join(directory, ".chat-harness-backup." + suffix);
  const helperPlatform=input.nativeHelperPlatform??"darwin";
  const helperSuffix=helperPlatform === "linux" ? ".linux-safe-move" : ".macos-safe-move";
  const helper = input.target + helperSuffix;
  const helperChecksum = helper + ".sha256";
  const backupHelper = backup + helperSuffix;
  const backupChecksum = backupHelper + ".sha256";
  const stagedDir = path.join(directory, ".chat-harness-helper-stage." + suffix);
  const stagedExecutable = path.join(stagedDir, path.basename(input.target));
  const stagedHelper = stagedExecutable + helperSuffix;
  const stagedChecksum = stagedHelper + ".sha256";
  let hadHelper = false;
  let movedHelper = false;
  let movedChecksum = false;
  let movedBinary = false;
  let safeToCleanup = false;

  mkdirSync(directory, { recursive: true });
  try {
    writeFileSync(candidate, input.candidateBytes);
    chmodSync(candidate, 0o755);
    verifyVersion(candidate, input.expectedVersion);

    if (input.nativeHelperBytes) {
      hadHelper = existsSync(helper);
      const hadChecksum = existsSync(helperChecksum);
      if (hadHelper !== hadChecksum) {
        throw new Error("Existing macOS native helper is incomplete; preserving installed software for manual repair.");
      }
      for (const target of [helper, helperChecksum]) {
        if (existsSync(target) && !lstatSync(target).isFile()) {
          throw new Error("Installed macOS native helper has unsafe file type: " + target);
        }
      }
      mkdirSync(stagedDir, { recursive: true });
      writeFileSync(stagedHelper, input.nativeHelperBytes);
      chmodSync(stagedHelper, 0o755);
      const digest = sha256(input.nativeHelperBytes);
      writeFileSync(stagedChecksum, digest + "  " + path.basename(stagedHelper) + "\n", "utf8");
      const verifyNativeHelper = input.verifyNativeHelper ?? ((staged: string) => {
        verifiedMacosHelper({
          platform: helperPlatform,
          arch: process.arch,
          standalone: true,
          executablePath: staged,
          entryPath: "",
        });
      });
      verifyNativeHelper(stagedExecutable);
    }

    // Back up all existing software files before the first rename.
    copyFileSync(input.target, backup);
    if (input.nativeHelperBytes && hadHelper) {
      copyFileSync(helper, backupHelper);
      copyFileSync(helperChecksum, backupChecksum);
    }

    if (input.nativeHelperBytes) {
      renameSync(stagedHelper, helper);
      movedHelper = true;
      renameSync(stagedChecksum, helperChecksum);
      movedChecksum = true;
    }
    renameSync(candidate, input.target);
    movedBinary = true;

    verifyVersion(input.target, input.expectedVersion);
    if (input.nativeHelperBytes) {
      const verifyNativeHelper = input.verifyNativeHelper ?? ((staged: string) => {
        verifiedMacosHelper({
          platform: helperPlatform,
          arch: process.arch,
          standalone: true,
          executablePath: staged,
          entryPath: "",
        });
      });
      verifyNativeHelper(input.target);
    }
    safeToCleanup = true;
  } catch (error) {
    try {
      // Reverse only renames completed by this invocation, preserving old bytes.
      if (movedBinary) renameSync(backup, input.target);
      if (movedChecksum) {
        if (hadHelper) renameSync(backupChecksum, helperChecksum);
        else rmSync(helperChecksum, { force: true });
      }
      if (movedHelper) {
        if (hadHelper) renameSync(backupHelper, helper);
        else rmSync(helper, { force: true });
      }
      safeToCleanup = true;
    } catch (recoveryError) {
      throw new Error("Standalone update failed and rollback could not be verified; backups retained near " +
        input.target + ". Cause: " + String(error) + "; rollback: " + String(recoveryError));
    }
    throw error;
  } finally {
    rmSync(candidate, { force: true });
    rmSync(stagedDir, { recursive: true, force: true });
    // Never discard last known-good copies after an unsuccessful rollback.
    if (safeToCleanup) {
      rmSync(backup, { force: true });
      rmSync(backupHelper, { force: true });
      rmSync(backupChecksum, { force: true });
    }
  }
}
