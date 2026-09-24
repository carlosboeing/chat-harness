import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

interface CommandResult {
  stdout: string;
  stderr: string;
}

function run(
  command: string,
  args: readonly string[],
  cwd: string,
): CommandResult {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_update_notifier: "false",
    },
    timeout: 60_000,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      [
        `command failed: ${command} ${args.join(" ")}`,
        `exit: ${result.status ?? "unknown"}`,
        result.stdout?.trim() ? `stdout:\n${result.stdout.trim()}` : "",
        result.stderr?.trim() ? `stderr:\n${result.stderr.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export async function smokeInstalledNpmPackage(
  tarballPath: string,
): Promise<void> {
  const tarball = path.resolve(tarballPath);
  const root = await mkdtemp(path.join(os.tmpdir(), "chat-harness-npm-smoke-"));

  try {
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ private: true }, null, 2) + "\n",
      "utf8",
    );

    run(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--no-package-lock",
        tarball,
      ],
      root,
    );

    const installedPackagePath = path.join(
      root,
      "node_modules",
      "chat-harness",
      "package.json",
    );
    const installed = JSON.parse(
      await readFile(installedPackagePath, "utf8"),
    ) as { version?: string };

    if (!installed.version) {
      throw new Error("installed package is missing its version");
    }

    const bin = path.join(
      root,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "chat-harness.cmd" : "chat-harness",
    );

    const version = run(bin, ["--version"], root).stdout.trim();
    if (version !== installed.version) {
      throw new Error(
        `installed CLI version mismatch: expected ${installed.version}, got ${version}`,
      );
    }

    const help = run(bin, ["--help"], root).stdout;
    for (const command of ["setup", "validate", "doctor"]) {
      if (!help.includes(command)) {
        throw new Error(`installed CLI help is missing command: ${command}`);
      }
    }

    const workspace = path.join(root, "workspace");
    await mkdir(workspace);
    const setup = JSON.parse(
      run(bin, ["setup", workspace, "--json"], root).stdout,
    ) as { success?: boolean };
    if (setup.success !== true) {
      throw new Error("installed CLI setup smoke did not succeed");
    }

    const validate = JSON.parse(
      run(bin, ["validate", workspace, "--json"], root).stdout,
    ) as { success?: boolean };
    if (validate.success !== true) {
      throw new Error("installed CLI validate smoke did not succeed");
    }

    process.stdout.write(
      `clean npm install smoke passed: chat-harness@${installed.version}\n`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const tarball = process.argv[2];
  if (!tarball) {
    throw new Error(
      "Usage: bun scripts/smoke-npm-package.ts <chat-harness.tgz>",
    );
  }
  await smokeInstalledNpmPackage(tarball);
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  await main();
}
