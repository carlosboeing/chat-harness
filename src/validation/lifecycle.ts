import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { Finding } from "../cli/result.js";
import { FrontmatterError, isIsoCalendarDate, parseMarkdownFrontmatter } from "./frontmatter.js";
import {
  formatSchemaErrors,
  validateLifecycleFrontmatter,
} from "./schema.js";

const FOLDER_TYPES: Record<string, ReadonlySet<string>> = {
  "0-brainstorms": new Set(["brainstorm"]),
  "1-discovery": new Set(["discovery"]),
  "2-design": new Set(["design"]),
  "3-plans": new Set(["plan"]),
  "4-reviews": new Set(["review", "retro", "audit"]),
};

export async function validateLifecycleFile(
  file: string,
  lifecycleRoot: string,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  let parsed;

  try {
    parsed = parseMarkdownFrontmatter(await readFile(file, "utf8"));
  } catch (error) {
    return [
      {
        code: "lifecycle.frontmatter_invalid",
        severity: "error",
        message:
          error instanceof FrontmatterError
            ? error.message
            : "Unable to parse lifecycle frontmatter.",
        location: file,
      },
    ];
  }

  if (!validateLifecycleFrontmatter(parsed.frontmatter)) {
    findings.push({
      code: "lifecycle.frontmatter_invalid",
      severity: "error",
      message: formatSchemaErrors(validateLifecycleFrontmatter.errors),
      location: file,
    });
  }

  if (!isIsoCalendarDate(parsed.frontmatter.created)) {
    findings.push({
      code: "lifecycle.frontmatter_invalid",
      severity: "error",
      message: "created must be a valid ISO calendar date (YYYY-MM-DD).",
      location: file,
    });
  }

  const relative = path.relative(lifecycleRoot, file);
  const folder = relative.split(path.sep)[0] ?? "";
  const allowed = FOLDER_TYPES[folder];
  if (
    typeof parsed.frontmatter.type === "string" &&
    (!allowed || !allowed.has(parsed.frontmatter.type))
  ) {
    findings.push({
      code: "lifecycle.folder_type_mismatch",
      severity: "error",
      message: `Lifecycle type ${String(parsed.frontmatter.type)} is not valid under ${folder || "lifecycle root"}.`,
      location: file,
    });
  }

  if (
    parsed.frontmatter.status === "superseded" &&
    typeof parsed.frontmatter.superseded_by === "string"
  ) {
    const successor = path.resolve(path.dirname(file), parsed.frontmatter.superseded_by);
    const successorRelative = path.relative(lifecycleRoot, successor);
    if (
      successorRelative === "" ||
      successorRelative.startsWith("..") ||
      path.isAbsolute(successorRelative)
    ) {
      findings.push({
        code: "lifecycle.supersession_invalid",
        severity: "error",
        message: "superseded_by must remain inside .chat-harness/lifecycle.",
        location: file,
      });
    } else {
      try {
        const info = await stat(successor);
        if (!info.isFile()) throw new Error("not-file");
        const nested = await validateLifecycleFile(successor, lifecycleRoot);
        if (nested.some((item) => item.severity === "error")) {
          findings.push({
            code: "lifecycle.supersession_invalid",
            severity: "error",
            message: "superseded_by target does not satisfy the lifecycle contract.",
            location: file,
          });
        }
      } catch {
        findings.push({
          code: "lifecycle.supersession_invalid",
          severity: "error",
          message: "superseded_by target does not exist as a valid lifecycle file.",
          location: file,
        });
      }
    }
  }

  return findings;
}
