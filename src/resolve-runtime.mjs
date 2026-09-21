import fs from "node:fs/promises";

const raw = process.env.CAPABILITY_REQUEST ?? "";
let runtime = "node";

try {
  const request = JSON.parse(raw);
  const capability =
    typeof request?.capability === "string" ? request.capability : null;

  if (capability) {
    const registry = JSON.parse(
      await fs.readFile(new URL("../registry.json", import.meta.url), "utf8"),
    );
    const configured = registry?.capabilities?.[capability]?.runtime;

    if (configured === "browser") runtime = "browser";
  }
} catch {
  // Dispatcher owns request validation. Falling back to node avoids installing
  // a browser for malformed or unknown requests.
}

process.stdout.write("runtime=" + runtime + "\n");
