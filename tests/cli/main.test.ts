import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runCli, type CliRuntime } from "../../src/cli/main.js";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((target) =>
      rm(target, { recursive: true, force: true }),
    ),
  );
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "chat-harness-cli-"));
  temporaryPaths.push(root);
  return root;
}

function capture(
  cwd: string,
  overrides: Partial<CliRuntime> = {},
): {
  runtime: Partial<CliRuntime>;
  stdout: () => string;
  stderr: () => string;
} {
  let stdout = "";
  let stderr = "";

  return {
    runtime: {
      cwd,
      env: {},
      isTTY: false,
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
      ...overrides,
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

describe("CLI surface", () => {
  test("--help exposes only setup, validate, and doctor commands", async () => {
    const root = await workspace();
    const io = capture(root);

    const code = await runCli(["--help"], io.runtime);
    expect(code).toBe(0);

    const output = io.stdout();
    expect(output).toContain("setup");
    expect(output).toContain("validate");
    expect(output).toContain("doctor");
    expect(output).not.toContain("init");
    expect(output).not.toContain("migrate");
    expect(output).not.toContain("upgrade");
  });

  test.each(["setup", "validate", "doctor"] as const)(
    "%s resolves an explicit workspace path",
    async (command) => {
      const root = await workspace();
      const nested = path.join(root, "nested");
      await mkdir(nested);
      const io = capture(root);

      const code = await runCli([command, nested, "--json"], io.runtime);
      expect(code).toBe(command === "validate" ? 1 : 0);

      const envelope = JSON.parse(io.stdout());
      expect(envelope.command).toBe(command);
      expect(envelope.workspace).toBe(await realpath(nested));
      expect(envelope.result.state).toBe(
        command === "setup"
          ? "changes_applied"
          : command === "validate"
            ? "failed"
            : "healthy",
      );
    },
  );

  test.each(["setup", "validate", "doctor"] as const)(
    "%s defaults to cwd without parent discovery",
    async (command) => {
      const root = await workspace();
      const child = path.join(root, "child");
      await mkdir(child);
      await mkdir(path.join(root, ".chat-harness"));
      const io = capture(child);

      const code = await runCli([command, "--json"], io.runtime);
      expect(code).toBe(command === "validate" ? 1 : 0);

      const envelope = JSON.parse(io.stdout());
      expect(envelope.workspace).toBe(await realpath(child));
    },
  );

  test("usage errors exit 2", async () => {
    const root = await workspace();
    const io = capture(root);

    const code = await runCli(["validate", root, "unexpected"], io.runtime);
    expect(code).toBe(2);
    expect(io.stderr()).toContain("too many arguments");
  });

  test("internal command errors exit 3 and stay valid JSON", async () => {
    const root = await workspace();
    const io = capture(root, {
      handlers: {
        validate: async () => {
          throw new Error("fixture failure");
        },
      },
    });

    const code = await runCli(["validate", root, "--json"], io.runtime);
    expect(code).toBe(3);

    const envelope = JSON.parse(io.stdout());
    expect(envelope.version).toBe(1);
    expect(envelope.command).toBe("validate");
    expect(envelope.success).toBe(false);
    expect(envelope.result.state).toBe("execution_failure");
    expect(envelope.findings[0].code).toBe("cli.internal_error");
  });

  test("NO_COLOR suppresses ANSI decoration for TTY output", async () => {
    const root = await workspace();
    const io = capture(root, {
      env: { NO_COLOR: "1" },
      isTTY: true,
    });

    const code = await runCli(["doctor", root], io.runtime);
    expect(code).toBe(0);
    expect(io.stdout()).not.toContain("\u001b[");
  });

  test("--no-color suppresses ANSI decoration for TTY output", async () => {
    const root = await workspace();
    const io = capture(root, {
      isTTY: true,
    });

    const code = await runCli(["doctor", root, "--no-color"], io.runtime);
    expect(code).toBe(0);
    expect(io.stdout()).not.toContain("\u001b[");
  });

  test("non-TTY output is line-oriented with no terminal control sequences", async () => {
    const root = await workspace();
    const io = capture(root, {
      isTTY: false,
    });

    const code = await runCli(["setup", root], io.runtime);
    expect(code).toBe(0);
    expect(io.stdout()).not.toContain("\u001b[");
    expect(io.stdout()).not.toContain("\u001b[?25");
  });

  test("missing workspace returns a finding-level failure", async () => {
    const root = await workspace();
    const missing = path.join(root, "missing");
    const io = capture(root);

    const code = await runCli(["doctor", missing, "--json"], io.runtime);
    expect(code).toBe(1);

    const envelope = JSON.parse(io.stdout());
    expect(envelope.findings[0].code).toBe("workspace.not_found");
  });

  test("non-directory workspace returns a finding-level failure", async () => {
    const root = await workspace();
    const file = path.join(root, "not-a-directory");
    await writeFile(file, "fixture");
    const io = capture(root);

    const code = await runCli(["validate", file, "--json"], io.runtime);
    expect(code).toBe(1);

    const envelope = JSON.parse(io.stdout());
    expect(envelope.findings[0].code).toBe("workspace.not_directory");
  });
});
