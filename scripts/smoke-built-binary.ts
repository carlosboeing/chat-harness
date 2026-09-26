import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

function run(
  binary: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): string {
  const result = spawnSync(binary, [...args], { encoding: "utf8", env, cwd });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${binary} ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout ?? "";
}

async function main(): Promise<void> {
  const binaryArg = process.argv[2];
  if (!binaryArg) throw new Error("Usage: bun scripts/smoke-built-binary.ts <binary>");
  const binary = path.resolve(binaryArg);
  const workspace = await mkdtemp(path.join(os.tmpdir(), "chat-harness-native-"));
  try {
    const env = { ...process.env, PATH: "", CHAT_HARNESS_INSTALLATION_MODE: "standalone" };

    run(binary, ["--version"], workspace, env);

    const rootHelp = run(binary, ["--help"], workspace, env);
    for (const command of ["setup", "validate", "doctor", "update", "uninstall"]) {
      if (!rootHelp.includes(command)) {
        throw new Error(`standalone help is missing command: ${command}`);
      }
      run(binary, [command, "--help"], workspace, env);
    }

    const setupHelp = run(binary, ["setup", "--help"], workspace, env);
    if (!setupHelp.includes("--specialist <id>")) {
      throw new Error("standalone setup help is missing --specialist");
    }

    const setup = JSON.parse(
      run(binary, ["setup", "--specialist", "tech", "--json"], workspace, env),
    ) as { success?: boolean; result?: { specialist?: string } };
    if (setup.success !== true || setup.result?.specialist !== "tech") {
      throw new Error("standalone cwd setup with --specialist tech did not succeed");
    }

    const validate = JSON.parse(
      run(binary, ["validate", "--json"], workspace, env),
    ) as { success?: boolean };
    if (validate.success !== true) {
      throw new Error("standalone cwd validate did not succeed");
    }

    const doctor = JSON.parse(
      run(binary, ["doctor", "--json"], workspace, env),
    ) as { success?: boolean };
    if (doctor.success !== true) {
      throw new Error("standalone cwd doctor did not succeed");
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
  process.stdout.write("native standalone smoke passed with an empty PATH.\n");
}

const isEntrypoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) await main();
