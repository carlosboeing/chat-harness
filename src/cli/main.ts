import path from "node:path";
import { pathToFileURL } from "node:url";
import { Command, CommanderError } from "commander";

import {
  EXIT_INTERNAL,
  EXIT_SUCCESS,
  EXIT_USAGE,
  exitCodeForEnvelope,
  type ExitCode,
} from "./exit-codes.js";
import { renderHuman, renderJson } from "./render.js";
import {
  commandEnvelope,
  type CommandEnvelope,
  type CommandName,
  type Finding,
} from "./result.js";
import { runSetup } from "../setup/command.js";
import {
  resolveWorkspaceRoot,
  WorkspaceResolutionError,
} from "../workspace/resolve.js";

export interface CommandHandlerResult {
  result: {
    state: string;
    [key: string]: unknown;
  };
  findings?: Finding[];
}

export interface CommandContext {
  command: CommandName;
  workspace: string;
  options: {
    json: boolean;
    dryRun: boolean;
  };
}

export type CommandHandler = (
  context: CommandContext,
) => Promise<CommandHandlerResult>;

export interface CliRuntime {
  cwd: string;
  env: NodeJS.ProcessEnv;
  isTTY: boolean;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  handlers: Partial<Record<CommandName, CommandHandler>>;
}

function defaultRuntime(): CliRuntime {
  return {
    cwd: process.cwd(),
    env: process.env,
    isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    handlers: {},
  };
}

function defaultHandler(
  context: CommandContext,
  runtime: CliRuntime,
): Promise<CommandHandlerResult> {
  if (context.command === "setup") {
    return runSetup(
      context.workspace,
      { dryRun: context.options.dryRun },
      {
        applyOptions: {
          beforeApply: async (plan) => {
            if (!runtime.isTTY || context.options.json) {
              return;
            }
            const paths = plan.operations.map((operation) => operation.path);
            runtime.stdout(
              [
                "Chat Harness will create:",
                ...paths.map((managedPath) => `- ${managedPath}`),
                "Existing user files will not be rewritten.",
                "",
              ].join("\n"),
            );
          },
        },
      },
    );
  }

  return Promise.resolve({
    result: {
      state: "ready",
    },
  });
}

function shouldUseColor(
  argv: readonly string[],
  runtime: CliRuntime,
): boolean {
  return (
    runtime.isTTY &&
    !argv.includes("--no-color") &&
    runtime.env.NO_COLOR === undefined
  );
}

function workspaceHint(
  inputPath: string | undefined,
  cwd: string,
): string {
  return path.resolve(cwd, inputPath ?? ".");
}

function writeEnvelope(
  envelope: CommandEnvelope,
  json: boolean,
  color: boolean,
  runtime: CliRuntime,
): ExitCode {
  runtime.stdout(
    json ? renderJson(envelope) : renderHuman(envelope, { color }),
  );
  return exitCodeForEnvelope(envelope);
}

export async function runCli(
  argv: readonly string[],
  overrides: Partial<CliRuntime> = {},
): Promise<ExitCode> {
  const base = defaultRuntime();
  const runtime: CliRuntime = {
    ...base,
    ...overrides,
    handlers: {
      ...base.handlers,
      ...overrides.handlers,
    },
  };

  const requestedJson = argv.includes("--json");
  const color = shouldUseColor(argv, runtime);
  let selectedCommand: CommandName | undefined;
  let selectedPath: string | undefined;
  let exitCode: ExitCode = EXIT_SUCCESS;

  const program = new Command();
  program
    .name("chat-harness")
    .description("Harness engineering for AI assistants.")
    .version("0.1.0")
    .exitOverride()
    .configureOutput({
      writeOut: (output) => runtime.stdout(output),
      writeErr: (output) => runtime.stderr(output),
    });

  const addCommand = (name: CommandName, description: string): void => {
    const command = program
      .command(name)
      .description(description)
      .argument("[path]", "Workspace root; defaults to the current directory")
      .option("--json", "Emit the stable machine-readable JSON envelope")
      .option("--no-color", "Disable ANSI terminal decoration");

    if (name === "setup") {
      command.option(
        "--dry-run",
        "Inspect and return the exact reconciliation plan without mutation",
      );
    }

    command.action(
      async (
        inputPath: string | undefined,
        options: { json?: boolean; dryRun?: boolean },
      ) => {
        selectedCommand = name;
        selectedPath = inputPath;
        const workspace = await resolveWorkspaceRoot(inputPath, runtime.cwd);
        const context: CommandContext = {
          command: name,
          workspace,
          options: {
            json: Boolean(options.json),
            dryRun: Boolean(options.dryRun),
          },
        };
        const handler = runtime.handlers[name];
        const output = handler
          ? await handler(context)
          : await defaultHandler(context, runtime);
        const envelope = commandEnvelope({
          command: name,
          workspace,
          result: output.result,
          ...(output.findings ? { findings: output.findings } : {}),
        });
        exitCode = writeEnvelope(
          envelope,
          context.options.json,
          color,
          runtime,
        );
      },
    );
  };

  addCommand("setup", "Create or reconcile minimal Chat Harness workspace state");
  addCommand("validate", "Validate deterministic Chat Harness workspace contracts");
  addCommand("doctor", "Diagnose local Chat Harness environment prerequisites");

  try {
    await program.parseAsync(["node", "chat-harness", ...argv]);
    if (selectedCommand === undefined && argv.length === 0) {
      runtime.stdout(program.helpInformation());
    }
    return exitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode === 0 ? EXIT_SUCCESS : EXIT_USAGE;
    }

    if (error instanceof WorkspaceResolutionError && selectedCommand) {
      const envelope = commandEnvelope({
        command: selectedCommand,
        workspace: workspaceHint(selectedPath, runtime.cwd),
        result: { state: "failed" },
        findings: [
          {
            code: error.code,
            severity: "error",
            message: error.message,
            location: error.location,
          },
        ],
      });
      return writeEnvelope(envelope, requestedJson, color, runtime);
    }

    if (selectedCommand) {
      const envelope = commandEnvelope({
        command: selectedCommand,
        workspace: workspaceHint(selectedPath, runtime.cwd),
        result: { state: "execution_failure" },
        findings: [
          {
            code: "cli.internal_error",
            severity: "error",
            message: "The command failed unexpectedly.",
          },
        ],
        success: false,
      });

      if (requestedJson) {
        runtime.stdout(renderJson(envelope));
      } else {
        runtime.stderr(renderHuman(envelope, { color }));
      }
      return EXIT_INTERNAL;
    }

    if (requestedJson) {
      runtime.stdout(
        JSON.stringify(
          {
            version: 1,
            command: "unknown",
            workspace: workspaceHint(undefined, runtime.cwd),
            success: false,
            result: { state: "execution_failure" },
            findings: [
              {
                code: "cli.internal_error",
                severity: "error",
                message: "The CLI failed unexpectedly.",
              },
            ],
          },
          null,
          2,
        ) + "\n",
      );
    } else {
      runtime.stderr("Chat Harness failed unexpectedly.\n");
    }
    return EXIT_INTERNAL;
  }
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.exitCode = EXIT_INTERNAL;
    });
}
