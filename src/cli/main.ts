import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Command, CommanderError, Option } from "commander";
import { confirm, isCancel } from "@clack/prompts";

import packageMetadata from "../../package.json" with { type: "json" };

import { EXIT_INTERNAL, EXIT_SUCCESS, EXIT_USAGE, exitCodeForEnvelope, type ExitCode } from "./exit-codes.js";
import { renderHuman, renderJson } from "./render.js";
import { renderInteractive } from "./terminal.js";
import { commandEnvelope, type CommandEnvelope, type CommandName, type Finding } from "./result.js";
import { runDoctor } from "../doctor/command.js";
import { runSetup } from "../setup/command.js";
import { resolveInteractiveSetup } from "../setup/interactive.js";
import { SPECIALIST_IDS, type SpecialistId } from "../setup/specialists.js";
import { runValidate } from "../validation/command.js";
import { resolveWorkspaceRoot, WorkspaceResolutionError } from "../workspace/resolve.js";

export interface CommandHandlerResult {
  result: { state: string; [key: string]: unknown };
  findings?: Finding[];
}
export interface CommandContext {
  command: CommandName;
  workspace: string;
  options: {
    json: boolean;
    dryRun: boolean;
    specialist: SpecialistId;
    scaffoldDomain: boolean;
    replaceAgents: boolean;
    replaceWorkspace: boolean;
  };
}
export type CommandHandler = (context: CommandContext) => Promise<CommandHandlerResult>;
export interface CliRuntime {
  cwd: string;
  env: NodeJS.ProcessEnv;
  isTTY: boolean;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  handlers: Partial<Record<CommandName, CommandHandler>>;
  nativeTerminal: boolean;
}

function defaultRuntime(): CliRuntime {
  return {
    cwd: process.cwd(),
    env: process.env,
    isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    handlers: {},
    nativeTerminal: true,
  };
}

function defaultHandler(context: CommandContext, runtime: CliRuntime): Promise<CommandHandlerResult> {
  if (context.command === "doctor") return runDoctor(context.workspace);
  if (context.command === "validate") return runValidate(context.workspace);
  if (context.command === "setup") {
    return runSetup(
      context.workspace,
      {
        dryRun: context.options.dryRun,
        specialist: context.options.specialist,
        scaffoldDomain: context.options.scaffoldDomain,
        replaceAgents: context.options.replaceAgents,
        replaceWorkspace: context.options.replaceWorkspace,
      },
      {
        applyOptions: {
          beforeApply: async (plan) => {
            if (!runtime.isTTY || context.options.json) return;

            const create = plan.operations.filter((operation) => operation.action !== "replace_file");
            const replace = plan.operations.filter((operation) => operation.action === "replace_file");
            runtime.stdout(
              [
                "",
                "Ready to set up Chat Harness.",
                "",
                ...(create.length > 0
                  ? ["Will create:", ...create.map((operation) => `  - ${operation.path}`), ""]
                  : []),
                ...(replace.length > 0
                  ? ["Will replace:", ...replace.map((operation) => `  - ${operation.path}`), ""]
                  : []),
                "Everything else in the Workspace will be left unchanged.",
                "",
              ].join("\n"),
            );

            const answer = await confirm({
              message: "Apply these changes?",
              initialValue: true,
            });
            return !isCancel(answer) && answer;
          },
        },
      },
    );
  }
  return Promise.resolve({ result: { state: "ready" } });
}

function shouldUseColor(argv: readonly string[], runtime: CliRuntime): boolean {
  return runtime.isTTY && !argv.includes("--no-color") && runtime.env.NO_COLOR === undefined;
}
function workspaceHint(inputPath: string | undefined, cwd: string): string {
  return path.resolve(cwd, inputPath ?? ".");
}
function writeEnvelope(envelope: CommandEnvelope, json: boolean, color: boolean, runtime: CliRuntime): ExitCode {
  if (!json && color && runtime.isTTY && runtime.nativeTerminal) renderInteractive(envelope);
  else runtime.stdout(json ? renderJson(envelope) : renderHuman(envelope, { color }));
  return exitCodeForEnvelope(envelope);
}

