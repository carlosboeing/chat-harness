import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import YAML from "yaml";

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


const releaseWorkflowPath = new URL(
  "../.github/workflows/release.yml",
  import.meta.url,
);

test("release workflow publishes only from explicit release intent", async () => {
  const workflow = await fs.readFile(releaseWorkflowPath, "utf8");

  assert.match(workflow, /push:\s*\n\s*branches:\s*\n\s*- main/);
  assert.match(workflow, /tags:\s*\n\s*- "v\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+"/);
  assert.match(
    workflow,
    /ordinary main update: package version is unchanged .* already exists; no release/,
  );
  assert.match(
    workflow,
    /pending release recovery: package version .* does not exist/,
  );
  assert.match(
    workflow,
    /git show-ref --verify --quiet "refs\/tags\/\$\{TAG\}"/,
  );
  assert.match(workflow, /missing release notes: docs\/releases\/\$\{TAG\}\.md/);
  assert.match(workflow, /release version must increase:/);
  assert.match(workflow, /git tag "\$\{TAG\}" "\$\(git rev-parse HEAD\)"/);
  assert.match(workflow, /npm publish .*--access public --provenance/);
  assert.match(
    workflow,
    /if: needs\.detect\.outputs\.should_release == 'true' && needs\.detect\.outputs\.publish_enabled == 'true'/,
  );

  const tagIndex = workflow.indexOf("Create release tag");
  const publishIndex = workflow.indexOf("Publish npm package using OIDC");
  assert.ok(tagIndex >= 0 && publishIndex > tagIndex);
});


test("GitHub workflows are syntactically valid YAML", async () => {
  for (const path of [workflowPath, releaseWorkflowPath]) {
    const source = await fs.readFile(path, "utf8");
    const parsed = YAML.parse(source);
    assert.equal(typeof parsed, "object");
    assert.ok(parsed !== null);
  }
});
