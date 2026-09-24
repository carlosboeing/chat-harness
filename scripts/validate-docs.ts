import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors: string[] = [];

async function markdownFiles(target: string): Promise<string[]> {
  if (target.endsWith(".md")) return [target];
  const files: string[] = [];
  async function walk(relative: string): Promise<void> {
    const entries = await readdir(path.join(root, relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(child);
    }
  }
  await walk(target);
  return files;
}

const files = ["README.md", ...(await markdownFiles("docs"))];
for (const file of files) {
  const source = await readFile(path.join(root, file), "utf8");
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const href = match[1]!;
    if (/^(https?:|mailto:|#)/.test(href)) continue;
    const clean = href.split("#")[0]!;
    if (!clean) continue;
    const target = path.resolve(path.dirname(path.join(root, file)), clean);
    if (!target.startsWith(root + path.sep) && target !== root) {
      errors.push(`${file}: link escapes repository: ${href}`);
      continue;
    }
    try { await access(target); }
    catch { errors.push(`${file}: missing local link target: ${href}`); }
  }
}

const readme = await readFile(path.join(root, "README.md"), "utf8");
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {name?: string; description?: string};
for (const required of ["# Chat Harness", "Harness engineering for AI assistants.", "not another agent runtime", "ChatGPT", ".chat-harness/"]) {
  if (!readme.toLowerCase().includes(required.toLowerCase())) errors.push(`README.md: missing positioning anchor: ${required}`);
}
if (pkg.name !== "chat-harness") errors.push("package.json: canonical package name drifted");
if (pkg.description !== "Harness engineering toolkit for long-running work with ChatGPT, Claude, and other AI assistants.") errors.push("package.json: public npm description drifted");

for (const currentDoc of ["README.md", "docs/architecture.md", "docs/concepts.md", "docs/security.md", "docs/compatibility.md", "docs/hosts/chatgpt.md"]) {
  const source = await readFile(path.join(root, currentDoc), "utf8");
  for (const stale of ["PROJECT_INSTRUCTIONS.md", ".workbench/"]) {
    if (source.includes(stale)) errors.push(`${currentDoc}: stale current architecture reference: ${stale}`);
  }
}

if (errors.length > 0) {
  for (const error of errors) process.stderr.write(`docs validation failed: ${error}\n`);
  process.exit(1);
}
process.stdout.write(`docs validation passed: ${files.length} Markdown files checked.\n`);
