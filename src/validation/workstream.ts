import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Finding } from "../cli/result.js";
import { FrontmatterError, isIsoCalendarDate, parseMarkdownFrontmatter } from "./frontmatter.js";
import { parseMarkdownStructure } from "./markdown-structure.js";
import { formatSchemaErrors, validateWorkstreamFrontmatter } from "./schema.js";

export interface WorkstreamValidationOptions { workstreamsRoot: string; visited?: Set<string>; }
function finding(code:string,message:string,location:string,remediation?:string): Finding {
  return { code, severity:"error", message, location, ...(remediation ? {remediation}: {}) };
}
function successorPath(root:string,current:string,raw:string): string | null {
  const resolved=path.resolve(path.dirname(current),raw);
  const relative=path.relative(root,resolved);
  return relative === "" || relative.startsWith("..") || path.isAbsolute(relative) ? null : resolved;
}

export async function validateWorkstreamFile(file:string, options:WorkstreamValidationOptions): Promise<Finding[]> {
  const findings: Finding[] = [];
  let parsed;
  try { parsed=parseMarkdownFrontmatter(await readFile(file,"utf8")); }
  catch(error) { return [finding("workstream.frontmatter_invalid", error instanceof FrontmatterError ? error.message : "Unable to parse workstream frontmatter.", file)]; }

  if (!validateWorkstreamFrontmatter(parsed.frontmatter)) findings.push(finding("workstream.frontmatter_invalid",formatSchemaErrors(validateWorkstreamFrontmatter.errors),file));
  if (!isIsoCalendarDate(parsed.frontmatter.created)) findings.push(finding("workstream.frontmatter_invalid","created must be a valid ISO calendar date (YYYY-MM-DD).",file));

  const structure=parseMarkdownStructure(parsed.body);
  if (structure.h1.length !== 1) findings.push(finding("workstream.heading_invalid","Workstream must contain exactly one H1 heading.",file));
  for (const section of ["Objective","Current direction"] as const) {
    if (!(structure.sections.get(section)?.trim())) findings.push(finding("workstream.heading_invalid",`Workstream requires a non-empty exact H2 section: ${section}.`,file));
  }
  if (parsed.frontmatter.status === "active" && !(structure.sections.get("Next action")?.trim())) findings.push(finding("workstream.next_action_missing","Active workstream requires a non-empty exact H2 section: Next action.",file));

  if (parsed.frontmatter.status === "superseded" && typeof parsed.frontmatter.superseded_by === "string") {
    const successor=successorPath(options.workstreamsRoot,file,parsed.frontmatter.superseded_by);
    if (successor === null) findings.push(finding("workstream.supersession_invalid","superseded_by must resolve to a workstream inside .chat-harness/workstreams.",file));
    else {
      try {
        const info=await stat(successor); if(!info.isFile()) throw new Error("not-file");
        const visited=options.visited ?? new Set<string>();
        if (!visited.has(successor)) {
          visited.add(file);
          const nested=await validateWorkstreamFile(successor,{workstreamsRoot:options.workstreamsRoot,visited});
          if(nested.some((item)=>item.severity==="error")) findings.push(finding("workstream.supersession_invalid","superseded_by target does not satisfy the Workstream contract.",file));
        }
      } catch { findings.push(finding("workstream.supersession_invalid","superseded_by target does not exist as a valid workstream file.",file)); }
    }
  }
  return findings;
}
