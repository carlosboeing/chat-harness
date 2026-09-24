import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { dispatchRaw } from "../../../extensions/github/dispatch.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(entry: Record<string, unknown>, handler: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "chat-harness-dispatch-"));
  roots.push(root);
  await mkdir(path.join(root, "capabilities", "fixture"), { recursive: true });
  await writeFile(path.join(root, "capabilities", "fixture", "handler.ts"), handler);
  await writeFile(
    path.join(root, "registry.json"),
    JSON.stringify({ version: 1, capabilities: { "fixture.test": entry } }),
  );
  return root;
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    description: "Fixture capability",
    handler: "capabilities/fixture/handler.ts",
    runtime: "node",
    authority: "read-only",
    timeout_seconds: 2,
    max_output_chars: 30000,
    network_policy: {
      scheme: "https",
      hosts: ["example.com"],
      request_template: "https://example.com/{value}",
    },
    security: {
      data_class: "public",
      credentials: "none",
      persistent_transport_safe: true,
    },
    input: {
      type: "object",
      required: ["value"],
      properties: { value: { type: "string" } },
      additionalProperties: false,
    },
    lifecycle: "durable",
    promotion: {
      basis: "recurring-workflow",
      evidence: ["fixture"],
      reviewed_at: "2026-09-24",
    },
    ...overrides,
  };
}

function request(input: Record<string, unknown> = { value: "alpha" }) {
  return JSON.stringify({
    version: 1,
    request_id: "req-1",
    capability: "fixture.test",
    input,
  });
}

describe("GitHub capability dispatcher", () => {
  test("preserves invalid JSON and unexpected-field envelope semantics", async () => {
    expect(await dispatchRaw("{")).toEqual({
      version: 1,
      request_id: null,
      capability: "unknown",
      ok: false,
      state: "INVALID_REQUEST",
      result: null,
      error: { code: "INVALID_JSON", message: "Issue body must be raw JSON." },
    });

    const output = await dispatchRaw(
      JSON.stringify({ version: 1, capability: "x", input: {}, extra: true }),
    );
    expect(output.error?.code).toBe("UNEXPECTED_REQUEST_FIELDS");
  });

  test("validates capability input before handler execution", async () => {
    let handlerRan = false;
    const root = await fixture(
      entry(),
      `export async function run() { globalThis.__fixtureRan = true; return { ok: true, state: "OK" }; }`,
    );
    const output = await dispatchRaw(request({ value: "ok", extra: true }), { root });
    handlerRan = Boolean((globalThis as Record<string, unknown>).__fixtureRan);
    expect(output.state).toBe("INVALID_REQUEST");
    expect(output.error?.code).toBe("INVALID_CAPABILITY_INPUT");
    expect(handlerRan).toBe(false);
  });

  test.each([
    ["write", { authority: "write" }],
    ["consequential", { authority: "consequential" }],
    ["personal", { security: { data_class: "personal", credentials: "none", persistent_transport_safe: true } }],
    ["credentials", { security: { data_class: "public", credentials: "required", persistent_transport_safe: true } }],
    ["transport flag", { security: { data_class: "public", credentials: "none", persistent_transport_safe: false } }],
  ])("rejects unsafe persistent transport profile: %s", async (_name, overrides) => {
    const root = await fixture(
      entry(overrides as Record<string, unknown>),
      `export async function run() { return { ok: true, state: "OK" }; }`,
    );
    const output = await dispatchRaw(request(), { root });
    expect(output.state).toBe("SECURITY_POLICY_REJECTED");
    expect(output.error?.code).toBe("PERSISTENT_TRANSPORT_REJECTED");
  });

  test("request input cannot widen registry-owned authority or network policy", async () => {
    const root = await fixture(
      entry(),
      `export async function run(input, context) {
        return {
          ok: true,
          state: "OK",
          observed: {
            input,
            authorityFromInput: input.authority ?? null,
            hosts: context.networkPolicy.hosts
          }
        };
      }`,
    );
    const output = await dispatchRaw(
      request({ value: "alpha", authority: "consequential", url: "https://evil.example" }),
      { root },
    );
    expect(output.state).toBe("INVALID_REQUEST");
    expect(output.error?.code).toBe("INVALID_CAPABILITY_INPUT");
  });

  test("enforces timeout and output budgets", async () => {
    const timeoutRoot = await fixture(
      entry({ timeout_seconds: 1 }),
      `export async function run() { return await new Promise(() => {}); }`,
    );
    expect((await dispatchRaw(request(), { root: timeoutRoot })).state).toBe("TIMEOUT");

    const outputRoot = await fixture(
      entry({ max_output_chars: 1000 }),
      `export async function run() { return { ok: true, state: "OK", payload: "x".repeat(2000) }; }`,
    );
    expect((await dispatchRaw(request(), { root: outputRoot })).state).toBe("OUTPUT_TOO_LARGE");
  });
});
