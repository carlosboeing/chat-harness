export interface MarkdownStructure {
  h1: string[];
  sections: Map<string, string>;
}

function fenceMarker(line: string): string | null {
  const match = line.match(/^\s*((?:\x60){3,}|~{3,})/);
  return match?.[1]?.[0] ?? null;
}

export function parseMarkdownStructure(body: string): MarkdownStructure {
  const lines = body.replaceAll("\r\n", "\n").split("\n");
  const h1: string[] = [];
  const sections = new Map<string, string>();
  let activeSection: string | null = null;
  let activeLines: string[] = [];
  let fence: string | null = null;

  const flush = (): void => {
    if (activeSection !== null) {
      sections.set(activeSection, activeLines.join("\n").trim());
    }
    activeSection = null;
    activeLines = [];
  };

  for (const line of lines) {
    const marker = fenceMarker(line);
    if (marker !== null) {
      if (fence === null) {
        fence = marker;
      } else if (marker === fence) {
        fence = null;
      }
      if (activeSection !== null) activeLines.push(line);
      continue;
    }

    if (fence !== null) {
      if (activeSection !== null) activeLines.push(line);
      continue;
    }

    const h1Match = line.match(/^# ([^#].*)$/);
    if (h1Match?.[1]) {
      h1.push(h1Match[1].trim());
      if (activeSection !== null) activeLines.push(line);
      continue;
    }

    const h2Match = line.match(/^## ([^#].*)$/);
    if (h2Match?.[1]) {
      flush();
      activeSection = h2Match[1].trim();
      continue;
    }

    if (activeSection !== null) activeLines.push(line);
  }

  flush();
  return { h1, sections };
}
