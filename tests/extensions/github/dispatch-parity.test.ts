import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { dispatchRaw } from "../../../extensions/github/dispatch.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function capability(
  handler: string,
  timeoutSeconds = 2,
  maxOutputChars = 30_000,
) {
  return {
    description: "Parity fixture capability",
    handler,
    runtime: "node",
    authority: "read-only",
    timeout_seconds: timeoutSeconds,
    max_output_chars: maxOutputChars,
    network_policy: {
      scheme: "https",
      hosts: ["example.com"],
      request_template: "https://example.com/fixture",
    },
    security: {
      data_class: "public",
      credentials: "none",
      persistent_transport_safe: true,
    },
    input: {
      type: "object",
      properties: {
        value: { type: "string" },
      },
      additionalProperties: false,
    },
    lifecycle: "durable",
    promotion: {
      basis: "recurring-workflow",
      evidence: ["Phase 0 dispatcher parity fixture"],
      reviewed_at: "2026-09-24",
    },
  };
}

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "chat-harness-parity-"));
  roots.push(root);
  const handlers = path.join(root, "capabilities", "fixture");
  await mkdir(handlers, { recursive: true });

  const definitions = [
    ["success", 'export async function run(input) { return { ok: true, state: "FIXTURE_OK", echo: input.value ?? null }; }'],
    ["timeout", "export async function run() { return await new Promise(() => {}); }"],
    ["oversized", 'export async function run() { return { ok: true, state: "FIXTURE_OK", payload: "x".repeat(2000) }; }'],
  ] as const;

  for (const [name, source] of definitions) {
    const directory = path.join(root, "capabilities", name);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "handler.ts"), source);
  }

  await writeFile(
    path.join(root, "registry.json"),
    JSON.stringify({
      version: 1,
      capabilities: {
        "fixture.success": capability("capabilities/success/handler.ts"),
        "fixture.timeout": capability("capabilities/timeout/handler.ts", 1),
        "fixture.oversized": capability(
          "capabilities/oversized/handler.ts",
          2,
          1000,
        ),
      },
    }),
  );

  return root;
}

describe("Phase 0 dispatcher parity under TypeScript", () => {
  test("invalid JSON envelope", async () => {
    expect(await dispatchRaw("{")).toEqual({
      version: 1,
      request_id: null,
      capability: "unknown",
      ok: false,
      state: "INVALID_REQUEST",
      result: null,
      error: {
        code: "INVALID_JSON",
        message: "Issue body must be raw JSON.",
      },
    });
  });

  test("invalid request-shape envelope", async () => {
    expect(
      await dispatchRaw(
        JSON.stringify({
          version: 1,
          capability: "fixture.success",
          input: [],
        }),
      ),
    ).toEqual({
      version: 1,
      request_id: null,
      capability: "fixture.success",
      ok: false,
      state: "INVALID_REQUEST",
      result: null,
      error: {
        code: "INVALID_SHAPE",
        message:
          "Request must contain version=1, capability, and object input.",
      },
    });
  });

  test("unknown-capability envelope", async () => {
    const root = await fixtureRoot();
    expect(
      await dispatchRaw(
        JSON.stringify({
          version: 1,
          request_id: "req-unknown",
          capability: "fixture.missing",
          input: {},
        }),
        { root },
      ),
    ).toEqual({
      version: 1,
      request_id: "req-unknown",
      capability: "fixture.missing",
      ok: false,
      state: "UNKNOWN_CAPABILITY",
      result: null,
      error: {
        code: "UNKNOWN_CAPABILITY",
        message: "Capability is not present in the vetted registry.",
      },
    });
  });

  test("unexpected top-level field envelope", async () => {
    expect(
      await dispatchRaw(
        JSON.stringify({
          version: 1,
          request_id: "req-extra",
          capability: "fixture.success",
          input: {},
          extra: true,
        }),
      ),
    ).toEqual({
      version: 1,
      request_id: "req-extra",
      capability: "fixture.success",
      ok: false,
      state: "INVALID_REQUEST",
      result: null,
      error: {
        code: "UNEXPECTED_REQUEST_FIELDS",
        message: "Unexpected request fields: extra",
      },
    });
  });

  test("timeout envelope", async () => {
    const root = await fixtureRoot();
    expect(
      await dispatchRaw(
        JSON.stringify({
          version: 1,
          request_id: "req-timeout",
          capability: "fixture.timeout",
          input: {},
        }),
        { root },
      ),
    ).toEqual({
      version: 1,
      request_id: "req-timeout",
      capability: "fixture.timeout",
      ok: false,
      state: "TIMEOUT",
      result: null,
      error: {
        code: "TIMEOUT",
        message: "Capability exceeded its 1 second execution budget.",
      },
    });
  });

  test("oversized-output envelope", async () => {
    const root = await fixtureRoot();
    expect(
      await dispatchRaw(
        JSON.stringify({
          version: 1,
          request_id: "req-large",
          capability: "fixture.oversized",
          input: {},
        }),
        { root },
      ),
    ).toEqual({
      version: 1,
      request_id: "req-large",
      capability: "fixture.oversized",
      ok: false,
      state: "OUTPUT_TOO_LARGE",
      result: null,
      error: {
        code: "OUTPUT_TOO_LARGE",
        message:
          "Capability result exceeded the registered output-size budget.",
      },
    });
  });

  test("successful capability envelope", async () => {
    const root = await fixtureRoot();
    expect(
      await dispatchRaw(
        JSON.stringify({
          version: 1,
          request_id: "req-success",
          capability: "fixture.success",
          input: { value: "alpha" },
        }),
        { root },
      ),
    ).toEqual({
      version: 1,
      request_id: "req-success",
      capability: "fixture.success",
      ok: true,
      state: "FIXTURE_OK",
      result: {
        ok: true,
        state: "FIXTURE_OK",
        echo: "alpha",
      },
      error: null,
    });
  });
});
