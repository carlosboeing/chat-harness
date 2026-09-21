import fs from "node:fs/promises";

const raw = process.env.CAPABILITY_REQUEST ?? "";
let request;

try {
  request = JSON.parse(raw);
} catch {
  process.stdout.write("runtime=node\n");
  process.exit(0);
}

const registry = JSON.parse(
  await fs.readFile(new URL("../registry.json", import.meta.url), "utf8"),
);
const capability =
  typeof request?.capability === "string" ? request.capability : "";
const runtime = registry?.capabilities?.[capability]?.runtime ?? "node";

if (!["node", "browser"].includes(runtime)) {
  throw new Error("Unsupported capability runtime: " + runtime);
}

process.stdout.write("runtime=" + runtime + "\n");