export async function runCli(argv: readonly string[], overrides: Partial<CliRuntime> = {}): Promise<ExitCode> {
  const base = defaultRuntime();
  const runtime: CliRuntime = {
    ...base,
    ...overrides,
    handlers: { ...base.handlers, ...overrides.handlers },
    nativeTerminal:
      overrides.stdout === undefined &&
      overrides.stderr === undefined &&
      (overrides.nativeTerminal ?? base.nativeTerminal),
  };

  const requestedJson = argv.includes("--json");
  const color = shouldUseColor(argv, runtime);
  let selectedCommand: CommandName | undefined;
  let selectedPath: string | undefined;
  let exitCode: ExitCode = EXIT_SUCCESS;

  const program = new Command();
  program
    .name("chat-harness")
    .description("Create, validate, and diagnose Chat Harness Workspaces for AI assistants.")
    .version(packageMetadata.version)
    .showHelpAfterError("(run with --help for usage)")
    .addHelpText(
      "after",
      `
Examples:
  chat-harness setup
  chat-harness setup --specialist travel
  chat-harness validate
  chat-harness doctor

Commands default to the current directory and do not search parent directories
for a Workspace. Pass [path] only when targeting another existing directory.

Exit codes:
  0  Success
  1  A setup, validation, or health finding requires attention
  2  Invalid command-line usage
  3  Unexpected internal failure

Documentation:
  https://github.com/carlosboeing/chat-harness#usage
`,
    )
    .exitOverride()
    .configureOutput({
      writeOut: (output) => runtime.stdout(output),
      writeErr: (output) => runtime.stderr(output),
    });

  const addCommand = (name: CommandName, description: string): void => {
    const command = program
      .command(name)
      .description(description)
      .argument("[path]", "Existing Workspace root directory; defaults to the current directory")
      .option("--json", "Emit the stable machine-readable JSON envelope")
      .option("--no-color", "Disable ANSI terminal decoration");

    if (name === "setup") {
      command
        .option("--dry-run", "Inspect and return the exact reconciliation plan without mutation")
        .addOption(
          new Option("--specialist <id>", "Seed WORKSPACE.md with a setup-time specialist")
            .choices([...SPECIALIST_IDS]),
        )
        .option("--scaffold-domain", "Create the selected specialist's additive domain starter folders")
        .option("--replace-agents", "Overwrite an existing unmanaged AGENTS.md and let Chat Harness manage it")
        .option("--replace-workspace", "Overwrite WORKSPACE.md with the selected specialist seed")
        .addHelpText(
          "after",
          `
Behaviour:
  Interactive setup explains choices before asking for consent and shows the
  exact create/replace plan before writing. Existing content not in that plan
  is left unchanged.

  If --specialist is omitted, interactive setup asks what the Workspace is
  mainly for; non-interactive setup uses general.

  --json disables interactive prompts. --scaffold-domain creates only the
  selected specialist's optional starter folders.

Examples:
  chat-harness setup
  chat-harness setup --specialist travel
  chat-harness setup --specialist tech --scaffold-domain
  chat-harness setup --dry-run
  chat-harness setup ~/Projects/research --specialist research
  chat-harness setup --json

ChatGPT setup guide:
  https://github.com/carlosboeing/chat-harness/blob/main/docs/hosts/chatgpt.md
`,
        );
    } else if (name === "validate") {
      command.addHelpText(
        "after",
        `
Checks:
  Required scaffold paths, managed AGENTS.md, Workstream contracts,
  supersession references, and Source Policy validity. No files are modified.

Examples:
  chat-harness validate
  chat-harness validate ~/Projects/research
  chat-harness validate --json
`,
      );
    } else {
      command.addHelpText(
        "after",
        `
Checks:
  Workspace readability/writability, scaffold health, local runtime
  compatibility, capability registry integrity when present, and Git when the
  GitHub extension development path is present. No files are modified.

  Hosted assistant entitlements and conversation-level permissions cannot be
  diagnosed locally.

Examples:
  chat-harness doctor
  chat-harness doctor ~/Projects/research
  chat-harness doctor --json
`,
      );
    }

    command.action(async (
      inputPath: string | undefined,
      options: {
        json?: boolean;
        dryRun?: boolean;
        specialist?: SpecialistId;
        scaffoldDomain?: boolean;
        replaceAgents?: boolean;
        replaceWorkspace?: boolean;
      },
    ) => {
      selectedCommand = name;
      selectedPath = inputPath;
      const workspace = await resolveWorkspaceRoot(inputPath, runtime.cwd);
      let setup = {
        specialist: options.specialist ?? ("general" as SpecialistId),
        scaffoldDomain: Boolean(options.scaffoldDomain),
        replaceAgents: Boolean(options.replaceAgents),
        replaceWorkspace: Boolean(options.replaceWorkspace),
      };

      if (
        name === "setup" &&
        runtime.isTTY &&
        runtime.nativeTerminal &&
        !options.json
      ) {
        const interactive = await resolveInteractiveSetup(
          workspace,
          {
            specialist: options.specialist,
            scaffoldDomain: Boolean(options.scaffoldDomain),
            replaceAgents: Boolean(options.replaceAgents),
            replaceWorkspace: Boolean(options.replaceWorkspace),
          },
          runtime.stdout,
        );
        if (interactive.cancelled) {
          const envelope = commandEnvelope({
            command: name,
            workspace,
            result: { state: "cancelled" },
          });
          exitCode = writeEnvelope(envelope, false, color, runtime);
          return;
        }
        setup = interactive;
      }

      const context: CommandContext = {
        command: name,
        workspace,
        options: {
          json: Boolean(options.json),
          dryRun: Boolean(options.dryRun),
          ...setup,
        },
      };
      const handler = runtime.handlers[name];
      const output = handler ? await handler(context) : await defaultHandler(context, runtime);
      const envelope = commandEnvelope({
        command: name,
        workspace,
        result: output.result,
        ...(output.findings ? { findings: output.findings } : {}),
      });
      exitCode = writeEnvelope(envelope, context.options.json, color, runtime);
    });
  };

  addCommand("setup", "Create or reconcile a Chat Harness Workspace");
  addCommand("validate", "Validate Workspace scaffold, Workstreams, and Source Policy");
  addCommand("doctor", "Diagnose Workspace health and local prerequisites");

  try {
    await program.parseAsync(["node", "chat-harness", ...argv]);
    if (selectedCommand === undefined && argv.length === 0) runtime.stdout(program.helpInformation());
    return exitCode;
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode === 0 ? EXIT_SUCCESS : EXIT_USAGE;
    if (error instanceof WorkspaceResolutionError && selectedCommand) {
      const envelope = commandEnvelope({
        command: selectedCommand,
        workspace: workspaceHint(selectedPath, runtime.cwd),
        result: { state: "failed" },
        findings: [{ code: error.code, severity: "error", message: error.message, location: error.location }],
      });
      return writeEnvelope(envelope, requestedJson, color, runtime);
    }
    if (selectedCommand) {
      const envelope = commandEnvelope({
        command: selectedCommand,
        workspace: workspaceHint(selectedPath, runtime.cwd),
        result: { state: "execution_failure" },
        findings: [{ code: "cli.internal_error", severity: "error", message: "The command failed unexpectedly." }],
        success: false,
      });
      if (requestedJson) runtime.stdout(renderJson(envelope));
      else runtime.stderr(renderHuman(envelope, { color }));
      return EXIT_INTERNAL;
    }
    if (requestedJson) {
      runtime.stdout(JSON.stringify({
        version: 1,
        command: "unknown",
        workspace: workspaceHint(undefined, runtime.cwd),
        success: false,
        result: { state: "execution_failure" },
        findings: [{ code: "cli.internal_error", severity: "error", message: "The CLI failed unexpectedly." }],
      }, null, 2) + "\n");
    } else runtime.stderr("Chat Harness failed unexpectedly.\n");
    return EXIT_INTERNAL;
  }
}

function isCliEntrypoint(metaUrl: string, argv1: string | undefined): boolean {
  if (argv1 === undefined) return false;
  try { return realpathSync(fileURLToPath(metaUrl)) === realpathSync(argv1); }
  catch { return metaUrl === pathToFileURL(argv1).href; }
}
if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  runCli(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch(() => { process.exitCode = EXIT_INTERNAL; });
}
