import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Command, CommanderError, Option } from "commander";
import { confirm, isCancel, note } from "@clack/prompts";

import packageMetadata from "../../package.json" with { type: "json" };

import { EXIT_INTERNAL, EXIT_SUCCESS, EXIT_USAGE, exitCodeForEnvelope, type ExitCode } from "./exit-codes.js";
import { renderHuman, renderJson } from "./render.js";
import { renderInteractive } from "./terminal.js";
import { commandEnvelope, type CommandEnvelope, type CommandName, type Finding, type WorkspaceCommandName } from "./result.js";
import { runDoctor } from "../doctor/command.js";
import {
  defaultLifecycleDependencies,
  inspectCurrentInstallation,
  runUninstall,
  runUpdate,
  type LifecycleDependencies,
} from "../lifecycle/command.js";
import { runWindowsLifecycleHelper } from "../lifecycle/windows.js";
import { runSetup } from "../setup/command.js";
import { resolveInteractiveSetup } from "../setup/interactive.js";
import { buildSetupStructure, renderSetupTree } from "../setup/presentation.js";
import { SPECIALIST_IDS, type SpecialistId } from "../setup/specialists.js";
import { runValidate } from "../validation/command.js";
import { resolveWorkspaceRoot, WorkspaceResolutionError } from "../workspace/resolve.js";

export interface CommandHandlerResult {
  result: { state: string; [key: string]: unknown };
  findings?: Finding[];
}
export interface CommandContext {
  command: WorkspaceCommandName;
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
  handlers: Partial<Record<WorkspaceCommandName, CommandHandler>>;
  lifecycle: LifecycleDependencies;
  nativeTerminal: boolean;
  version: string;
}

