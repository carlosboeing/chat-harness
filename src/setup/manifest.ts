import { createHash } from "node:crypto";
import YAML from "yaml";
import { assertCanonicalManagedPath } from "../workspace/managed-path-safety.js";
import { SPECIALISTS, selectSpecialists, isSpecialistId } from "../specialists/definitions.js";
import { CORE_VERSION } from "./templates.js";

/**
 * Schema 1 records only wholly managed Core and Specialist files.
 * WORKSPACE.md and its user suffix, Source Policy, and Workbench are excluded.
 * Pure data operations here NEVER inspect, overwrite, move, or remove files.
 */
export type ContentDigest = `sha256:${string}`;
export interface ManifestFile { digest: ContentDigest }
export interface ManifestComponent {
  version: number;
  files?: Record<string, ManifestFile>;
}
export interface WorkspaceManifest {
  schema: 1;
  harness: { version: string };
  core: { version: number; files: { "AGENTS.md": ManifestFile } };
  specialists: Record<string, ManifestComponent>;
}

export class ManifestContractError extends Error {
  constructor(message: string, readonly code: string = "setup.manifest_invalid") {
    super(message);
    this.name = "ManifestContractError";
  }
}
const manifestError = (message: string): never => { throw new ManifestContractError(message); };
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
function mapping(value: unknown, location: string): Record<string, unknown> {
  if (!object(value)) throw new ManifestContractError(location + " must be a mapping");
  return value;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const k of Object.keys(value)) {
    if (!allowed.includes(k)) manifestError("Unknown field at " + where + ": " + k);
  }
}
function version(value: unknown, where: string, maximum?: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) manifestError("Invalid version: " + where);
  const n = value as number;
  if (maximum !== undefined && n > maximum) throw new ManifestContractError("Newer-than-bundled component version: " + where, where === "core" ? "setup.core_version_too_new" : "setup.specialist_version_too_new");
  return n;
}
const DIGEST = /^sha256:[0-9a-f]{64}$/;
export function exactByteDigest(bytes: string | Uint8Array): ContentDigest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
function file(value: unknown, relative: string): ManifestFile {
  const rec = mapping(value, relative);
  keys(rec, ["digest"], relative);
  if (typeof rec.digest !== "string" || !DIGEST.test(rec.digest)) {
    manifestError("Malformed exact-byte SHA-256 digest: " + relative);
  }
  return { digest: rec.digest as ContentDigest };
}
function sorted<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}
function ownershipKey(path: string): string { return path.normalize("NFC").toLowerCase(); }

/**
 * Fail-closed structural validation. Does not grant ownership or validate
 * on-disk state; later preflight must inspect every actual managed path.
 */
export function validateManifest(value: unknown): WorkspaceManifest {
  const root = mapping(value, "manifest");
  keys(root, ["schema", "harness", "core", "specialists"], "manifest");
  if (root.schema !== 1) throw new ManifestContractError("Unsupported manifest schema", "setup.manifest_schema_unsupported");
  const harness = mapping(root.harness, "harness");
  keys(harness, ["version"], "harness");
  if (typeof harness.version !== "string" || !harness.version.trim() ||
      harness.version !== harness.version.trim()) throw new ManifestContractError("Invalid harness release version");

  const core = mapping(root.core, "core");
  keys(core, ["version", "files"], "core");
  const coreVersion = version(core.version, "core", CORE_VERSION);
  const coreFiles = mapping(core.files, "core.files");
  if (Object.keys(coreFiles).length !== 1 || !Object.hasOwn(coreFiles, "AGENTS.md")) {
    manifestError("Core schema 1 must own exactly AGENTS.md");
  }
  assertCanonicalManagedPath("AGENTS.md", "core");
  const ownedCore = file(coreFiles["AGENTS.md"], "AGENTS.md");

  const specialists = mapping(root.specialists, "specialists");
  const out: Record<string, ManifestComponent> = {};
  const owned = new Map<string, string>([[ownershipKey("AGENTS.md"), "core"]]);
  for (const id of Object.keys(specialists).sort()) {
    if (!isSpecialistId(id)) throw new ManifestContractError("Unknown installed Specialist ID: " + id,"setup.specialist_unknown");
    const record = mapping(specialists[id], "specialists." + id);
    keys(record, ["version", "files"], "specialists." + id);
    const installed = version(record.version, id, SPECIALISTS[id].version);
    const files: Record<string, ManifestFile> = {};
    if (record.files !== undefined) {
      const recorded = mapping(record.files, "specialists." + id + ".files");
      for (const path of Object.keys(recorded).sort()) {
        // Historical managed paths need not occur in the current bundle, but
        // must ALWAYS remain within the Specialist-owned procedures namespace.
        assertCanonicalManagedPath(path, "specialist");
        const key = ownershipKey(path);
        if (owned.has(key)) manifestError("Duplicate/aliased managed owner: " + path);
        owned.set(key, id);
        files[path] = file(recorded[path], path);
      }
    }
    out[id] = Object.keys(files).length ? { version: installed, files: sorted(files) }
      : { version: installed };
  }
  return {
    schema: 1,
    harness: { version: harness.version },
    core: { version: coreVersion, files: { "AGENTS.md": ownedCore } },
    specialists: sorted(out),
  };
}

