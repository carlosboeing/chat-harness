import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { inspectWorkspace } from "../../src/workspace/inspect.js";
import { buildSetupPlan, inspectDomainScaffold } from "../../src/setup/plan.js";
import {
  buildSetupStructure,
  renderSetupTree,
  type SetupStructureEntry,
} from "../../src/setup/presentation.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "chat-harness-presentation-"));
  roots.push(root);
  return root;
}

describe("setup presentation", () => {
  test("renders directories first with _ before . and natural alphabetical order", () => {
    const entries: SetupStructureEntry[] = [
      { path: "AGENTS.md", kind: "file", status: "new" },
      { path: "Trips", kind: "directory", status: "already_there" },
      { path: ".chat-harness", kind: "directory", status: "new" },
      { path: "_inbox", kind: "directory", status: "new" },
      { path: ".chat-harness/WORKSPACE.md", kind: "file", status: "new" },
      { path: ".chat-harness/README.md", kind: "file", status: "new" },
      { path: ".chat-harness/workstreams", kind: "directory", status: "new" },
      { path: ".chat-harness/temp", kind: "directory", status: "new" },
      { path: ".chat-harness/procedures", kind: "directory", status: "new" },
      { path: ".chat-harness/workbench", kind: "directory", status: "new" },
      { path: ".chat-harness/source-policy.yaml", kind: "file", status: "new" },
    ];

    const output = renderSetupTree("/tmp/Travel", entries);
    const lines = output.split("\n");

    expect(lines[0]).toBe("Travel/");
    expect(lines.findIndex((line) => line.includes("_inbox/"))).toBeLessThan(
      lines.findIndex((line) => line.includes(".chat-harness/")),
    );
    expect(lines.findIndex((line) => line.includes(".chat-harness/"))).toBeLessThan(
      lines.findIndex((line) => line.includes("Trips/")),
    );
    expect(lines.findIndex((line) => line.includes("Trips/"))).toBeLessThan(
      lines.findIndex((line) => line.includes("AGENTS.md")),
    );

    const procedures = lines.findIndex((line) => line.includes("procedures/"));
    const temp = lines.findIndex((line) => line.includes("temp/"));
    const workbench = lines.findIndex((line) => line.includes("workbench/"));
    const workstreams = lines.findIndex((line) => line.includes("workstreams/"));
    const readme = lines.findIndex((line) => line.includes("README.md"));
    const sourcePolicy = lines.findIndex((line) => line.includes("source-policy.yaml"));
    const workspaceFile = lines.findIndex((line) => line.includes("WORKSPACE.md"));

    expect(procedures).toBeLessThan(temp);
    expect(temp).toBeLessThan(workbench);
    expect(workbench).toBeLessThan(workstreams);
    expect(workstreams).toBeLessThan(readme);
    expect(readme).toBeLessThan(sourcePolicy);
    expect(sourcePolicy).toBeLessThan(workspaceFile);

    const chatHarnessLine = lines.find((line) => line.includes(".chat-harness/"));
    const proceduresLine = lines.find((line) => line.includes("procedures/"));
    const inboxLine = lines.find((line) => line.includes("_inbox/"));
    const tripsLine = lines.find((line) => line.includes("Trips/"));

    expect(chatHarnessLine).toContain("new");
    expect(inboxLine).toContain("new");
    expect(proceduresLine).not.toContain("new");
    expect(tripsLine).toContain("already there");
  });

  test("keeps an existing specialist folder visible as already there", async () => {
    const root = await workspace();
    await mkdir(path.join(root, "Trips"));

    const snapshot = await inspectWorkspace(root);
    const domain = await inspectDomainScaffold(root, "travel");
    const plan = buildSetupPlan(
      snapshot,
      {
        specialist: "travel",
        scaffoldDomain: true,
        replaceAgents: false,
        replaceWorkspace: false,
      },
      domain,
    );

    const planned = buildSetupStructure(plan, "planned");
    const trips = planned.find((entry) => entry.path === "Trips");
    expect(trips).toEqual({
      path: "Trips",
      kind: "directory",
      status: "already_there",
    });

    const output = renderSetupTree(root, planned);
    expect(output).toContain("Trips/");
    expect(output).toContain("already there");
  });

  test("changes planned statuses to created after apply", async () => {
    const root = await workspace();
    const snapshot = await inspectWorkspace(root);
    const domain = await inspectDomainScaffold(root, "travel");
    const plan = buildSetupPlan(
      snapshot,
      {
        specialist: "travel",
        scaffoldDomain: true,
        replaceAgents: false,
        replaceWorkspace: false,
      },
      domain,
    );

    const planned = buildSetupStructure(plan, "planned");
    const applied = buildSetupStructure(plan, "applied");

    expect(planned.find((entry) => entry.path === "Trips")?.status).toBe("new");
    expect(applied.find((entry) => entry.path === "Trips")?.status).toBe("created");
    expect(applied.find((entry) => entry.path === "AGENTS.md")?.status).toBe("created");
  });
});
