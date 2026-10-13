/**
 * Test-only, intentionally single-Procedure journal roundtrip. NEVER imported
 * from CLI/setup, never pointed at an existing user Workspace.
 * Validates the Design's manifest-last interruption logic on temporary dirs.
 */
import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, lstat, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { exactByteDigest, parseManifest, serializeManifest } from "../../src/setup/manifest.js";
import { CORE_VERSION } from "../../src/setup/templates.js";

const native = process.env.GATE0_SPIKE_NATIVE;
if (!["darwin","linux"].includes(process.platform) || !native) {
  throw new Error("POSIX-only test: compile the native helper and set GATE0_SPIKE_NATIVE");
}

const PARENT = ".chat-harness/procedures";
const NAME = "shopping-research-methodology.md";
const FILE = `${PARENT}/${NAME}`;
const STAGE = `.${NAME}.chat-harness-stage-spike`;
const BACKUP = `.${NAME}.chat-harness-backup-spike`;
const HELD = `.${NAME}.chat-harness-intervening-spike`;
const MANIFEST_STAGE = ".manifest.yaml.chat-harness-stage-spike";
const MANIFEST_BACKUP = ".manifest.yaml.chat-harness-backup-spike";
const TX = ".chat-harness/temp/reconcile";
const OLD = "<!-- chat-harness-managed: procedure -->\nOld managed content\n";
const NEW = "<!-- chat-harness-managed: procedure -->\nNew managed content\n";
const BEFORE = exactByteDigest(OLD);
const AFTER = exactByteDigest(NEW);
const digestHex = (d: string) => d.slice(7);
const rootOf = (root: string, filename: string) => path.join(root, filename);
const transactionPath = (root: string) => rootOf(root, `${TX}/journal.json`);
const roots: string[] = [];

function manifest(version: string, digest: string): string {
  return serializeManifest({
    schema: 1,
    harness: { version },
    core: { version: CORE_VERSION, files: {
      "AGENTS.md": { digest: exactByteDigest("unchanged fixture AGENTS") },
    } },
    specialists: { shopping: { version: 1, files: { [FILE]: { digest } } } },
  });
}
const OLD_MANIFEST = manifest("0.3.7", BEFORE);
const NEW_MANIFEST = manifest("0.3.8", AFTER);
type Journal = {
  schema: 1;
  transactionId: "spike";
  procedurePath: typeof FILE;
  before: string;
  after: string;
  beforeManifest: string;
  afterManifest: string;
};
const JOURNAL: Journal = {
  schema: 1, transactionId: "spike", procedurePath: FILE,
  before: BEFORE, after: AFTER,
  beforeManifest: exactByteDigest(OLD_MANIFEST),
  afterManifest: exactByteDigest(NEW_MANIFEST),
};

