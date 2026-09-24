import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

function run(command: string, args: string[], env?: NodeJS.ProcessEnv) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: env ?? process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}

async function main(): Promise<void> {
  const binary = process.argv[2];
  const npmCli = process.argv[3];
  if (!binary || !npmCli) {
    throw new Error(
      "Usage: bun scripts/smoke-distributions.ts <binary> <npm-cli>",
    );
  }

  const workspace = await mkdtemp(
    path.join(os.tmpdir(), "chat-harness-dist-"),
  );

  try {
    run(path.resolve(binary), ["setup", workspace, "--json"]);
    const standalone = JSON.parse(
      run(path.resolve(binary), ["validate", workspace, "--json"]),
    );
    const node = JSON.parse(
      run("node", [path.resolve(npmCli), "validate", workspace, "--json"]),
    );

    if (JSON.stringify(standalone) !== JSON.stringify(node)) {
      throw new Error(
        "Standalone and Node validate JSON envelopes differ.",
      );
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }

  process.stdout.write(
    "distribution smoke passed: standalone and Node validate JSON are identical.\n",
  );
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) await main();
