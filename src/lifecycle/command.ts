import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

import type { Finding } from "../cli/result.js";
import {
  currentInstallationProbe,
  detectInstallation,
  findExecutableOnPath,
  metadataPathForExecutable,
  writeInstallationMetadata,
  type InstallationChannel,
  type InstallationInfo,
} from "./installation.js";
import {
  compareStableVersions,
  downloadBytes,
  lookupLatestStandaloneRelease,
  replaceStandalonePosix,
  verifyBinaryVersion,
  verifyDownloadedAsset,
  type StandaloneRelease,
} from "./standalone.js";
import { scheduleWindowsLifecycleJob } from "./windows.js";

export interface LifecycleResult {
  result: {
    state: string;
    current: string;
    channel: InstallationChannel;
    path: string;
    latest?: string;
    deferred?: boolean;
    [key: string]: unknown;
  };
  findings?: Finding[];
}

export interface NpmRunResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface LifecycleDependencies {
  platform: NodeJS.Platform;
  inspect(version: string): InstallationInfo;
  activeExecutable(name: string): string | null;
  realpath(target: string): string | null;
  latestStandalone(currentVersion: string): Promise<StandaloneRelease>;
  download(url: string): Promise<Uint8Array>;
  replacePosix(target: string, bytes: Uint8Array, expectedVersion: string): void;
  scheduleWindowsUpdate(
    target: string,
    bytes: Uint8Array,
    expectedVersion: string,
    metadataPath: string,
  ): void;
  scheduleWindowsRemove(target: string, metadataPath?: string): void;
  writeMetadata(target: string, channel: "standalone" | "development"): string;
  removeFile(target: string): void;
  npm(args: readonly string[], inheritOutput: boolean): NpmRunResult;
  packageVersion(packageRoot: string): string | null;
  pathExists(target: string): boolean;
}

function safeRealpath(target: string): string | null {
  try { return realpathSync(target); } catch { return null; }
}

