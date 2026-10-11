import { SPECIALIST_ASSETS } from "./embedded-assets.js";
import { composeWorkspaceManagedPrefix, type WorkspaceSpecialistSection } from "../setup/workspace-boundary.js";

export const SPECIALIST_IDS = [
  "business", "career", "dev", "education", "finance", "health",
  "home", "legal", "shopping", "tax", "tech", "travel",
] as const;
export type SpecialistId = (typeof SPECIALIST_IDS)[number];

export interface ManagedProcedureDefinition {
  path: string;
  content: string;
}

export interface SpecialistDefinition {
  id: SpecialistId;
  version: number;
  label: string;
  summary: string;
  workspaceFragment: string;
  procedures?: readonly ManagedProcedureDefinition[];
  capabilities?: {
    required?: readonly string[];
    recommended?: readonly string[];
  };
  scaffold?: readonly string[];
}

function fragment(id: SpecialistId): string {
  const value = SPECIALIST_ASSETS[`${id}/workspace.md`];
  if (!value) throw new Error(`Missing embedded Specialist guidance: ${id}`);
  return value;
}

function procedure(name: string): ManagedProcedureDefinition {
  const source = SPECIALIST_ASSETS[`shopping/procedures/${name}`];
  if (!source) throw new Error(`Missing embedded Shopping Procedure: ${name}`);
  return { path: `.chat-harness/procedures/${name}`, content: source };
}

/**
 * Versioned first-party domain bundles. General/mixed-use is the empty set;
 * research is cross-cutting Core methodology, not a managed Specialist.
 * This registry is not wired into the existing v0.3.7 setup CLI.
 */
export const SPECIALISTS: Readonly<Record<SpecialistId, SpecialistDefinition>> = {
  business: { id: "business", version: 1, label: "Business & Entrepreneurship",
    summary: "Business models, validation, customers, positioning and go-to-market", workspaceFragment: fragment("business") },
  career: { id: "career", version: 1, label: "Career",
    summary: "Career positioning, opportunities and evidence-backed applications", workspaceFragment: fragment("career"),
    capabilities: { recommended: ["linkedin.job.lookup"] }, scaffold: ["Opportunities", "Profile"] },
  dev: { id: "dev", version: 1, label: "Software Development",
    summary: "Software architecture, coding, quality, CI/CD and agentic engineering", workspaceFragment: fragment("dev"),
    scaffold: ["Projects"] },
  education: { id: "education", version: 1, label: "Education & Learning",
    summary: "Learning, teaching, curriculum, accessibility and assessment", workspaceFragment: fragment("education") },
  finance: { id: "finance", version: 1, label: "Finance",
    summary: "Financial decisions, fees, scenarios, risk and investments", workspaceFragment: fragment("finance"),
    scaffold: ["Finance"] },
  health: { id: "health", version: 1, label: "Health",
    summary: "Health evidence, records, options and clinical uncertainty", workspaceFragment: fragment("health") },
  home: { id: "home", version: 1, label: "Home & Property",
    summary: "Property maintenance, gardens, improvements and safe DIY", workspaceFragment: fragment("home") },
  legal: { id: "legal", version: 1, label: "Legal",
    summary: "Legal research, jurisdiction, documentation and deadlines", workspaceFragment: fragment("legal") },
  shopping: { id: "shopping", version: 1, label: "Shopping",
    summary: "Buyer-fit, product comparisons, dependable net cost and deals", workspaceFragment: fragment("shopping"),
    procedures: [
      procedure("deal-discovery-and-channel-optimization.md"),
      procedure("shopping-research-methodology.md"),
    ], scaffold: ["Purchases", "Research"] },
  tax: { id: "tax", version: 1, label: "Tax",
    summary: "Tax authority, treatment, ownership and recordkeeping", workspaceFragment: fragment("tax"),
    scaffold: ["Tax"] },
  tech: { id: "tech", version: 1, label: "Technology & IT",
    summary: "Choose, configure and troubleshoot devices, networks and technology", workspaceFragment: fragment("tech") },
  travel: { id: "travel", version: 1, label: "Travel",
    summary: "Itineraries, bookings, transit, entry rules and realistic logistics", workspaceFragment: fragment("travel"),
    scaffold: ["Trips"] },
};

