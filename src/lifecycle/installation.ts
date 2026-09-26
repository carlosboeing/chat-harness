import { accessSync, constants, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

export const INSTALL_METADATA_BASENAME = ".chat-harness-install.json";

export type InstallationChannel = "standalone" | "npm" | "development" | "unknown";
export type InstallationProvenance =
  | "metadata"
  | "npm-global"
  | "development-version"
  | "legacy-default-path"
  | "runtime"
  | "unknown";

export interface InstallationInfo {
  channel: InstallationChannel;
  version: string;
  executablePath: string;
  metadataPath?: string;
  packageRoot?: string;
  provenance: InstallationProvenance;
  detail?: string;
}

export interface InstallationProbe {
  version: string;
  platform: NodeJS.Platform;
  homeDir: string;
  standalone: boolean;
  executablePath: string;
  entryPath?: string;
  npmGlobalRoot?: string | null;
  readText(target: string): string | null;
  realpath(target: string): string | null;
}

interface InstallationMetadata {
  schema: 1;
  channel: "standalone" | "development";
}

export function metadataPathForExecutable(executablePath: string): string {
  return path.join(path.dirname(executablePath), INSTALL_METADATA_BASENAME);
}

export function parseInstallationMetadata(source: string): InstallationMetadata | null {
  try {
    const normalized = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
    const value = JSON.parse(normalized) as Partial<InstallationMetadata>;
    if (value.schema !== 1) return null;
    if (value.channel !== "standalone" && value.channel !== "development") return null;
    return { schema: 1, channel: value.channel };
  } catch {
    return null;
  }
}

export function isDevelopmentVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+-[0-9a-f]{7,}(?:-dirty)?$/i.test(version);
}

function defaultStandalonePath(platform: NodeJS.Platform, homeDir: string): string {
  return path.join(homeDir, ".local", "bin", platform === "win32" ? "chat-harness.exe" : "chat-harness");
}

function normalize(probe: InstallationProbe, candidate: string): string {
  return probe.realpath(candidate) ?? path.resolve(candidate);
}

function findPackageRoot(probe: InstallationProbe): string | null {
  if (!probe.entryPath) return null;
  let current = path.dirname(normalize(probe, probe.entryPath));
  for (;;) {
    const source = probe.readText(path.join(current, "package.json"));
    if (source) {
      try {
        const pkg = JSON.parse(source) as { name?: string };
        if (pkg.name === "chat-harness") return current;
      } catch {
        return null;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function detectInstallation(probe: InstallationProbe): InstallationInfo {
  const executablePath = normalize(probe, probe.executablePath);
  const metadataPath = metadataPathForExecutable(executablePath);
  const source = probe.readText(metadataPath);
  const metadata = source ? parseInstallationMetadata(source) : null;

  if (probe.standalone) {
    if (metadata) {
      return {
        channel: metadata.channel,
        version: probe.version,
        executablePath,
        metadataPath,
        provenance: "metadata",
      };
    }

    if (isDevelopmentVersion(probe.version)) {
      return {
        channel: "development",
        version: probe.version,
        executablePath,
        metadataPath,
        provenance: "development-version",
        detail: "development build identified by its injected version",
      };
    }

    const legacyDefault = normalize(probe, defaultStandalonePath(probe.platform, probe.homeDir));
    if (executablePath === legacyDefault) {
      return {
        channel: "standalone",
        version: probe.version,
        executablePath,
        metadataPath,
        provenance: "legacy-default-path",
        detail: "legacy standalone install inferred from the documented default path",
      };
    }

    return {
      channel: "unknown",
      version: probe.version,
      executablePath,
      provenance: "unknown",
      detail: "compiled binary has no trusted install metadata and is outside the legacy default path",
    };
  }

  const packageRoot = findPackageRoot(probe);
  if (packageRoot && probe.npmGlobalRoot) {
    const globalPackageRoot = normalize(probe, path.join(probe.npmGlobalRoot, "chat-harness"));
    if (normalize(probe, packageRoot) === globalPackageRoot) {
      return {
        channel: "npm",
        version: probe.version,
        executablePath,
        packageRoot,
        provenance: "npm-global",
      };
    }
  }

  if (packageRoot && !probe.npmGlobalRoot) {
    return {
      channel: "unknown",
      version: probe.version,
      executablePath,
      packageRoot,
      provenance: "unknown",
      detail: "chat-harness package detected, but global npm provenance could not be verified",
    };
  }

  return {
    channel: "development",
    version: probe.version,
    executablePath,
    ...(packageRoot ? { packageRoot } : {}),
    provenance: "runtime",
    detail: "source/runtime execution rather than a managed standalone or global npm install",
  };
}

function isStandaloneExecutable(): boolean {
  const bun = (globalThis as typeof globalThis & { Bun?: { isStandaloneExecutable?: boolean } }).Bun;
  return bun?.isStandaloneExecutable === true;
}

function safeRead(target: string): string | null {
  try { return readFileSync(target, "utf8"); } catch { return null; }
}

function safeRealpath(target: string): string | null {
  try { return realpathSync(target); } catch { return null; }
}

function npmGlobalRoot(): string | null {
  try {
    return String(execFileSync("npm", ["root", "-g"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })).trim() || null;
  } catch {
    return null;
  }
}

export function currentInstallationProbe(version: string): InstallationProbe {
  const standalone = isStandaloneExecutable();
  return {
    version,
    platform: process.platform,
    homeDir: os.homedir(),
    standalone,
    executablePath: standalone ? process.execPath : (process.argv[1] ?? process.execPath),
    ...(process.argv[1] ? { entryPath: process.argv[1] } : {}),
    npmGlobalRoot: standalone ? null : npmGlobalRoot(),
    readText: safeRead,
    realpath: safeRealpath,
  };
}

export function findExecutableOnPath(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const entries = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const extensions = platform === "win32"
    ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];

  for (const directory of entries) {
    for (const extension of extensions) {
      const candidate = path.join(directory, platform === "win32" ? name + extension.toLowerCase() : name);
      try {
        accessSync(candidate, platform === "win32" ? constants.F_OK : constants.X_OK);
        return safeRealpath(candidate) ?? candidate;
      } catch {
        // Keep searching PATH.
      }
    }
  }
  return null;
}

export function writeInstallationMetadata(
  executablePath: string,
  channel: "standalone" | "development",
): string {
  const metadataPath = metadataPathForExecutable(executablePath);
  const temp = metadataPath + ".tmp." + process.pid + "." + Date.now();
  mkdirSync(path.dirname(metadataPath), { recursive: true });
  try {
    writeFileSync(temp, JSON.stringify({ schema: 1, channel }) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temp, metadataPath);
  } finally {
    rmSync(temp, { force: true });
  }
  return metadataPath;
}