async function digestAt(root: string, relative: string): Promise<string | null> {
  const filename = rootOf(root, relative);
  try {
    const stat = await lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Untrusted file type at " + relative);
    return exactByteDigest(await readFile(filename));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function nativeMove(root: string, command: "move" | "promote" | "restore",
                    parent: string, from: string, to: string, digest: string): void {
  execFileSync(native!, [command, root, parent, from, to, digestHex(digest)],
    { stdio: ["ignore", "pipe", "pipe"] });
}
async function readJournal(root: string): Promise<Journal> {
  const value: unknown = JSON.parse(await readFile(transactionPath(root), "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      JSON.stringify(value) !== JSON.stringify(JOURNAL)) {
    throw new Error("Unrecognized or modified transaction journal");
  }
  return value as Journal;
}

async function fixture(): Promise<string> {
  const temporary = await mkdtemp(path.join(tmpdir(), "chat-harness-gate0-spike-"));
  roots.push(temporary);
  const root = await realpath(temporary); // canonicalize macOS /var -> /private/var
  await mkdir(rootOf(root, PARENT), { recursive: true });
  await mkdir(rootOf(root, ".chat-harness/temp"), { recursive: true });
  await writeFile(rootOf(root, FILE), OLD, { flag: "wx" });
  await writeFile(rootOf(root, ".chat-harness/manifest.yaml"), OLD_MANIFEST, { flag: "wx" });
  await mkdir(rootOf(root, TX)); // exclusive lock: never re-enter an existing transaction
  await writeFile(rootOf(root, `${PARENT}/${STAGE}`), NEW, { flag: "wx" });
  await writeFile(rootOf(root, `.chat-harness/${MANIFEST_STAGE}`), NEW_MANIFEST, { flag: "wx" });
  await writeFile(transactionPath(root), JSON.stringify(JOURNAL) + "\n", { flag: "wx" });
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

/** Simulate process death at a boundary by leaving journal/backups untouched. */
type StopAt = "after-file-backup" | "after-file-promotion" | "after-manifest-backup" | "after-commit";
async function apply(root: string, stop?: StopAt): Promise<void> {
  await readJournal(root);
  if (await digestAt(root, FILE) !== BEFORE ||
      await digestAt(root, ".chat-harness/manifest.yaml") !== JOURNAL.beforeManifest ||
      await digestAt(root, `${PARENT}/${STAGE}`) !== AFTER ||
      await digestAt(root, `.chat-harness/${MANIFEST_STAGE}`) !== JOURNAL.afterManifest) {
    throw new Error("Stale transaction precondition");
  }
  nativeMove(root, "move", PARENT, NAME, BACKUP, BEFORE);
  if (stop === "after-file-backup") return;
  nativeMove(root, "promote", PARENT, STAGE, NAME, AFTER);
  if (await digestAt(root, FILE) !== AFTER) throw new Error("Promoted Procedure changed");
  if (stop === "after-file-promotion") return;
  nativeMove(root, "move", ".chat-harness", "manifest.yaml", MANIFEST_BACKUP, JOURNAL.beforeManifest);
  if (stop === "after-manifest-backup") return;
  nativeMove(root, "promote", ".chat-harness", MANIFEST_STAGE, "manifest.yaml", JOURNAL.afterManifest);
  if (await digestAt(root, ".chat-harness/manifest.yaml") !== JOURNAL.afterManifest ||
      await digestAt(root, FILE) !== AFTER) throw new Error("Commit readback conflict");
  if (stop === "after-commit") return;
}

/**
 * Recovery does not delete anything: it preserves held forward bytes and stages.
 * Commit detection uses the exact canonical target manifest digest, never a
 * journal phase flag. Unknown states stop BEFORE attempting any mutation.
 */
async function recover(root: string): Promise<"rolled-back" | "committed"> {
  const journal = await readJournal(root);
  const [current, backup, manifestCurrent, manifestBackup] = await Promise.all([
    digestAt(root, FILE), digestAt(root, `${PARENT}/${BACKUP}`),
    digestAt(root, ".chat-harness/manifest.yaml"),
    digestAt(root, `.chat-harness/${MANIFEST_BACKUP}`),
  ]);
  if (manifestCurrent === journal.afterManifest) {
    if (current !== journal.after || backup !== journal.before) {
      throw new Error("Committed transaction has unexpected managed content");
    }
    const parsed = parseManifest(await readFile(rootOf(root, ".chat-harness/manifest.yaml"), "utf8"));
    if (parsed.specialists.shopping?.files?.[FILE]?.digest !== AFTER) {
      throw new Error("Committed manifest ownership mismatch");
    }
    return "committed"; // retained backup/journal; no cleanup proof yet
  }
  const allowedManifest = (manifestCurrent === journal.beforeManifest && manifestBackup === null) ||
    (manifestCurrent === null && manifestBackup === journal.beforeManifest);
  const allowedProcedure = (current === journal.before && backup === null) ||
    (current === null && backup === journal.before) ||
    (current === journal.after && backup === journal.before);
  if (!allowedManifest || !allowedProcedure) {
    throw new Error("Recovery conflict: unknown before/after state; preserve all files");
  }
  if (current === journal.after) {
    // Preserve after bytes instead of deleting, then restore only to an ABSENT name.
    nativeMove(root, "move", PARENT, NAME, HELD, journal.after);
  }
  if (backup === journal.before) {
    nativeMove(root, "restore", PARENT, BACKUP, NAME, journal.before);
  }
  if (manifestCurrent === null) {
    nativeMove(root, "restore", ".chat-harness", MANIFEST_BACKUP, "manifest.yaml", journal.beforeManifest);
  }
  if (await digestAt(root, FILE) !== journal.before ||
      await digestAt(root, ".chat-harness/manifest.yaml") !== journal.beforeManifest) {
    throw new Error("Rollback readback failed");
  }
  return "rolled-back";
}

test("normal single-Procedure upgrade commits manifest last; repeat recovery is read-only", async () => {
  const root = await fixture();
  await apply(root);
  expect(await recover(root)).toBe("committed");
  expect(await recover(root)).toBe("committed");
  expect(await digestAt(root, FILE)).toBe(AFTER);
  expect(await digestAt(root, ".chat-harness/manifest.yaml")).toBe(JOURNAL.afterManifest);
  expect(await digestAt(root, `${PARENT}/${BACKUP}`)).toBe(BEFORE);
});

for (const stop of ["after-file-backup", "after-file-promotion", "after-manifest-backup"] as const) {
  test(`journal-guided recovery rolls back interrupted ${stop} without clobber`, async () => {
    const root = await fixture();
    await apply(root, stop);
    expect(await recover(root)).toBe("rolled-back");
    expect(await recover(root)).toBe("rolled-back");
    expect(await digestAt(root, FILE)).toBe(BEFORE);
    expect(await digestAt(root, ".chat-harness/manifest.yaml")).toBe(JOURNAL.beforeManifest);
    expect(await readFile(transactionPath(root), "utf8")).toContain('"transactionId":"spike"');
  });
}

test("post-commit recovery completes forward, never rolls back", async () => {
  const root = await fixture();
  await apply(root, "after-commit");
  expect(await recover(root)).toBe("committed");
  expect(await digestAt(root, FILE)).toBe(AFTER);
});

test("unknown third-state canonical preserves evidence instead of overwriting", async () => {
  const root = await fixture();
  await apply(root, "after-file-backup");
  await writeFile(rootOf(root, FILE), "user change", { flag: "wx" });
  await expect(recover(root)).rejects.toThrow("Recovery conflict");
  expect(await readFile(rootOf(root, FILE), "utf8")).toBe("user change");
  expect(await digestAt(root, `${PARENT}/${BACKUP}`)).toBe(BEFORE);
});

test("tampered journal or drifted canonical blocks apply/recovery", async () => {
  const root = await fixture();
  await writeFile(transactionPath(root), JSON.stringify({ schema: 1 }), { flag: "w" });
  await expect(recover(root)).rejects.toThrow("journal");
  await writeFile(transactionPath(root), JSON.stringify(JOURNAL), { flag: "w" });
  await writeFile(rootOf(root, FILE), "user edit", { flag: "w" });
  await expect(apply(root)).rejects.toThrow("Stale transaction precondition");
  expect(await readFile(rootOf(root, FILE), "utf8")).toBe("user edit");
});
