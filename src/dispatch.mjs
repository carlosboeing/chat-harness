import fs from "node:fs/promises";

const MAX_REQUEST_CHARS = 16_384;

function envelope({
  capability = "unknown",
  requestId = null,
  ok,
  state,
  result = null,
  error = null,
}) {
  return {
    version: 1,
    request_id: requestId,
    capability,
    ok,
    state,
    result,
    error,
  };
}

async function main() {
  const raw = process.env.CAPABILITY_REQUEST ?? "";

  if (!raw || raw.length > MAX_REQUEST_CHARS) {
    return envelope({
      ok: false,
      state: "INVALID_REQUEST",
      error: {
        code: "REQUEST_SIZE",
        message: "Capability request is empty or too large.",
      },
    });
  }

  let request;
  try {
    request = JSON.parse(raw);
  } catch {
    return envelope({
      ok: false,
      state: "INVALID_REQUEST",
      error: {
        code: "INVALID_JSON",
        message: "Issue body must be raw JSON.",
      },
    });
  }

  const capability =
    typeof request?.capability === "string" ? request.capability : "unknown";
  const requestId =
    typeof request?.request_id === "string" ? request.request_id : null;

  if (
    request?.version !== 1 ||
    typeof request?.capability !== "string" ||
    !request?.input ||
    typeof request.input !== "object" ||
    Array.isArray(request.input)
  ) {
    return envelope({
      capability,
      requestId,
      ok: false,
      state: "INVALID_REQUEST",
      error: {
        code: "INVALID_SHAPE",
        message: "Request must contain version=1, capability, and object input.",
      },
    });
  }

  const allowedKeys = new Set(["version", "request_id", "capability", "input"]);
  const unexpected = Object.keys(request).filter((key) => !allowedKeys.has(key));
  if (unexpected.length > 0) {
    return envelope({
      capability,
      requestId,
      ok: false,
      state: "INVALID_REQUEST",
      error: {
        code: "UNEXPECTED_REQUEST_FIELDS",
        message: "Unexpected request fields: " + unexpected.join(", "),
      },
    });
  }

  const registry = JSON.parse(
    await fs.readFile(new URL("../registry.json", import.meta.url), "utf8"),
  );
  const entry = registry?.capabilities?.[capability];

  if (!entry) {
    return envelope({
      capability,
      requestId,
      ok: false,
      state: "UNKNOWN_CAPABILITY",
      error: {
        code: "UNKNOWN_CAPABILITY",
        message: "Capability is not present in the vetted registry.",
      },
    });
  }

  const handlerUrl = new URL("../" + entry.handler, import.meta.url);
  const handler = await import(handlerUrl.href);

  if (typeof handler.run !== "function") {
    throw new Error("Registered capability handler does not export run(input).");
  }

  const result = await handler.run(request.input);

  return envelope({
    capability,
    requestId,
    ok: result?.ok === true,
    state: typeof result?.state === "string" ? result.state : "UNKNOWN_STATE",
    result,
    error: result?.error ?? null,
  });
}

try {
  const output = await main();
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
} catch (error) {
  const output = envelope({
    ok: false,
    state: "BRIDGE_ERROR",
    error: {
      code: "BRIDGE_ERROR",
      message:
        error instanceof Error
          ? error.message.slice(0, 1000)
          : "Unhandled bridge error.",
    },
  });
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
}