function runNpm(args: readonly string[], inheritOutput: boolean): NpmRunResult {
  const result = spawnSync("npm", [...args], {
    encoding: "utf8",
    stdio: inheritOutput ? "inherit" : ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  if (result.error) throw new Error("npm could not be started: " + result.error.message);
  return {
    status: result.status ?? 1,
    stdout: inheritOutput ? "" : (result.stdout ?? ""),
    stderr: inheritOutput ? "" : (result.stderr ?? ""),
  };
}

function packageVersion(packageRoot: string): string | null {
  try {
    const source = readFileSync(path.join(packageRoot, "package.json"), "utf8");
    return (JSON.parse(source) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
}

function stageWindowsUpdate(
  target: string,
  bytes: Uint8Array,
  expectedVersion: string,
  metadataPath: string,
): void {
  const staged = path.join(
    path.dirname(target),
    ".chat-harness-update." + process.pid + "." + Date.now() + ".exe",
  );
  try {
    writeFileSync(staged, bytes);
    verifyBinaryVersion(staged, expectedVersion);
    writeInstallationMetadata(target, "standalone");
    scheduleWindowsLifecycleJob({
      action: "replace",
      target,
      metadataPath,
      staged,
      expectedVersion,
      currentExecutable: target,
    });
  } catch (error) {
    rmSync(staged, { force: true });
    throw error;
  }
}

export const defaultLifecycleDependencies: LifecycleDependencies = {
  platform: process.platform,
  inspect: (version) => detectInstallation(currentInstallationProbe(version)),
  activeExecutable: (name) => findExecutableOnPath(name),
  realpath: safeRealpath,
  latestStandalone: (version) =>
    lookupLatestStandaloneRelease(process.platform, process.arch, version),
  download: downloadBytes,
  replacePosix: (target, bytes, expectedVersion) =>
    replaceStandalonePosix({ target, candidateBytes: bytes, expectedVersion }),
  scheduleWindowsUpdate: stageWindowsUpdate,
  scheduleWindowsRemove: (target, metadataPath) => {
    scheduleWindowsLifecycleJob({
      action: "remove",
      target,
      ...(metadataPath ? { metadataPath } : {}),
      currentExecutable: target,
    });
  },
  writeMetadata: writeInstallationMetadata,
  removeFile: (target) => rmSync(target, { force: true }),
  npm: runNpm,
  packageVersion,
  pathExists: existsSync,
};

function errorFinding(code: string, message: string, remediation?: string): Finding {
  return {
    code,
    severity: "error",
    message,
    ...(remediation ? { remediation } : {}),
  };
}

function pathMismatch(
  installation: InstallationInfo,
  dependencies: LifecycleDependencies,
): Finding | null {
  if (installation.channel !== "standalone" && installation.channel !== "development") {
    return null;
  }

  const active = dependencies.activeExecutable("chat-harness");
  if (!active) return null;

  const activePath = dependencies.realpath(active) ?? path.resolve(active);
  const runningPath =
    dependencies.realpath(installation.executablePath) ??
    path.resolve(installation.executablePath);
  if (activePath === runningPath) return null;

  return errorFinding(
    "lifecycle.path_mismatch",
    "The running executable is " + runningPath +
      ", but PATH resolves chat-harness to " + activePath +
      ". Refusing to mutate an ambiguous installation.",
    "Fix PATH precedence or invoke the intended installation after making it the active chat-harness command.",
  );
}

function npmLatest(dependencies: LifecycleDependencies): string {
  const result = dependencies.npm(
    ["view", "chat-harness@latest", "version", "--json"],
    false,
  );
  if (result.status !== 0) {
    throw new Error(
      "npm could not query chat-harness@latest." +
      (result.stderr.trim() ? " " + result.stderr.trim() : ""),
    );
  }

  try {
    const value = JSON.parse(result.stdout) as unknown;
    if (typeof value !== "string" || !/^\d+\.\d+\.\d+$/.test(value)) {
      throw new Error("invalid version response");
    }
    return value;
  } catch {
    throw new Error(
      "npm returned an invalid latest version: " +
      (result.stdout.trim() || "(empty output)"),
    );
  }
}

export function inspectCurrentInstallation(
  version: string,
  dependencies: LifecycleDependencies = defaultLifecycleDependencies,
): InstallationInfo {
  return dependencies.inspect(version);
}

export interface UpdateOptions {
  check: boolean;
  json: boolean;
}

export async function runUpdate(
  currentVersion: string,
  options: UpdateOptions,
  dependencies: LifecycleDependencies = defaultLifecycleDependencies,
): Promise<LifecycleResult> {
  const installation = dependencies.inspect(currentVersion);
  const base = {
    current: currentVersion,
    channel: installation.channel,
    path: installation.executablePath,
  } as const;

  if (installation.channel === "unknown") {
    return {
      result: { state: "unknown_installation", ...base },
      findings: [errorFinding(
        "lifecycle.unknown_installation",
        installation.detail ??
          "Chat Harness could not establish how this executable was installed.",
        "Reinstall with the standalone installer or npm, then retry. Unknown/custom installations are never modified automatically.",
      )],
    };
  }

  if (installation.channel === "development") {
    if (options.check) {
      return { result: { state: "development_install", ...base } };
    }
    return {
      result: { state: "development_install", ...base },
      findings: [errorFinding(
        "lifecycle.development_install",
        "This is a local development build. Chat Harness will not replace it with a published release.",
        "Update the source checkout and run bun run install:local again.",
      )],
    };
  }

  const mismatch = pathMismatch(installation, dependencies);
  if (mismatch) {
    return {
      result: { state: "path_mismatch", ...base },
      findings: [mismatch],
    };
  }

  try {
    if (installation.channel === "npm") {
      if (!installation.packageRoot) {
        throw new Error("Global npm package root is unavailable.");
      }

      const latest = npmLatest(dependencies);
      const comparison = compareStableVersions(currentVersion, latest);
      if (comparison >= 0) {
        return {
          result: {
            state: comparison === 0 ? "current" : "ahead_of_latest",
            ...base,
            latest,
          },
        };
      }
      if (options.check) {
        return { result: { state: "update_available", ...base, latest } };
      }

      const mutation = dependencies.npm(
        ["install", "-g", "chat-harness@latest"],
        !options.json,
      );
      if (mutation.status !== 0) {
        return {
          result: {
            state: "update_failed",
            ...base,
            latest,
            ...(options.json && mutation.stdout
              ? { npm_stdout: mutation.stdout }
              : {}),
            ...(options.json && mutation.stderr
              ? { npm_stderr: mutation.stderr }
              : {}),
          },
          findings: [errorFinding(
            "lifecycle.npm_update_failed",
            "npm install -g chat-harness@latest exited with status " +
              mutation.status + ".",
          )],
        };
      }

      const installedVersion = dependencies.packageVersion(
        installation.packageRoot,
      );
      if (installedVersion !== latest) {
        return {
          result: {
            state: "verification_failed",
            ...base,
            latest,
            installed_version: installedVersion,
          },
          findings: [errorFinding(
            "lifecycle.version_verification_failed",
            "npm completed, but the installed package reports " +
              (installedVersion ?? "no version") +
              "; expected " + latest + ".",
          )],
        };
      }

      return {
        result: {
          state: "updated",
          ...base,
          latest,
          previous: currentVersion,
        },
      };
    }

    const release = await dependencies.latestStandalone(currentVersion);
    const comparison = compareStableVersions(
      currentVersion,
      release.version,
    );
    if (comparison >= 0) {
      return {
        result: {
          state: comparison === 0 ? "current" : "ahead_of_latest",
          ...base,
          latest: release.version,
        },
      };
    }
    if (options.check) {
      return {
        result: {
          state: "update_available",
          ...base,
          latest: release.version,
        },
      };
    }

    const [binary, checksum] = await Promise.all([
      dependencies.download(release.binary.url),
      dependencies.download(release.checksum.url),
    ]);
    verifyDownloadedAsset(binary, checksum, release.binary.name);

    const metadataPath =
      installation.metadataPath ??
      metadataPathForExecutable(installation.executablePath);

    if (dependencies.platform === "win32") {
      dependencies.scheduleWindowsUpdate(
        installation.executablePath,
        binary,
        release.version,
        metadataPath,
      );
      return {
        result: {
          state: "update_scheduled",
          ...base,
          latest: release.version,
          previous: currentVersion,
          deferred: true,
        },
      };
    }

    dependencies.writeMetadata(
      installation.executablePath,
      "standalone",
    );
    dependencies.replacePosix(
      installation.executablePath,
      binary,
      release.version,
    );
    return {
      result: {
        state: "updated",
        ...base,
        latest: release.version,
        previous: currentVersion,
      },
    };
  } catch (error) {
    return {
      result: { state: "update_failed", ...base },
      findings: [errorFinding(
        "lifecycle.update_failed",
        error instanceof Error ? error.message : String(error),
      )],
    };
  }
}

export interface UninstallOptions {
  json: boolean;
}

export async function runUninstall(
  currentVersion: string,
  options: UninstallOptions,
  dependencies: LifecycleDependencies = defaultLifecycleDependencies,
): Promise<LifecycleResult> {
  const installation = dependencies.inspect(currentVersion);
  const base = {
    current: currentVersion,
    channel: installation.channel,
    path: installation.executablePath,
  } as const;

  if (installation.channel === "unknown") {
    return {
      result: { state: "unknown_installation", ...base },
      findings: [errorFinding(
        "lifecycle.unknown_installation",
        installation.detail ??
          "Chat Harness could not establish how this executable was installed.",
        "Remove this custom installation manually. Chat Harness will not guess which files it owns.",
      )],
    };
  }

  if (
    installation.channel === "development" &&
    installation.provenance === "runtime"
  ) {
    return {
      result: { state: "development_runtime", ...base },
      findings: [errorFinding(
        "lifecycle.development_runtime",
        "This command is running from a source or package-development checkout, not an installed Chat Harness executable.",
        "Remove development files through your normal source-control/package workflow. Chat Harness will not delete its own source files.",
      )],
    };
  }

  const mismatch = pathMismatch(installation, dependencies);
  if (mismatch) {
    return {
      result: { state: "path_mismatch", ...base },
      findings: [mismatch],
    };
  }

  try {
    if (installation.channel === "npm") {
      if (!installation.packageRoot) {
        throw new Error("Global npm package root is unavailable.");
      }

      const mutation = dependencies.npm(
        ["uninstall", "-g", "chat-harness"],
        !options.json,
      );
      if (mutation.status !== 0) {
        return {
          result: {
            state: "uninstall_failed",
            ...base,
            ...(options.json && mutation.stdout
              ? { npm_stdout: mutation.stdout }
              : {}),
            ...(options.json && mutation.stderr
              ? { npm_stderr: mutation.stderr }
              : {}),
          },
          findings: [errorFinding(
            "lifecycle.npm_uninstall_failed",
            "npm uninstall -g chat-harness exited with status " +
              mutation.status + ".",
          )],
        };
      }

      if (
        dependencies.pathExists(
          path.join(installation.packageRoot, "package.json"),
        )
      ) {
        return {
          result: { state: "verification_failed", ...base },
          findings: [errorFinding(
            "lifecycle.uninstall_verification_failed",
            "npm completed, but the global chat-harness package is still present.",
          )],
        };
      }
      return { result: { state: "uninstalled", ...base } };
    }

    const metadataPath =
      installation.metadataPath ??
      metadataPathForExecutable(installation.executablePath);

    if (dependencies.platform === "win32") {
      dependencies.scheduleWindowsRemove(
        installation.executablePath,
        metadataPath,
      );
      return {
        result: {
          state: "uninstall_scheduled",
          ...base,
          deferred: true,
        },
      };
    }

    dependencies.removeFile(installation.executablePath);
    dependencies.removeFile(metadataPath);
    return { result: { state: "uninstalled", ...base } };
  } catch (error) {
    return {
      result: { state: "uninstall_failed", ...base },
      findings: [errorFinding(
        "lifecycle.uninstall_failed",
        error instanceof Error ? error.message : String(error),
      )],
    };
  }
}
