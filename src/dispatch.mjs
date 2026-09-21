import fs from "node:fs/promises";

const MAX_REQUEST_CHARS = 16_384;
const DEFAULT_TIMEOUT_SECONDS = 30;
const MAX_TIMEOUT_SECONDS = 240;
const DEFAULT_MAX_OUTPUT_CHARS = 30_000;
const HARD_MAX_OUTPUT_CHARS = 100_000;

class CapabilityTimeoutError extends Error {
  constructor(timeoutSeconds) {
    super("Capability exceeded its " + timeoutSeconds + " second execution budget.");
    this.name = "CapabilityTimeoutError";
    this.timeoutSeconds = timeoutSeconds;
  }
}

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

function boundedInteger(value, fallback, min, max) {
  if (!Number.isInteger(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

async function runWithBudget(handler, input, context, timeoutSeconds) {
  const controller = new AbortController();
  let timer;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new CapabilityTimeoutError(timeoutSeconds));
    }, timeoutSeconds * 1000);
  });

  try {
    return await Promise.race([
      handler.run(input, {
        ...context,
        signal: controller.signal,
      }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
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

  const timeoutSeconds = boundedInteger(
    entry.timeout_seconds,
    DEFAULT_TIMEOUT_SECONDS,
    1,
    MAX_TIMEOUT_SECONDS,
  );
  const maxOutputChars = boundedInteger(
    entry.max_output_chars,
    DEFAULT_MAX_OUTPUT_CHARS,
    1_000,
    HARD_MAX_OUTPUT_CHARS,
  );

  const handlerUrl = new URL("../" + entry.handler, import.meta.url);
  const handler = await import(handlerUrl.href);

  if (typeof handler.run !== "function") {
    throw new Error("Registered capability handler does not export run(input).");
  }

  let result;
  try {
    result = await runWithBudget(
      handler,
      request.input,
      {
        capability,
        runtime: entry.runtime ?? "node",
        networkPolicy: entry.network_policy ?? null,
      },
      timeoutSeconds,
    );
  } catch (error) {
    if (error instanceof CapabilityTimeoutError) {
      return envelope({
        capability,
        requestId,
        ok: false,
        state: "TIMEOUT",
        error: {
          code: "TIMEOUT",
          message: error.message,
        },
      });
    }
    throw error;
  }

  let output = envelope({
    capability,
    requestId,
    ok: result?.ok === true,
    state: typeof result?.state === "string" ? result.state : "UNKNOWN_STATE",
    result,
    error: result?.error ?? null,
  });

  if (JSON.stringify(output).length > maxOutputChars) {
    output = envelope({
      capability,
      requestId,
      ok: false,
      state: "OUTPUT_TOO_LARGE",
      error: {
        code: "OUTPUT_TOO_LARGE",
        message:
          "Capability result exceeded the registered output-size budget.",
      },
    });
  }

  return output;
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
