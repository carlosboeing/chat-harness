import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist", "npm", "chat-harness.js");

export async function prepareNpmCli(): Promise<void> {
  const source = await readFile(output, "utf8");
  const shebang = "#!/usr/bin/env node\n";
  await writeFile(output, source.startsWith("#!") ? source : shebang + source, "utf8");
  await chmod(output, 0o755);
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) await prepareNpmCli();
