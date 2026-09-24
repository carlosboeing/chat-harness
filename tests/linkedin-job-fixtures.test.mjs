import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { run } from "../capabilities/linkedin-job/handler.mjs";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(
  testsDir,
  "fixtures",
  "capabilities",
  "linkedin-job",
);

async function runAgainstFixture(fileName, jobId) {
  const html = await fs.readFile(path.join(fixtureDir, fileName), "utf8");
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });

  try {
    return await run({ job_id: jobId });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("LinkedIn exact-identity fixture produces exact verified evidence", async () => {
  const result = await runAgainstFixture("exact.html", "4468897387");

  assert.equal(result.ok, true);
  assert.equal(result.state, "EXACT_VERIFIED");
  assert.deepEqual(result.identity.observed_job_ids, ["4468897387"]);
  assert.equal(result.identity.exact_match, true);
  assert.equal(result.resource.title, "Principal Engineer");
  assert.match(result.resource.description, /reliable distributed systems/i);
});

test("LinkedIn identity-mismatch fixture is rejected deterministically", async () => {
  const result = await runAgainstFixture(
    "identity-mismatch.html",
    "4468897387",
  );

  assert.equal(result.ok, false);
  assert.equal(result.state, "IDENTITY_MISMATCH");
  assert.deepEqual(result.identity.observed_job_ids, ["1111111111"]);
  assert.equal(result.identity.exact_match, false);
});

test("LinkedIn partial-evidence fixture remains non-successful", async () => {
  const result = await runAgainstFixture("partial.html", "4468897387");

  assert.equal(result.ok, false);
  assert.equal(result.state, "PARTIAL_EVIDENCE");
  assert.deepEqual(result.identity.observed_job_ids, ["4468897387"]);
  assert.equal(result.identity.exact_match, true);
  assert.equal(result.resource.title, "Principal Engineer");
  assert.ok(result.resource.description_chars < 100);
});
