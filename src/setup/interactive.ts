import { confirm, isCancel, select } from "@clack/prompts";

import { inspectWorkspace } from "../workspace/inspect.js";
import { isManagedAgentsSource, workspaceTemplate } from "./templates.js";
import {
  SPECIALIST_IDS,
  specialistDomainPaths,
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

async function chooseSpecialist(): Promise<SpecialistId | null> {
  const value = await select({
    message: "Choose a Workspace specialist",
    options: SPECIALIST_IDS.map((id) => ({
      value: id,
      label: id,
    })),
    initialValue: "general",
  });
  return isCancel(value) ? null : (value as SpecialistId);
}

export async function resolveInteractiveSetup(
  workspace: string,
  request: InteractiveSetupRequest,
  write: (text: string) => void,
): Promise<InteractiveSetupResult> {
  const specialist = request.specialist ?? (await chooseSpecialist());
  if (specialist === null) return { cancelled: true };

  const inspection = await inspectWorkspace(workspace);
  const agents = inspection.observations.find((item) => item.path === "AGENTS.md");
  let replaceAgents = request.replaceAgents;
  if (
    agents?.kind === "file" &&
    !isManagedAgentsSource(agents.content ?? "") &&
    !replaceAgents
  ) {
    const action = await select({
      message:
        "Existing AGENTS.md is not Chat Harness-managed. Setup will not adopt it silently.",
      options: [
        { value: "cancel", label: "Cancel (safe default)" },
        { value: "replace", label: "Replace and let Chat Harness own AGENTS.md" },
      ],
      initialValue: "cancel",
    });
    if (isCancel(action) || action === "cancel") return { cancelled: true };
    replaceAgents = true;
  }

  const workspaceFile = inspection.observations.find(
    (item) => item.path === ".chat-harness/WORKSPACE.md",
  );
  let replaceWorkspace = request.replaceWorkspace;
  if (workspaceFile?.kind === "file" && !replaceWorkspace) {
    while (true) {
      const action = await select({
        message: "WORKSPACE.md already exists. What should setup do?",
        options: [
          { value: "keep", label: "Keep existing (safe default)" },
          { value: "replace", label: `Replace with the ${specialist} specialist seed` },
          { value: "preview", label: "Preview the selected specialist seed" },
          { value: "cancel", label: "Cancel setup" },
        ],
        initialValue: "keep",
      });
      if (isCancel(action) || action === "cancel") return { cancelled: true };
      if (action === "preview") {
        write(`\n--- ${specialist} WORKSPACE.md preview ---\n${workspaceTemplate(specialist)}--- end preview ---\n\n`);
        continue;
      }
      replaceWorkspace = action === "replace";
      break;
    }
  }

  let scaffoldDomain = request.scaffoldDomain;
  if (!scaffoldDomain && specialistDomainPaths(specialist).length > 0) {
    const answer = await confirm({
      message:
        `Create the suggested ${specialist} domain folder structure? Only missing exact paths are created.`,
      initialValue: false,
    });
    if (isCancel(answer)) return { cancelled: true };
    scaffoldDomain = answer;
  }

  return {
    cancelled: false,
    specialist,
    scaffoldDomain,
    replaceAgents,
    replaceWorkspace,
  };
}
