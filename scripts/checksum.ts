import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: bun scripts/checksum.ts <file>");
  const digest = await sha256File(file);
  const checksumPath = `${file}.sha256`;
  await writeFile(checksumPath, `${digest}  ${path.basename(file)}\n`, "utf8");
  process.stdout.write(`${checksumPath}\n`);
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) await main();