export function isSpecialistId(value: string): value is SpecialistId {
  return Object.hasOwn(SPECIALISTS, value);
}

/** Exact desired-set semantics, no compatibility mappings or invented default. */
export function selectSpecialists(ids: readonly string[]): SpecialistDefinition[] {
  const seen = new Set<string>();
  for (const id of ids) {
    if (!isSpecialistId(id)) throw new Error(`Unknown Specialist ID: ${id}`);
    if (seen.has(id)) throw new Error(`Duplicate Specialist ID: ${id}`);
    seen.add(id);
  }
  return [...seen].sort().map(id => SPECIALISTS[id as SpecialistId]);
}

export function specialistSections(ids: readonly string[]): WorkspaceSpecialistSection[] {
  return selectSpecialists(ids).map(definition => ({
    id: definition.id,
    label: definition.label,
    guidance: definition.workspaceFragment,
  }));
}

export function composeSpecialistWorkspace(ids: readonly string[]): string {
  return composeWorkspaceManagedPrefix(specialistSections(ids));
}

const PROCEDURE_PREFIX = ".chat-harness/procedures/";
const PROCEDURE_MARKER = "<!-- chat-harness-managed: procedure -->\n";
const validNames = (s: string) => /^[a-z][a-z0-9.-]*$/.test(s);
const validScaffold = (s: string) => /^(?!\.|\/)[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(s) && !s.endsWith(" ");

export function validateSpecialistRegistry(
  definitions: readonly SpecialistDefinition[] = SPECIALIST_IDS.map(id => SPECIALISTS[id]),
): string[] {
  const findings: string[] = [];
  const ids = new Set<string>();
  const paths = new Map<string, string>();
  for (const item of definitions) {
    if (!SPECIALIST_IDS.includes(item.id)) findings.push(`Unknown Specialist: ${item.id}`);
    if (ids.has(item.id)) findings.push(`Duplicate Specialist: ${item.id}`);
    ids.add(item.id);
    if (!Number.isSafeInteger(item.version) || item.version < 1) findings.push(`Invalid version: ${item.id}`);
    if (!item.label.trim() || !item.summary.trim() || !item.workspaceFragment.trim()) findings.push(`Missing guidance: ${item.id}`);
    if (item.workspaceFragment.includes("<!-- chat-harness-user: workspace -->")) findings.push(`User marker in managed guidance: ${item.id}`);
    if (item.workspaceFragment.includes("<!-- chat-harness-managed: workspace -->")) findings.push(`Workspace marker in guidance: ${item.id}`);
    for (const proc of item.procedures ?? []) {
      if (!proc.path.startsWith(PROCEDURE_PREFIX) || !validNames(proc.path.slice(PROCEDURE_PREFIX.length)) ||
          !proc.path.endsWith(".md")) findings.push(`Invalid Procedure destination: ${proc.path}`);
      const key = proc.path.normalize("NFC").toLowerCase();
      if (paths.has(key)) findings.push(`Duplicate Procedure destination: ${proc.path} (${paths.get(key)})`);
      paths.set(key, item.id);
      if (!proc.content.startsWith(PROCEDURE_MARKER)) findings.push(`Missing Procedure marker: ${proc.path}`);
    }
    const scaffold = new Set<string>();
    for (const name of item.scaffold ?? []) {
      if (!validScaffold(name)) findings.push(`Invalid scaffold path: ${item.id}/${name}`);
      const key = name.normalize("NFC").toLowerCase();
      if (scaffold.has(key)) findings.push(`Duplicate scaffold path: ${item.id}/${name}`);
      scaffold.add(key);
    }
    for (const capability of [...(item.capabilities?.required ?? []), ...(item.capabilities?.recommended ?? [])]) {
      if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/.test(capability)) findings.push(`Invalid capability ID: ${item.id}/${capability}`);
    }
  }
  return findings.sort();
}
