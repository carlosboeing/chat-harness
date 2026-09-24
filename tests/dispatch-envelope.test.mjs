import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testsDir, "..");
const dispatchSource = path.join(repoRoot, "src", "dispatch.mjs");
const fixtureRoot = path.join(
  testsDir,
  "fixtures",
  "capabilities",
  "dispatcher",
);

async function runDispatch(rawRequest) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-dispatch-"));

  try {
    await fs.cp(fixtureRoot, root, { recursive: true });
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.copyFile(dispatchSource, path.join(root, "src", "dispatch.mjs"));

    const processResult = spawnSync(
      process.execPath,
      [path.join(root, "src", "dispatch.mjs")],
      {
        cwd: root,
        env: {
          ...process.env,
          CAPABILITY_REQUEST: rawRequest,
        },
        encoding: "utf8",
        timeout: 5_000,
      },
    );

    assert.equal(
      processResult.error,
      undefined,
      processResult.error?.message ?? "dispatcher process failed",
    );
    assert.equal(processResult.status, 0, processResult.stderr);
    assert.equal(processResult.stderr, "");

    return JSON.parse(processResult.stdout);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("dispatcher freezes invalid JSON envelope semantics", async () => {
  assert.deepEqual(await runDispatch("{"), {
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

test("dispatcher freezes invalid request-shape envelope semantics", async () => {
  assert.deepEqual(
    await runDispatch(
      JSON.stringify({
        version: 1,
        capability: "fixture.success",
        input: [],
      }),
    ),
    {
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
    },
  );
});

test("dispatcher freezes unknown-capability envelope semantics", async () => {
  assert.deepEqual(
    await runDispatch(
      JSON.stringify({
        version: 1,
        request_id: "req-unknown",
        capability: "fixture.missing",
        input: {},
      }),
    ),
    {
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
    },
  );
});

test("dispatcher freezes unexpected top-level field semantics", async () => {
  assert.deepEqual(
    await runDispatch(
      JSON.stringify({
        version: 1,
        request_id: "req-extra",
        capability: "fixture.success",
        input: {},
        extra: true,
      }),
    ),
    {
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
    },
  );
});

test("dispatcher freezes timeout envelope semantics", async () => {
  assert.deepEqual(
    await runDispatch(
      JSON.stringify({
        version: 1,
        request_id: "req-timeout",
        capability: "fixture.timeout",
        input: {},
      }),
    ),
    {
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
    },
  );
});

test("dispatcher freezes oversized-output envelope semantics", async () => {
  assert.deepEqual(
    await runDispatch(
      JSON.stringify({
        version: 1,
        request_id: "req-large",
        capability: "fixture.oversized",
        input: {},
      }),
    ),
    {
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
    },
  );
});

test("dispatcher freezes successful capability envelope semantics", async () => {
  assert.deepEqual(
    await runDispatch(
      JSON.stringify({
        version: 1,
        request_id: "req-success",
        capability: "fixture.success",
        input: { value: "alpha" },
      }),
    ),
    {
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
    },
  );
});
