import path from "node:path";
import { confirm, isCancel, select } from "@clack/prompts";

import { inspectWorkspace } from "../workspace/inspect.js";
import { inspectDomainScaffold } from "./plan.js";
import { AGENTS_TEMPLATE, isManagedAgentsSource, workspaceTemplate } from "./templates.js";
import {
  SPECIALIST_DOMAIN_DESCRIPTIONS,
  SPECIALIST_IDS,
  specialistDomainPaths,
  specialistLabel,
  specialistSummary,
  type SpecialistId,
} from "./specialists.js";

export interface InteractiveSetupRequest {
  specialist?: SpecialistId | undefined;
  scaffoldDomain: boolean;
  replaceAgents: boolean;
  replaceWorkspace: boolean;
}

export type InteractiveSetupResult =
  | { cancelled: true }
  | {
      cancelled: false;
      specialist: SpecialistId;
      scaffoldDomain: boolean;
      replaceAgents: boolean;
      replaceWorkspace: boolean;
    };

function workspaceName(workspace: string): string {
  return path.basename(workspace) || workspace;
}

function detectWorkspaceSpecialist(source: string): SpecialistId | null {
  const heading = source.match(/^# Workspace Instructions — (.+)$/m)?.[1]?.trim();
  if (!heading) return null;
  return (
    SPECIALIST_IDS.find(
      (id) => specialistLabel(id).toLocaleLowerCase() === heading.toLocaleLowerCase(),
    ) ?? null
  );
}

function writeIntroduction(
  workspace: string,
  existingWorkspace: boolean,
  write: (text: string) => void,
): void {
  const lines = existingWorkspace
    ? [
        "",
        "Chat Harness setup",
        "",
        "Chat Harness is already set up in this folder.",
        "I'll check that its working files are up to date and show you any changes",
        "before anything is modified.",
      ]
    : [
        "",
        "Chat Harness setup",
        "",
        "Chat Harness turns this folder into an ongoing Workspace for an AI assistant.",
        "It adds instructions and a small set of working files so the assistant can",
        "understand the Workspace, keep track of ongoing work, and continue it later.",
        "",
        "If you plan to use this Workspace with ChatGPT, keep it in Google Drive so",
        "ChatGPT can use the same up-to-date folder as a Project source.",
        "",
        "Your existing files will not be moved, renamed, or deleted.",
        "Nothing will change until you review and approve the setup.",
      ];

  write(
    [
      ...lines,
      "",
      "You're setting up:",
      `  ${workspaceName(workspace)}`,
      `  ${workspace}`,
      "",
    ].join("\n"),
  );
}

async function chooseSpecialist(): Promise<SpecialistId | null> {
  const value = await select({
    message: "What will you mainly use this Workspace for?",
    options: SPECIALIST_IDS.map((id) => ({
      value: id,
      label: `${specialistLabel(id)} — ${specialistSummary(id)}`,
    })),
    initialValue: "general",
  });
  return isCancel(value) ? null : (value as SpecialistId);
}

function domainIntro(id: SpecialistId): string {
  switch (id) {
    case "travel":
      return "Chat Harness can add a simple folder to help keep individual trips, itineraries, bookings, and travel research organized.";
    case "career":
      return "Chat Harness can add a simple folder structure to keep reusable career material separate from individual opportunities.";
    case "shopping":
      return "Chat Harness can add a simple folder structure to separate product research from purchase records.";
    case "research":
      return "Chat Harness can add a dedicated folder for substantial research and evidence.";
    case "tech":
      return "Chat Harness can add a dedicated folder for software and technical projects.";
    case "tax":
      return "Chat Harness can add a dedicated folder for tax records, research, and planning material.";
    case "finance":
      return "Chat Harness can add a dedicated folder for financial analysis, records, and planning material.";
    case "general":
      return "";
  }
}

async function resolveDomainScaffold(
  workspace: string,
  specialist: SpecialistId,
  requested: boolean,
  write: (text: string) => void,
): Promise<boolean | null> {
  if (requested) return true;

  const paths = specialistDomainPaths(specialist);
  if (paths.length === 0) return false;

  const observations = await inspectDomainScaffold(workspace, specialist);
  const collisions = observations.filter(
    (observation) =>
      observation.kind !== "missing" && observation.kind !== "directory",
  );

  write(
    [
      "",
      `Organizing your ${specialistLabel(specialist).toLocaleLowerCase()} work`,
      "",
      domainIntro(specialist),
      "",
      "These folders are optional. Chat Harness will still work if you prefer your",
      "existing folder structure.",
      "",
      `${workspaceName(workspace)}/`,
      ...observations.map((observation, index) => {
        const last = index === observations.length - 1;
        const status =
          observation.kind === "directory"
            ? "already there"
            : observation.kind === "missing"
              ? "new"
              : "name already in use";
        return `${last ? "└──" : "├──"} ${observation.path}/    ${status}`;
      }),
      "",
      ...paths.flatMap((domainPath) => {
        const description = SPECIALIST_DOMAIN_DESCRIPTIONS[specialist][domainPath];
        return description ? [`${domainPath}/`, `  ${description}`] : [];
      }),
      "",
    ].join("\n"),
  );

  if (collisions.length > 0) {
    write(
      [
        "I can't add the suggested folder structure because one or more names are",
        "already used by something that is not a folder. I'll keep your existing",
        "structure and continue with the core Chat Harness setup.",
        "",
      ].join("\n"),
    );
    return false;
  }

  if (observations.every((observation) => observation.kind === "directory")) {
    write(
      `The suggested ${specialistLabel(specialist).toLocaleLowerCase()} folder structure is already in place. No additional folders are needed.\n\n`,
    );
    return true;
  }

  const missingCount = observations.filter(
    (observation) => observation.kind === "missing",
  ).length;
  const answer = await confirm({
    message:
      missingCount === 1
        ? `Add the missing ${specialistLabel(specialist).toLocaleLowerCase()} folder?`
        : `Add the ${missingCount} missing ${specialistLabel(specialist).toLocaleLowerCase()} folders?`,
    initialValue: true,
  });
  return isCancel(answer) ? null : answer;
}

export async function resolveInteractiveSetup(
  workspace: string,
  request: InteractiveSetupRequest,
  write: (text: string) => void,
): Promise<InteractiveSetupResult> {
  const inspection = await inspectWorkspace(workspace);
  const workspaceFile = inspection.observations.find(
    (item) => item.path === ".chat-harness/WORKSPACE.md",
  );
  const existingWorkspace = workspaceFile?.kind === "file";

  writeIntroduction(workspace, existingWorkspace, write);

  const detectedSpecialist =
    workspaceFile?.kind === "file"
      ? detectWorkspaceSpecialist(workspaceFile.content ?? "")
      : null;

  let specialist: SpecialistId;
  if (request.specialist) {
    specialist = request.specialist;
    write(
      `${specialistLabel(specialist)} was selected from the command you ran.\n\n`,
    );
  } else if (existingWorkspace) {
    specialist = detectedSpecialist ?? "general";
  } else {
    const selected = await chooseSpecialist();
    if (selected === null) return { cancelled: true };
    specialist = selected;
  }

  const agents = inspection.observations.find((item) => item.path === "AGENTS.md");
  let replaceAgents = request.replaceAgents;
  if (
    agents?.kind === "file" &&
    !isManagedAgentsSource(agents.content ?? "") &&
    !replaceAgents
  ) {
    write(
      [
        "",
        "An existing AGENTS.md was found",
        "",
        "Chat Harness uses AGENTS.md for its main instructions to AI assistants.",
        "This file was not created by Chat Harness, so I won't replace it automatically.",
        "",
      ].join("\n"),
    );

    while (true) {
      const action = await select({
        message: "What would you like to do?",
        options: [
          {
            value: "cancel",
            label: "Stop setup and keep my existing AGENTS.md — safest option",
          },
          {
            value: "preview",
            label: "Preview the Chat Harness AGENTS.md",
          },
          {
            value: "replace",
            label: "Replace my existing AGENTS.md with the Chat Harness version",
          },
        ],
        initialValue: "cancel",
      });
      if (isCancel(action) || action === "cancel") return { cancelled: true };
      if (action === "preview") {
        write(
          `\n--- Chat Harness AGENTS.md preview ---\n${AGENTS_TEMPLATE}--- end preview ---\n\n`,
        );
        continue;
      }
      replaceAgents = true;
      break;
    }
  }

  let replaceWorkspace = request.replaceWorkspace;
  const explicitlyChangingSpecialist =
    request.specialist !== undefined &&
    existingWorkspace &&
    detectedSpecialist !== request.specialist;

  if (workspaceFile?.kind === "file" && explicitlyChangingSpecialist && !replaceWorkspace) {
    write(
      [
        "",
        "Existing Workspace instructions found",
        "",
        "This Workspace already has its own instructions. Chat Harness normally keeps",
        "them because they may contain information you've added over time.",
        "",
      ].join("\n"),
    );

    while (true) {
      const action = await select({
        message: "What would you like to do?",
        options: [
          {
            value: "keep",
            label: "Keep my existing Workspace instructions — recommended",
          },
          {
            value: "preview",
            label: `Preview the ${specialistLabel(specialist)} starter instructions`,
          },
          {
            value: "replace",
            label: `Replace them with the ${specialistLabel(specialist)} starter instructions`,
          },
          { value: "cancel", label: "Cancel setup" },
        ],
        initialValue: "keep",
      });
      if (isCancel(action) || action === "cancel") return { cancelled: true };
      if (action === "preview") {
        write(
          `\n--- ${specialistLabel(specialist)} WORKSPACE.md preview ---\n${workspaceTemplate(specialist)}--- end preview ---\n\n`,
        );
        continue;
      }
      replaceWorkspace = action === "replace";
      break;
    }
  }

  let scaffoldDomain = request.scaffoldDomain;
  const shouldOfferDomainScaffold =
    !existingWorkspace || request.specialist !== undefined || request.scaffoldDomain;

  if (shouldOfferDomainScaffold) {
    const resolvedDomain = await resolveDomainScaffold(
      workspace,
      specialist,
      scaffoldDomain,
      write,
    );
    if (resolvedDomain === null) return { cancelled: true };
    scaffoldDomain = resolvedDomain;
  }

  return {
    cancelled: false,
    specialist,
    scaffoldDomain,
    replaceAgents,
    replaceWorkspace,
  };
}
