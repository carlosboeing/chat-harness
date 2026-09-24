import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import type { ValidateFunction } from "ajv";

import requestSchema from "../../schemas/capability/request.schema.json" with { type: "json" };
import {
  githubPersistentTransportRejection,
  loadCapabilityRegistry,
  validateCapabilityInput,
  type CapabilityEntry,
} from "../../src/validation/capability-registry.js";
import { formatSchemaErrors } from "../../src/validation/schema.js";

const MAX_REQUEST_CHARS = 16_384;
const DEFAULT_TIMEOUT_SECONDS = 30;
const MAX_TIMEOUT_SECONDS = 240;
const DEFAULT_MAX_OUTPUT_CHARS = 30_000;
const HARD_MAX_OUTPUT_CHARS = 100_000;

type CapabilityEnvelope = {
  version: 1;
  request_id: string | null;
  capability: string;
  ok: boolean;
  state: string;
  result: unknown;
  error: { code: string; message: string } | null;
};

type CapabilityRequest = {
  version: 1;
  request_id?: string | null;
  capability: string;
  input: Record<string, unknown>;
};

type CapabilityHandler = {
  run(
    input: Record<string, unknown>,
    context: {
      capability: string;
      runtime: string;
      networkPolicy: CapabilityEntry["network_policy"];
      signal: AbortSignal;
    },
  ): Promise<Record<string, unknown>>;
};

class CapabilityTimeoutError extends Error {
  constructor(readonly timeoutSeconds: number) {
    super(`Capability exceeded its ${timeoutSeconds} second execution budget.`);
    this.name = "CapabilityTimeoutError";
  }
}

function envelope(input: {
  capability?: string;
  requestId?: string | null;
  ok: boolean;
  state: string;
  result?: unknown;
  error?: { code: string; message: string } | null;
}): CapabilityEnvelope {
  return {
    version: 1,
    request_id: input.requestId ?? null,
    capability: input.capability ?? "unknown",
    ok: input.ok,
    state: input.state,
    result: input.result ?? null,
    error: input.error ?? null,
  };
}

function boundedInteger(
  value: number,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

async function runWithBudget(
  handler: CapabilityHandler,
  input: Record<string, unknown>,
  context: Omit<Parameters<CapabilityHandler["run"]>[1], "signal">,
  timeoutSeconds: number,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new CapabilityTimeoutError(timeoutSeconds));
    }, timeoutSeconds * 1000);
  });

  try {
    return await Promise.race([
      handler.run(input, { ...context, signal: controller.signal }),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function rootFromModule(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

interface AjvLike {
  compile(schema: object): ValidateFunction;
}
type AjvConstructor = new (options?: Record<string, unknown>) => AjvLike;
const require = createRequire(import.meta.url);
const ajvModule = require("ajv/dist/2020") as { default?: AjvConstructor } & AjvConstructor;
const Ajv2020: AjvConstructor = ajvModule.default ?? ajvModule;
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateRequest = ajv.compile(requestSchema);

export async function dispatchRaw(
  raw: string,
  options: { root?: string } = {},
): Promise<CapabilityEnvelope> {
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
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

  const candidate =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const capability =
    typeof candidate.capability === "string" ? candidate.capability : "unknown";
  const requestId =
    typeof candidate.request_id === "string" ? candidate.request_id : null;

  const allowedKeys = new Set(["version", "request_id", "capability", "input"]);
  const unexpected = Object.keys(candidate).filter((key) => !allowedKeys.has(key));
  if (unexpected.length > 0) {
    return envelope({
      capability,
      requestId,
      ok: false,
      state: "INVALID_REQUEST",
      error: {
        code: "UNEXPECTED_REQUEST_FIELDS",
        message: `Unexpected request fields: ${unexpected.join(", ")}`,
      },
    });
  }

  if (!validateRequest(parsed)) {
    return envelope({
      capability,
      requestId,
      ok: false,
      state: "INVALID_REQUEST",
      error: {
        code: "INVALID_SHAPE",
        message:
          "Request must contain version=1, capability, and object input.",
      },
    });
  }

  const request = parsed as CapabilityRequest;
  const root = options.root ?? rootFromModule();
  const registry = await loadCapabilityRegistry(root);
  const entry = registry.capabilities[request.capability];

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

  const transportRejection = githubPersistentTransportRejection(entry);
  if (transportRejection) {
    return envelope({
      capability,
      requestId,
      ok: false,
      state: "SECURITY_POLICY_REJECTED",
      error: {
        code: "PERSISTENT_TRANSPORT_REJECTED",
        message: transportRejection,
      },
    });
  }

  const inputValidation = validateCapabilityInput(entry, request.input);
  if (!inputValidation.valid) {
    return envelope({
      capability,
      requestId,
      ok: false,
      state: "INVALID_REQUEST",
      error: {
        code: "INVALID_CAPABILITY_INPUT",
        message: `Capability input failed its registered schema: ${inputValidation.message}`,
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

  const handlerPath = path.resolve(root, entry.handler);
  if (!handlerPath.startsWith(root + path.sep)) {
    throw new Error("Registered capability handler escapes repository root.");
  }
  const handler = (await import(pathToFileURL(handlerPath).href)) as CapabilityHandler;
  if (typeof handler.run !== "function") {
    throw new Error("Registered capability handler does not export run(input).");
  }

  let result: Record<string, unknown>;
  try {
    result = await runWithBudget(
      handler,
      request.input,
      {
        capability,
        runtime: entry.runtime,
        networkPolicy: entry.network_policy,
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
    ok: result.ok === true,
    state: typeof result.state === "string" ? result.state : "UNKNOWN_STATE",
    result,
    error:
      result.error &&
      typeof result.error === "object" &&
      "code" in result.error &&
      "message" in result.error
        ? {
            code: String(result.error.code),
            message: String(result.error.message),
          }
        : null,
  });

  if (JSON.stringify(output).length > maxOutputChars) {
    output = envelope({
      capability,
      requestId,
      ok: false,
      state: "OUTPUT_TOO_LARGE",
      error: {
        code: "OUTPUT_TOO_LARGE",
        message: "Capability result exceeded the registered output-size budget.",
      },
    });
  }

  return output;
}

export async function main(): Promise<void> {
  try {
    const output = await dispatchRaw(process.env.CAPABILITY_REQUEST ?? "");
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
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  await main();
}
