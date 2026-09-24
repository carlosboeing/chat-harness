import type { SourcePolicyRule, SourcePrivacy } from "./types.js";

export interface ParsedPolicyPath {
  raw: string;
  kind: "exact" | "subtree";
  normalized: string;
}

export class SourcePolicyPathError extends Error {
  constructor(readonly value: string, message: string) {
    super(message);
    this.name = "SourcePolicyPathError";
  }
}

export function parsePolicyPath(value: string): ParsedPolicyPath {
  if (
    value.length === 0 ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.startsWith("/") ||
    /^[A-Za-z]:\//.test(value)
  ) {
    throw new SourcePolicyPathError(value, "Path must be a normalized Workspace-relative path.");
  }

  const subtree = value.endsWith("/**");
  const normalized = subtree ? value.slice(0, -3) : value;
  const segments = normalized.split("/");

  if (
    normalized.length === 0 ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..") ||
    normalized.includes("*") ||
    normalized.includes("?") ||
    normalized.includes("[") ||
    normalized.includes("]")
  ) {
    throw new SourcePolicyPathError(
      value,
      "Only exact paths or one trailing /** subtree selector are supported.",
    );
  }

  return {
    raw: value,
    kind: subtree ? "subtree" : "exact",
    normalized,
  };
}

export function normalizeSourcePath(value: string): string {
  const parsed = parsePolicyPath(value);
  if (parsed.kind !== "exact") {
    throw new SourcePolicyPathError(value, "Source path must be exact, not a selector.");
  }
  return parsed.normalized;
}

function applies(selector: ParsedPolicyPath, sourcePath: string): boolean {
  if (selector.kind === "exact") {
    return selector.normalized === sourcePath;
  }

  return (
    sourcePath === selector.normalized ||
    sourcePath.startsWith(`${selector.normalized}/`)
  );
}

interface Candidate {
  rule: SourcePolicyRule;
  parsed: ParsedPolicyPath;
}

export function matchPolicyRules(
  rules: readonly SourcePolicyRule[],
  sourcePath: string,
): {
  privacy?: SourcePrivacy;
  kind?: "exact" | "subtree";
  path?: string;
  conflict?: string;
} {
  const candidates: Candidate[] = [];
  for (const rule of rules) {
    const parsed = parsePolicyPath(rule.match.path);
    if (applies(parsed, sourcePath)) {
      candidates.push({ rule, parsed });
    }
  }

  if (candidates.length === 0) return {};

  const exact = candidates.filter((candidate) => candidate.parsed.kind === "exact");
  const pool = exact.length > 0 ? exact : candidates;
  const specificity = Math.max(
    ...pool.map((candidate) => candidate.parsed.normalized.length),
  );
  const best = pool.filter(
    (candidate) => candidate.parsed.normalized.length === specificity,
  );
  const privacyValues = new Set(best.map((candidate) => candidate.rule.privacy));

  if (privacyValues.size > 1) {
    return {
      conflict: `Conflicting equally specific Source Policy rules for ${sourcePath}.`,
    };
  }

  const selected = best[0]!;
  return {
    privacy: selected.rule.privacy,
    kind: selected.parsed.kind,
    path: selected.rule.match.path,
  };
}

export function findStaticRuleConflicts(
  rules: readonly SourcePolicyRule[],
): string[] {
  const seen = new Map<string, SourcePrivacy>();
  const conflicts: string[] = [];

  for (const rule of rules) {
    const parsed = parsePolicyPath(rule.match.path);
    const key = `${parsed.kind}:${parsed.normalized}`;
    const previous = seen.get(key);
    if (previous !== undefined && previous !== rule.privacy) {
      conflicts.push(rule.match.path);
    } else {
      seen.set(key, rule.privacy);
    }
  }

  return conflicts;
}