/** YAML is untrusted input; reject parse errors, duplicate keys, and aliases. */
export function parseManifest(source: string): WorkspaceManifest {
  if (source.length > 1024 * 1024) manifestError("Manifest exceeds 1 MiB");
  let result: unknown;
  try {
    const document = YAML.parseDocument(source, { uniqueKeys: true, strict: true });
    if (document.errors.length > 0) manifestError("Malformed YAML manifest: " + document.errors[0]!.message);
    result = document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    if (error instanceof ManifestContractError) throw error;
    manifestError("Malformed YAML manifest: " + String(error));
  }
  return validateManifest(result);
}

/** Stable schema-1 ordering, with zero selected encoded as specialists: {}. */
export function serializeManifest(value: unknown): string {
  const manifest = validateManifest(value);
  return YAML.stringify(manifest, { lineWidth: 0 });
}

/** Desired bytes for a *future* safe transaction. Does not touch the disk. */
export function buildDesiredManifest(
  releaseVersion: string,
  coreContent: string,
  selectedIds: readonly string[],
): WorkspaceManifest {
  const specialists: Record<string, ManifestComponent> = {};
  for (const specialist of selectSpecialists(selectedIds)) {
    const paths: Record<string, ManifestFile> = {};
    for (const p of specialist.procedures ?? []) {
      assertCanonicalManagedPath(p.path, "specialist");
      if (Object.hasOwn(paths, p.path)) manifestError("Duplicate Specialist Procedure: " + p.path);
      paths[p.path] = { digest: exactByteDigest(p.content) };
    }
    specialists[specialist.id] = Object.keys(paths).length ?
      { version: specialist.version, files: sorted(paths) } : { version: specialist.version };
  }
  return validateManifest({
    schema: 1,
    harness: { version: releaseVersion },
    core: { version: CORE_VERSION, files: { "AGENTS.md": { digest: exactByteDigest(coreContent) } } },
    specialists,
  });
}

export type ProposedChange = {
  path: string;
  owner: string;
  action: "create" | "replace" | "remove" | "unchanged";
  beforeDigest?: ContentDigest;
  afterDigest?: ContentDigest;
};

/**
 * Pure comparison of recorded vs desired ownership. Does NOT prove current
 * bytes match beforeDigest, absence of collisions, or filesystem path safety.
 * A proposed 'remove' or 'replace' MUST NOT be executed from this output.
 */
export function previewManifestChanges(
  previous: WorkspaceManifest | null,
  desired: WorkspaceManifest,
): ProposedChange[] {
  const start = previous === null ? null : validateManifest(previous);
  const end = validateManifest(desired);
  function entries(manifest: WorkspaceManifest | null): Map<string, { owner: string; digest: ContentDigest }> {
    const result = new Map<string, { owner: string; digest: ContentDigest }>();
    if (!manifest) return result;
    result.set("AGENTS.md", { owner: "core", digest: manifest.core.files["AGENTS.md"].digest });
    for (const [id, definition] of Object.entries(manifest.specialists)) {
      for (const [path, meta] of Object.entries(definition.files ?? {}))
        result.set(path, { owner: id, digest: meta.digest });
    }
    return result;
  }
  const before = entries(start);
  const after = entries(end);
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  return paths.map(path => {
    const a = before.get(path), b = after.get(path);
    if (a && b && a.owner !== b.owner) manifestError("Managed owner changed for " + path);
    const base = { path, owner: (b ?? a)!.owner };
    if (!a) return { ...base, action: "create" as const, afterDigest: b!.digest };
    if (!b) return { ...base, action: "remove" as const, beforeDigest: a.digest };
    if (a.digest === b.digest) return { ...base, action: "unchanged" as const,
      beforeDigest: a.digest, afterDigest: b.digest };
    return { ...base, action: "replace" as const, beforeDigest: a.digest, afterDigest: b.digest };
  });
}
