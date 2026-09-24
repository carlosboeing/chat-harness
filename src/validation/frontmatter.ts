import { parseDocument } from "yaml";

export interface ParsedMarkdown {
  frontmatter: Record<string, unknown>;
  body: string;
}

export class FrontmatterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrontmatterError";
  }
}

export function parseMarkdownFrontmatter(source: string): ParsedMarkdown {
  const normalized = source.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) {
    throw new FrontmatterError("Markdown frontmatter is required.");
  }

  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) {
    throw new FrontmatterError("Markdown frontmatter closing delimiter is missing.");
  }

  const yamlSource = normalized.slice(4, end);
  const document = parseDocument(yamlSource, {
    uniqueKeys: true,
    strict: true,
  });

  if (document.errors.length > 0) {
    throw new FrontmatterError(
      document.errors.map((error) => error.message).join("; "),
    );
  }

  const value = document.toJS();
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new FrontmatterError("Markdown frontmatter must be a mapping.");
  }

  return {
    frontmatter: value as Record<string, unknown>,
    body: normalized.slice(end + 5),
  };
}

export function isIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