function defaultRuntime(): CliRuntime {
  return {
    cwd: process.cwd(),
    env: process.env,
    isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    handlers: {},
    lifecycle: defaultLifecycleDependencies,
    nativeTerminal: true,
    version: packageMetadata.version,
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
            if (!runtime.isTTY || !runtime.nativeTerminal || context.options.json) return;

            note(
              [
                "Here's how the Chat Harness part of this Workspace will look after setup:",
                "",
                renderSetupTree(
                  plan.workspace,
                  buildSetupStructure(plan, "planned"),
                ),
                "",
                "Anything else already in this folder will be left exactly as it is.",
              ].join("\n"),
              "Review your Workspace",
            );

            const answer = await confirm({
              message: "Set up this Workspace now?",
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

  if (argv[0] === "__lifecycle-helper") {
    try {
      if (process.platform !== "win32") {
        throw new Error("Windows lifecycle helpers can run only on Windows.");
      }
      const jobPath = argv[1];
      if (!jobPath || argv.length !== 2) {
        throw new Error("Invalid lifecycle helper invocation.");
      }
      await runWindowsLifecycleHelper(jobPath);
      return EXIT_SUCCESS;
    } catch (error) {
      runtime.stderr(
        "Chat Harness lifecycle helper failed: " +
        (error instanceof Error ? error.message : String(error)) +
        "\n",
      );
      return EXIT_INTERNAL;
    }
  }

  const requestedJson = argv.includes("--json");
  const color = shouldUseColor(argv, runtime);
  let selectedCommand: CommandName | undefined;
  let selectedPath: string | undefined;
  let exitCode: ExitCode = EXIT_SUCCESS;

  const program = new Command();
  program
    .name("chat-harness")
    .description("Create, validate, diagnose, update, and uninstall Chat Harness.")
    .version(runtime.version)
    .showHelpAfterError("(run with --help for usage)")
    .addHelpText(
      "after",
      `
Examples:
  chat-harness setup
  chat-harness setup --specialist travel
  chat-harness validate
  chat-harness doctor
  chat-harness update --check
  chat-harness update
  chat-harness uninstall

Workspace commands default to the current directory and do not search parent
directories. Pass [path] only when targeting another existing directory.

Exit codes:
  0  Success
  1  A command finding requires attention
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

  const addCommand = (name: WorkspaceCommandName, description: string): void => {
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
  Interactive setup explains what Chat Harness will do, shows the complete
  resulting Workspace structure with human-readable status labels, and asks
  for approval before writing. Existing unrelated content is left unchanged.

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

  program
    .command("update")
    .description("Update the installed Chat Harness CLI through its owning channel")
    .option("--check", "Check whether an update is available without modifying anything")
    .option("--json", "Emit the stable machine-readable JSON envelope")
    .option("--no-color", "Disable ANSI terminal decoration")
    .addHelpText(
      "after",
      `
Behaviour:
  Standalone installs use the latest stable GitHub Release and verify the
  release SHA-256 sidecar before replacement. Global npm installs delegate to
  npm. Local development builds are never replaced by a published release.

  update changes Chat Harness software only. It never migrates or modifies
  Workspace data. Use setup/validate separately after a Workspace contract
  change.

Examples:
  chat-harness update --check
  chat-harness update
  chat-harness update --json
`,
    )
    .action(async (options: { check?: boolean; json?: boolean }) => {
      selectedCommand = "update";
      const output = await runUpdate(
        runtime.version,
        { check: Boolean(options.check), json: Boolean(options.json) },
        runtime.lifecycle,
      );
      const envelope = commandEnvelope({
        command: "update",
        result: output.result,
        ...(output.findings ? { findings: output.findings } : {}),
      });
      exitCode = writeEnvelope(
        envelope,
        Boolean(options.json),
        color,
        runtime,
      );
    });

  program
    .command("uninstall")
    .description("Remove the installed Chat Harness CLI without touching Workspace data")
    .option("--yes", "Skip the uninstall confirmation")
    .option("--json", "Emit the stable machine-readable JSON envelope")
    .option("--no-color", "Disable ANSI terminal decoration")
    .addHelpText(
      "after",
      `
Safety:
  uninstall removes only the Chat Harness CLI and its install metadata.
  AGENTS.md, .chat-harness/, _inbox/, Workstreams, Workbench artifacts,
  domain/project files, and remote Workspace content are never removed.

  In non-interactive or --json use, pass --yes to authorize removal.

Examples:
  chat-harness uninstall
  chat-harness uninstall --yes
  chat-harness uninstall --yes --json
`,
    )
    .action(async (options: { yes?: boolean; json?: boolean }) => {
      selectedCommand = "uninstall";
      const installation = inspectCurrentInstallation(
        runtime.version,
        runtime.lifecycle,
      );
      const canMutate =
        installation.channel !== "unknown" &&
        !(
          installation.channel === "development" &&
          installation.provenance === "runtime"
        );

      if (!options.yes && canMutate) {
        if (runtime.isTTY && runtime.nativeTerminal && !options.json) {
          note(
            [
              "Chat Harness " + runtime.version,
              "Installation: " + installation.channel,
              "Path: " + installation.executablePath,
              "",
              "This removes the Chat Harness CLI only.",
              "Your Workspaces and project files will not be changed.",
            ].join("\n"),
            "Uninstall Chat Harness",
          );
          const answer = await confirm({
            message: "Uninstall Chat Harness?",
            initialValue: false,
          });
          if (isCancel(answer) || !answer) {
            const envelope = commandEnvelope({
              command: "uninstall",
              result: {
                state: "cancelled",
                current: runtime.version,
                channel: installation.channel,
                path: installation.executablePath,
              },
            });
            exitCode = writeEnvelope(envelope, false, color, runtime);
            return;
          }
        } else {
          const envelope = commandEnvelope({
            command: "uninstall",
            result: {
              state: "confirmation_required",
              current: runtime.version,
              channel: installation.channel,
              path: installation.executablePath,
            },
            findings: [{
              code: "lifecycle.confirmation_required",
              severity: "error",
              message: "Uninstall requires explicit confirmation in non-interactive mode.",
              remediation: "Run chat-harness uninstall --yes. Workspace data will not be changed.",
            }],
          });
          exitCode = writeEnvelope(
            envelope,
            Boolean(options.json),
            color,
            runtime,
          );
          return;
        }
      }

      const output = await runUninstall(
        runtime.version,
        { json: Boolean(options.json) },
        runtime.lifecycle,
      );
      const envelope = commandEnvelope({
        command: "uninstall",
        result: output.result,
        ...(output.findings ? { findings: output.findings } : {}),
      });
      exitCode = writeEnvelope(
        envelope,
        Boolean(options.json),
        color,
        runtime,
      );
    });

  const isWorkspaceCommand = (
    command: CommandName | undefined,
  ): command is WorkspaceCommandName =>
    command === "setup" || command === "validate" || command === "doctor";

  try {
    await program.parseAsync(["node", "chat-harness", ...argv]);
    if (selectedCommand === undefined && argv.length === 0) runtime.stdout(program.helpInformation());
    return exitCode;
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode === 0 ? EXIT_SUCCESS : EXIT_USAGE;
    if (error instanceof WorkspaceResolutionError && isWorkspaceCommand(selectedCommand)) {
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
        ...(isWorkspaceCommand(selectedCommand)
          ? { workspace: workspaceHint(selectedPath, runtime.cwd) }
          : {}),
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
if (
  process.env.CHAT_HARNESS_SUPPRESS_AUTO_RUN !== "1" &&
  isCliEntrypoint(import.meta.url, process.argv[1])
) {
  runCli(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch(() => { process.exitCode = EXIT_INTERNAL; });
}
