import { readFile } from "node:fs/promises";
import type { Finding } from "../cli/result.js";
import {
  FrontmatterError,
  isIsoCalendarDate,
  parseMarkdownFrontmatter,
} from "./frontmatter.js";
import { parseMarkdownStructure } from "./markdown-structure.js";
import { formatSchemaErrors, validateWorkstreamFrontmatter } from "./schema.js";

export interface WorkstreamValidationOptions {
  workstreamsRoot: string;
}

function finding(code: string, message: string, location: string): Finding {
  return { code, severity: "error", message, location };
}

export async function validateWorkstreamFile(
  file: string,
  _options: WorkstreamValidationOptions,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  let parsed;
  try {
    parsed = parseMarkdownFrontmatter(await readFile(file, "utf8"));
  } catch (error) {
    return [
      finding(
        "workstream.frontmatter_invalid",
        error instanceof FrontmatterError
          ? error.message
          : "Unable to parse workstream frontmatter.",
        file,
      ),
    ];
  }

  if (!validateWorkstreamFrontmatter(parsed.frontmatter)) {
    findings.push(
      finding(
        "workstream.frontmatter_invalid",
        formatSchemaErrors(validateWorkstreamFrontmatter.errors),
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
        "workstream.frontmatter_invalid",
        "created must be a valid ISO calendar date (YYYY-MM-DD).",
        file,
      ),
    );
  }
  if (!updatedValid) {
    findings.push(
      finding(
        "workstream.frontmatter_invalid",
        "updated must be a valid ISO calendar date (YYYY-MM-DD).",
        file,
      ),
    );
  }
  if (createdValid && updatedValid && updated < created) {
    findings.push(
      finding(
        "workstream.frontmatter_invalid",
        "updated must not be earlier than created.",
        file,
      ),
    );
  }

  const structure = parseMarkdownStructure(parsed.body);
  if (structure.h1.length !== 1) {
    findings.push(
      finding(
        "workstream.heading_invalid",
        "Workstream must contain exactly one H1 heading.",
        file,
      ),
    );
  }

  for (const section of ["Objective", "Current direction"] as const) {
    if (!(structure.sections.get(section)?.trim())) {
      findings.push(
        finding(
          "workstream.heading_invalid",
          `Workstream requires a non-empty exact H2 section: ${section}.`,
          file,
        ),
      );
    }
  }

  if (
    parsed.frontmatter.status === "active" &&
    !(structure.sections.get("Next action")?.trim())
  ) {
    findings.push(
      finding(
        "workstream.next_action_missing",
        "Active workstream requires a non-empty exact H2 section: Next action.",
        file,
      ),
    );
  }

  return findings;
}
