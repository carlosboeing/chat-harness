import { describe, expect, test } from "bun:test";
import path from "node:path";

import {
  detectInstallation,
  isDevelopmentVersion,
  metadataPathForExecutable,
  parseInstallationMetadata,
  type InstallationProbe,
} from "../../src/lifecycle/installation.js";

function probe(overrides: Partial<InstallationProbe> = {}): InstallationProbe {
  return {
    version: "0.3.0",
    platform: "darwin",
    homeDir: "/home/test",
    standalone: true,
    executablePath: "/custom/bin/chat-harness",
    npmGlobalRoot: null,
    readText: () => null,
    realpath: (target) => path.resolve(target),
    ...overrides,
  };
}

describe("installation provenance", () => {
  test("parses only narrow install metadata", () => {
    expect(parseInstallationMetadata('{"schema":1,"channel":"standalone"}')).toEqual({
      schema: 1,
      channel: "standalone",
    });
    expect(parseInstallationMetadata('\ufeff{"schema":1,"channel":"development"}')).toEqual({
      schema: 1,
      channel: "development",
    });
    expect(parseInstallationMetadata('{"schema":2,"channel":"standalone"}')).toBeNull();
    expect(parseInstallationMetadata('{"schema":1,"channel":"npm"}')).toBeNull();
  });

  test("recognizes injected local-development versions", () => {
    expect(isDevelopmentVersion("0.3.0-abcdef1")).toBe(true);
    expect(isDevelopmentVersion("0.3.0-abcdef1-dirty")).toBe(true);
    expect(isDevelopmentVersion("0.3.0")).toBe(false);
  });

  test("trusts install metadata only beside a standalone executable", () => {
    const executable = "/custom/bin/chat-harness";
    const metadata = metadataPathForExecutable(executable);
    const result = detectInstallation(probe({
      executablePath: executable,
      readText: (target) =>
        path.resolve(target) === path.resolve(metadata)
          ? '{"schema":1,"channel":"standalone"}'
          : null,
    }));

    expect(result.channel).toBe("standalone");
    expect(result.provenance).toBe("metadata");
    expect(result.executablePath).toBe(path.resolve(executable));
  });

  test("supports existing standalone installs only at the documented default path", () => {
    const result = detectInstallation(probe({
      executablePath: "/home/test/.local/bin/chat-harness",
    }));
    expect(result.channel).toBe("standalone");
    expect(result.provenance).toBe("legacy-default-path");
  });

  test("does not guess custom compiled installation ownership", () => {
    const result = detectInstallation(probe());
    expect(result.channel).toBe("unknown");
    expect(result.provenance).toBe("unknown");
  });

  test("development version wins over custom-path ambiguity", () => {
    const result = detectInstallation(probe({ version: "0.3.0-abcdef1-dirty" }));
    expect(result.channel).toBe("development");
    expect(result.provenance).toBe("development-version");
  });

  test("recognizes only a verified global npm package as npm-managed", () => {
    const packageRoot = "/prefix/lib/node_modules/chat-harness";
    const entry = packageRoot + "/dist/npm/chat-harness.js";
    const result = detectInstallation(probe({
      standalone: false,
      executablePath: entry,
      entryPath: entry,
      npmGlobalRoot: "/prefix/lib/node_modules",
      readText: (target) =>
        path.resolve(target) === path.resolve(packageRoot + "/package.json")
          ? '{"name":"chat-harness","version":"0.3.0"}'
          : null,
    }));

    expect(result.channel).toBe("npm");
    expect(result.provenance).toBe("npm-global");
    expect(result.packageRoot).toBe(path.resolve(packageRoot));
  });

  test("source or non-global package execution is development, not globally mutable", () => {
    const packageRoot = "/repo/chat-harness";
    const entry = packageRoot + "/src/cli/main.ts";
    const result = detectInstallation(probe({
      standalone: false,
      executablePath: entry,
      entryPath: entry,
      npmGlobalRoot: "/prefix/lib/node_modules",
      readText: (target) =>
        path.resolve(target) === path.resolve(packageRoot + "/package.json")
          ? '{"name":"chat-harness","version":"0.3.0"}'
          : null,
    }));

    expect(result.channel).toBe("development");
    expect(result.provenance).toBe("runtime");
  });

  test("refuses package provenance when npm global root cannot be established", () => {
    const packageRoot = "/prefix/lib/node_modules/chat-harness";
    const entry = packageRoot + "/dist/npm/chat-harness.js";
    const result = detectInstallation(probe({
      standalone: false,
      executablePath: entry,
      entryPath: entry,
      npmGlobalRoot: null,
      readText: (target) =>
        path.resolve(target) === path.resolve(packageRoot + "/package.json")
          ? '{"name":"chat-harness","version":"0.3.0"}'
          : null,
    }));

    expect(result.channel).toBe("unknown");
    expect(result.detail).toContain("global npm provenance");
  });
});
