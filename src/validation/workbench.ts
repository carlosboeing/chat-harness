import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Finding } from "../cli/result.js";
import {
  FrontmatterError,
  isIsoCalendarDate,
  parseMarkdownFrontmatter,
} from "./frontmatter.js";
import { parseMarkdownStructure } from "./markdown-structure.js";
import { formatSchemaErrors, validateWorkbenchFrontmatter } from "./schema.js";
import { validateWorkstreamFile } from "./workstream.js";

export type WorkbenchArtifactType =
  | "idea"
  | "research"
  | "decision"
  | "plan"
  | "review";

export interface WorkbenchValidationOptions {
  workbenchRoot: string;
  workstreamsRoot: string;
  expectedType: WorkbenchArtifactType;
}

function finding(code: string, message: string, location: string): Finding {
  return { code, severity: "error", message, location };
}

function referencedPath(root: string, file: string, raw: string): string | null {
  const resolved = path.resolve(path.dirname(file), raw);
  const relative = path.relative(root, resolved);
  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    path.extname(resolved) !== ".md"
  ) {
    return null;
  }
  return resolved;
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

export async function validateWorkbenchFile(
  file: string,
  options: WorkbenchValidationOptions,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  let parsed;
  try {
    parsed = parseMarkdownFrontmatter(await readFile(file, "utf8"));
  } catch (error) {
    return [
      finding(
        "workbench.frontmatter_invalid",
        error instanceof FrontmatterError
          ? error.message
          : "Unable to parse Workbench frontmatter.",
        file,
      ),
    ];
  }

  if (!validateWorkbenchFrontmatter(parsed.frontmatter)) {
    findings.push(
      finding(
        "workbench.frontmatter_invalid",
        formatSchemaErrors(validateWorkbenchFrontmatter.errors),
        file,
      ),
    );
  }

  const created = parsed.frontmatter.created;
  const updated = parsed.frontmatter.updated;
  const createdValid = isIsoCalendarDate(created);
  const updatedValid = isIsoCalendarDate(updated);
  if (!createdValid) {
    findings.push(
      finding(
        "workbench.frontmatter_invalid",
        "created must be a valid ISO calendar date (YYYY-MM-DD).",
        file,
      ),
    );
  }
  if (!updatedValid) {
    findings.push(
      finding(
        "workbench.frontmatter_invalid",
        "updated must be a valid ISO calendar date (YYYY-MM-DD).",
        file,
      ),
    );
  }
  if (createdValid && updatedValid && updated < created) {
    findings.push(
      finding(
        "workbench.frontmatter_invalid",
        "updated must not be earlier than created.",
        file,
      ),
    );
  }

  if (parsed.frontmatter.type !== options.expectedType) {
    findings.push(
      finding(
        "workbench.type_mismatch",
        `Workbench artifact in this folder must use type: ${options.expectedType}.`,
        file,
      ),
    );
  }

  const structure = parseMarkdownStructure(parsed.body);
  if (structure.h1.length !== 1) {
    findings.push(
      finding(
        "workbench.heading_invalid",
        "Workbench artifact must contain exactly one H1 heading.",
        file,
      ),
    );
  }

  const workstream = parsed.frontmatter.workstream;
  if (typeof workstream === "string") {
    const target = referencedPath(options.workstreamsRoot, file, workstream);
    if (target === null || !(await isFile(target))) {
      findings.push(
        finding(
          "workbench.workstream_invalid",
          "workstream must reference an existing .md file inside .chat-harness/workstreams.",
          file,
        ),
      );
    } else {
      const nested = await validateWorkstreamFile(target, {
        workstreamsRoot: options.workstreamsRoot,
      });
      if (nested.some((item) => item.severity === "error")) {
        findings.push(
          finding(
            "workbench.workstream_invalid",
            "Referenced Workstream does not satisfy the Workstream contract.",
            file,
          ),
        );
      }
    }
  }

  for (const field of ["supersedes", "superseded_by"] as const) {
    const raw = parsed.frontmatter[field];
    if (typeof raw !== "string") continue;
    const target = referencedPath(options.workbenchRoot, file, raw);
    if (target === null || !(await isFile(target))) {
      findings.push(
        finding(
          "workbench.supersession_invalid",
          `${field} must reference an existing .md file inside .chat-harness/workbench.`,
          file,
        ),
      );
    }
  }

  return findings;
}
