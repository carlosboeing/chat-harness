import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { run } from "../../capabilities/linkedin-job/handler.js";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(
  testsDir,
  "..",
  "fixtures",
  "capabilities",
  "linkedin-job",
);

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function runFixture(name: string, jobId = "4468897387") {
  const html = await readFile(path.join(fixtureDir, name), "utf8");
  globalThis.fetch = async () =>
    new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  return await run({ job_id: jobId });
}

describe("linkedin.job.lookup", () => {
  test("exact identity fixture remains EXACT_VERIFIED", async () => {
    const result = await runFixture("exact.html");
    expect(result.ok).toBe(true);
    expect(result.state).toBe("EXACT_VERIFIED");
    expect(
      (result.identity as { observed_job_ids: string[] }).observed_job_ids,
    ).toEqual(["4468897387"]);
  });

  test("identity mismatch remains rejected", async () => {
    const result = await runFixture("identity-mismatch.html");
    expect(result.ok).toBe(false);
    expect(result.state).toBe("IDENTITY_MISMATCH");
  });

  test("partial evidence remains non-successful", async () => {
    const result = await runFixture("partial.html");
    expect(result.ok).toBe(false);
    expect(result.state).toBe("PARTIAL_EVIDENCE");
  });

  test("handler rejects caller-controlled fields even behind central validation", async () => {
    const result = await run({
      job_id: "4468897387",
      url: "https://evil.example",
    });
    expect(result.ok).toBe(false);
    expect(result.state).toBe("INVALID_INPUT");
  });
});
