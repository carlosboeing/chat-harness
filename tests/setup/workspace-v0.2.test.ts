import { afterEach, describe, expect, test } from "bun:test";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runSetup } from "../../src/setup/command.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "chat-harness-v02-"));
  roots.push(root);
  return root;
}

async function kind(target: string): Promise<"file" | "directory" | "missing"> {
  try {
    const info = await lstat(target);
    return info.isDirectory() ? "directory" : "file";
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return "missing";
    }
    throw error;
  }
}

const options = {
  dryRun: false,
  specialist: "tech" as const,
  scaffoldDomain: false,
  replaceAgents: false,
  replaceWorkspace: false,
};

describe("v0.2 workspace setup", () => {
  test("creates the complete core scaffold and robust specialist seed", async () => {
    const root = await workspace();
    const output = await runSetup(root, options);

    expect(output.result.state).toBe("changes_applied");

    for (const relative of [
      "_inbox",
      ".chat-harness",
      ".chat-harness/workstreams",
      ".chat-harness/workbench",
      ".chat-harness/workbench/0-ideas",
      ".chat-harness/workbench/1-research",
      ".chat-harness/workbench/2-analysis",
      ".chat-harness/workbench/3-plans",
      ".chat-harness/workbench/4-reviews",
      ".chat-harness/procedures",
      ".chat-harness/temp",
    ]) {
      expect(await kind(path.join(root, relative))).toBe("directory");
    }

    for (const relative of [
      "AGENTS.md",
      ".chat-harness/WORKSPACE.md",
      ".chat-harness/README.md",
      ".chat-harness/source-policy.yaml",
    ]) {
      expect(await kind(path.join(root, relative))).toBe("file");
    }

    const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
    expect(agents).toContain("<!-- chat-harness-managed: agents -->");
    expect(agents).toContain(".chat-harness/WORKSPACE.md");
    expect(agents).toContain("active/parked Workstreams");
    expect(agents).toContain("independent objective + independent next action + likely future continuation");
    expect(agents).toContain("copy this entire file");

    const specialist = await readFile(path.join(root, ".chat-harness", "WORKSPACE.md"), "utf8");
    expect(specialist).toContain("Principal/Staff+");
    expect(specialist).toContain("maintainability");
    expect(specialist).toContain("operability");
    expect(specialist).toContain("security");
    expect(specialist).toContain("debuggability");

    const map = await readFile(path.join(root, ".chat-harness", "README.md"), "utf8");
    expect(map).toContain("Workspace Map");
    expect(map).toContain("WORKSPACE.md");
    expect(map).toContain("workbench/");
    expect(map).toContain("procedures/");

    expect(await kind(path.join(root, "Knowledge"))).toBe("missing");
    expect(await kind(path.join(root, "Research"))).toBe("missing");
    expect(await kind(path.join(root, "Projects"))).toBe("missing");
  });

  test("replaces a recognized stale Chat Harness AGENTS file wholesale", async () => {
    const root = await workspace();
    await writeFile(
      path.join(root, "AGENTS.md"),
      "<!-- chat-harness-managed: agents -->\n# stale\n",
    );

    const output = await runSetup(root, options);
    expect(output.result.state).toBe("changes_applied");

    const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
    expect(agents).not.toContain("# stale");
    expect(agents).toContain("# Chat Harness Project Instructions");
  });

  test("preserves an unmanaged AGENTS collision unless replacement is explicit", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "AGENTS.md"), "user-owned instructions\n");

    const blocked = await runSetup(root, options);
    expect(blocked.result.state).toBe("user_action_required");
    expect(blocked.findings.map((finding) => finding.code)).toContain("setup.unmanaged_agents_collision");
    expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toBe("user-owned instructions\n");

    const adopted = await runSetup(root, { ...options, replaceAgents: true });
    expect(adopted.result.state).toBe("changes_applied");
    expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toContain(
      "<!-- chat-harness-managed: agents -->",
    );
  });

  test("keeps existing WORKSPACE by default and replaces only when explicit", async () => {
    const root = await workspace();
    await mkdir(path.join(root, ".chat-harness"), { recursive: true });
    await writeFile(path.join(root, ".chat-harness", "WORKSPACE.md"), "custom workspace\n");

    await runSetup(root, options);
    expect(await readFile(path.join(root, ".chat-harness", "WORKSPACE.md"), "utf8")).toBe(
      "custom workspace\n",
    );

    await runSetup(root, { ...options, specialist: "career", replaceWorkspace: true });
    const workspaceSource = await readFile(path.join(root, ".chat-harness", "WORKSPACE.md"), "utf8");
    expect(workspaceSource).toContain("evidence-grounded");
    expect(workspaceSource).not.toBe("custom workspace\n");
  });

  test("domain scaffolding is opt-in and additive", async () => {
    const root = await workspace();
    await runSetup(root, {
      ...options,
      specialist: "career",
      scaffoldDomain: false,
    });
    expect(await kind(path.join(root, "Profile"))).toBe("missing");
    expect(await kind(path.join(root, "Opportunities"))).toBe("missing");

    const output = await runSetup(root, {
      ...options,
      specialist: "career",
      scaffoldDomain: true,
    });
    expect(output.result.state).toBe("changes_applied");
    expect(await kind(path.join(root, "Profile"))).toBe("directory");
    expect(await kind(path.join(root, "Opportunities"))).toBe("directory");

    await writeFile(path.join(root, "Profile", "sentinel.txt"), "keep\n");
    await runSetup(root, {
      ...options,
      specialist: "career",
      scaffoldDomain: true,
    });
    expect(await readFile(path.join(root, "Profile", "sentinel.txt"), "utf8")).toBe("keep\n");
  });

  test("domain scaffold type collisions are reported without mutation", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "Profile"), "collision\n");

    const output = await runSetup(root, {
      ...options,
      specialist: "career",
      scaffoldDomain: true,
    });
    expect(output.result.state).toBe("user_action_required");
    expect(output.findings.map((finding) => finding.code)).toContain("setup.domain_path_collision");
    expect(await readFile(path.join(root, "Profile"), "utf8")).toBe("collision\n");
  });
});
