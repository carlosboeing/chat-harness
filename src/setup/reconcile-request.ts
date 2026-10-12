import { selectSpecialists, type SpecialistId } from "../specialists/definitions.js";
import { validateManifest, type WorkspaceManifest } from "./manifest.js";

/** Exact desired installation state; no CLI or wizard syntax survives resolution. */
export interface ReconcileRequest {
  desiredSpecialists: readonly SpecialistId[];
  scaffoldDomain: boolean;
  adoptWorkspace: boolean;
  replaceAgents: boolean;
}

export interface ReconcileSelectionOptions {
  /** Omitted preserves installed selection; explicit "none" removes all. */
  specialists?: string;
  scaffoldDomain?: boolean;
  adoptWorkspace?: boolean;
  replaceAgents?: boolean;
}

/** Parse a comma-separated exact set; whitespace is okay, empty items aren't. */
export function parseSpecialistSelection(value: string): SpecialistId[] {
  if (value.trim() === "none") return [];
  const names = value.split(",").map(s => s.trim());
  if (names.length === 0 || names.some(s => !s || s === "none")) {
    throw new Error("An exact Specialist selection must list IDs or use 'none' alone.");
  }
  return selectSpecialists([...new Set(names)]).map(s => s.id);
}

/**
 * Pure resolution for non-interactive setup:
 * fresh without selection => zero Specialists;
 * existing manifest without selection => preserve installed exact set.
 * Interactive wizard preselection is handled at its UI boundary, not here.
 */
export function resolveReconcileRequest(
  options: ReconcileSelectionOptions,
  recorded: WorkspaceManifest | null,
): ReconcileRequest {
  const previous = recorded === null ? null : validateManifest(recorded);
  const desiredSpecialists = options.specialists === undefined
    ? selectSpecialists(Object.keys(previous?.specialists ?? {})).map(s => s.id)
    : parseSpecialistSelection(options.specialists);
  return {
    desiredSpecialists: Object.freeze(desiredSpecialists),
    scaffoldDomain: options.scaffoldDomain === true,
    adoptWorkspace: options.adoptWorkspace === true,
    replaceAgents: options.replaceAgents === true,
  };
}
