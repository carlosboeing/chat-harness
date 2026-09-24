import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const workflowPath = new URL(
  "../.github/workflows/capability-dispatch.yml",
  import.meta.url,
);

test("capability dispatch keeps the frozen owner-gated least-privilege transport assumptions", async () => {
  const workflow = await fs.readFile(workflowPath, "utf8");

  assert.match(
    workflow,
    /on:\s*\n\s*issues:\s*\n\s*types:\s*\[opened\]/,
  );
  assert.match(
    workflow,
    /permissions:\s*\n\s*contents:\s*read\s*\n\s*issues:\s*write/,
  );
  assert.match(
    workflow,
    /if:\s*github\.event\.issue\.author_association == 'OWNER' && startsWith\(github\.event\.issue\.title, '\[capability\] '\)/,
  );
  assert.match(
    workflow,
    /concurrency:\s*\n\s*group:\s*capability-\$\{\{ github\.event\.issue\.number \}\}\s*\n\s*cancel-in-progress:\s*false/,
  );
});
