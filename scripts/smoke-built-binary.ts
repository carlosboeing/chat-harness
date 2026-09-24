import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

async function main(): Promise<void> {
  const binaryArg = process.argv[2];
  if (!binaryArg) throw new Error("Usage: bun scripts/smoke-built-binary.ts <binary>");
  const binary = path.resolve(binaryArg);
  const workspace = await mkdtemp(path.join(os.tmpdir(), "chat-harness-native-"));
  try {
    const env = { ...process.env, PATH: "", CHAT_HARNESS_INSTALLATION_MODE: "standalone" };
    for (const args of [["--version"], ["setup", workspace, "--json"], ["validate", workspace, "--json"]]) {
      const result = spawnSync(binary, args, { encoding: "utf8", env });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`${binary} ${args.join(" ")} failed: ${result.stderr}`);
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
  process.stdout.write("native standalone smoke passed with an empty PATH.\n");
}

const isEntrypoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) await main();
