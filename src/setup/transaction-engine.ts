/** Narrow schema-1 reconciliation executor. No legacy ownership inference. */
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import path from "node:path";
import { SOURCE_POLICY_TEMPLATE } from "./templates.js";
import { exactByteDigest, parseManifest, type ContentDigest } from "./manifest.js";
import { compileReadonlyTransactionIntent } from "./compile-transaction-intent.js";
import { assessManagedRecovery, journalSibling, validateManagedJournal, type ManagedTransactionJournal,
  type JournalMutation, type RecoveryObservation } from "./multifile-journal-contract.js";
import { expectedCompletionMarker, matchesCompletionMarker, serializeRecoveryRecord } from "./equal-digest-marker.js";
import { inspectAndPlanReadonlyReconciliation, type CombinedReadonlyPlan, type CombinedOperation } from "./readonly-reconcile-plan.js";
import { observeReadonlyManagedPath } from "./inspect-manifest-disk.js";
import { inspectManagedDestination, type ManagedFileOwner } from "../workspace/managed-path-safety.js";
import { acquireMacosWorkspaceLease, withMacosRootIdentity, verifiedMacosHelper, invokeMacosFilesystemOperation,
  invokeMacosSafeMove, invokeMacosSafeStage, reserveMacosReconciliationLock, retireMacosReconciliationLock, type MacosHelperRuntime } from "../workspace/macos-helper.js";

const MANIFEST = ".chat-harness/manifest.yaml", LOCK = ".chat-harness/temp/reconcile";
const JOURNAL = LOCK + "/journal.json", TOKEN = LOCK + "/commit.token";
const RETIRED = ".chat-harness/temp/reconcile-cleanup";
export class ReconciliationError extends Error {
  constructor(readonly code: "setup.stale_plan" | "setup.recovery_conflict" | "setup.verification_failed", message: string) {
    super(message); this.name = "ReconciliationError";
  }
}
const conflict = (message: string): never => {throw new ReconciliationError("setup.recovery_conflict",message);};
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
function owner(op: CombinedOperation): ManagedFileOwner {
  return op.owner === "manifest" || op.owner === "workspace" ? "workspace" :
    op.owner === "core" ? "core" : op.owner === "scaffold" ? "scaffold" : "specialist";
}
function raw(digest: ContentDigest): string {return digest.slice(7);}
function native(workspace: string, relative: string, operation: "mkdir"|"rmdir"|"verify"|"discard", digest?: ContentDigest, runtime?: MacosHelperRuntime): void {
  invokeMacosFilesystemOperation(operation,workspace,relative,digest ? raw(digest) : undefined,runtime);
}
function move(workspace: string, from: string, to: string, digest: ContentDigest, runtime?: MacosHelperRuntime): void {
  if (path.posix.dirname(from) !== path.posix.dirname(to)) conflict("Transaction move is not between siblings");
  invokeMacosSafeMove({operation:"move",workspace,parent:path.posix.dirname(from),source:path.posix.basename(from),destination:path.posix.basename(to),digest:raw(digest)},runtime);
}
function stage(workspace: string, relative: string, bytes: string, runtime?: MacosHelperRuntime): void {
  invokeMacosSafeStage({workspace,parent:path.posix.dirname(relative),destination:path.posix.basename(relative),
    digest:raw(exactByteDigest(bytes)),content:Buffer.from(bytes)},runtime);
}

/** Only generated siblings of validated canonical paths may reach this reader. */
async function artifact(workspace: string, relative: string, canonical: string, fileOwner: ManagedFileOwner): Promise<Buffer|null> {
  await inspectManagedDestination(workspace,canonical,fileOwner);
  const parent = path.join(workspace,path.posix.dirname(relative));
  let entries: string[];
  try {entries = await readdir(parent);} catch(error) {if(missing(error))return null;throw error;}
  const leaf = path.posix.basename(relative);
  if (entries.some(name=>name !== leaf && name.normalize("NFC").toLowerCase() === leaf.toLowerCase())) conflict("Aliased transaction artifact: "+relative);
  const absolute = path.join(workspace,relative);
  let handle;
  try {handle = await open(absolute,constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);} catch(error) {if(missing(error))return null;throw error;}
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > 16*1024*1024) conflict("Unsafe transaction artifact: "+relative);
    const bytes = await handle.readFile(), after = await handle.stat(), named = await lstat(absolute);
    if (!named.isFile() || before.dev !== after.dev || before.ino !== after.ino ||
      after.dev !== named.dev || after.ino !== named.ino || before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || bytes.length > 16*1024*1024) conflict("Changing transaction artifact: "+relative);
    await inspectManagedDestination(workspace,canonical,fileOwner);
    return bytes;
  } finally {await handle.close();}
}
async function digest(workspace: string, relative: string, fileOwner: ManagedFileOwner): Promise<ContentDigest|null> {
  const entry = await observeReadonlyManagedPath(workspace,relative,fileOwner);
  if(entry.kind === "missing")return null;
  if(entry.kind !== "file" || !entry.bytes)conflict("Unsafe canonical file: "+relative);
  return exactByteDigest(entry.bytes!);
}
async function artifactDigest(workspace: string, relative: string|null, op: {path:string;owner:ManagedFileOwner}): Promise<ContentDigest|null> {
  if(!relative)return null;
  const bytes = await artifact(workspace,relative,op.path,op.owner);
  return bytes ? exactByteDigest(bytes) : null;
}
async function requireState(plan: CombinedReadonlyPlan, bootstrapped: Set<string>): Promise<void> {
  for(const op of plan.operations) {
    const entry = await observeReadonlyManagedPath(plan.workspace,op.path,owner(op));
    const expected = op.expected;
    const valid = expected.kind === "absent" ? entry.kind === "missing" || (bootstrapped.has(op.path) && entry.kind === "directory") :
      expected.kind === "existing_directory" ? entry.kind === "directory" :
      expected.kind === "existing_file" ? entry.kind === "file" :
      entry.kind === "file" && !!entry.bytes && exactByteDigest(entry.bytes) === expected.digest;
    if(!valid)throw new ReconciliationError("setup.stale_plan","Precondition changed: "+op.path);
  }
}
async function verifyOutputs(plan: CombinedReadonlyPlan, includeManifest: boolean, runtime?: MacosHelperRuntime): Promise<void> {
  for(const op of plan.operations) {
    if(op.path === MANIFEST && !includeManifest)continue;
    if(op.action === "remove_file") {
      if(await digest(plan.workspace,op.path,owner(op)) !== null)conflict("Removed file reappeared: "+op.path);
    } else if(op.afterDigest) {
      await inspectManagedDestination(plan.workspace,op.path,owner(op));
      native(plan.workspace,op.path,"verify",op.afterDigest,runtime);
    } else {
      const entry = await observeReadonlyManagedPath(plan.workspace,op.path,owner(op));
      if(entry.kind !== (op.expected.kind === "existing_file" ? "file" : "directory"))conflict("Scaffold changed: "+op.path);
    }
  }
}
async function verifyCommittedManifest(workspace: string, expected: ContentDigest, runtime?: MacosHelperRuntime): Promise<void> {
  const file = await observeReadonlyManagedPath(workspace,MANIFEST,"workspace");
  if(!file.bytes || exactByteDigest(file.bytes) !== expected)conflict("Committed manifest changed");
  const parsed = parseManifest(file.bytes!.toString("utf8"));
  const owned = [{path:"AGENTS.md",owner:"core" as ManagedFileOwner,digest:parsed.core.files["AGENTS.md"].digest},
    ...Object.values(parsed.specialists).flatMap(spec=>Object.entries(spec.files??{}).map(([p,f])=>({path:p,owner:"specialist" as ManagedFileOwner,digest:f.digest})))];
  for(const f of owned) {
    await inspectManagedDestination(workspace,f.path,f.owner);
    native(workspace,f.path,"verify",f.digest,runtime);
  }
}

async function applyMutation(workspace: string, op: JournalMutation, runtime?: MacosHelperRuntime): Promise<void> {
  if(await digest(workspace,op.path,op.owner) !== op.before)throw new ReconciliationError("setup.stale_plan","File changed: "+op.path);
  if(op.backup) {
    if(await artifactDigest(workspace,op.backup,op) !== null)conflict("Backup occupied: "+op.path);
    move(workspace,op.path,op.backup,op.before!,runtime);
    native(workspace,op.backup,"verify",op.before!,runtime);
  }
  if(op.stage) {
    try {move(workspace,op.stage,op.path,op.after!,runtime);}
    catch(error) {
      if(op.backup) {try {move(workspace,op.backup,op.path,op.before!,runtime);} catch { /* Preserve both copies; recovery will diagnose. */ }}
      throw error;
    }
    native(workspace,op.path,"verify",op.after!,runtime);
  }
}

async function observeRecovery(workspace: string, journal: ManagedTransactionJournal): Promise<RecoveryObservation> {
  const token = await artifact(workspace,TOKEN,TOKEN,"transaction");
  const operations = [];
  for(const op of journal.operations)operations.push({path:op.path,
    canonical:await digest(workspace,op.path,op.owner),stage:await artifactDigest(workspace,op.stage,op),backup:await artifactDigest(workspace,op.backup,op)});
  const manifest = {path:MANIFEST,owner:"workspace" as const};
  const manifestStage = await artifactDigest(workspace,journalSibling(MANIFEST,"stage",journal.transactionId),manifest);
  if(manifestStage !== null && manifestStage !== journal.targetManifest)conflict("Manifest stage changed");
  const tokenStage = await artifact(workspace,journalSibling(TOKEN,"stage",journal.transactionId),TOKEN,"transaction");
  if(tokenStage && !matchesCompletionMarker(tokenStage,journal))conflict("Completion stage changed");
  return {canonicalManifest:await digest(workspace,MANIFEST,"workspace"),
    manifestBackup:await artifactDigest(workspace,journalSibling(MANIFEST,"backup",journal.transactionId),manifest),
    equalManifestCommit:token ? matchesCompletionMarker(token,journal)?"verified":"unsafe" : "absent",operations};
}
async function discardIfPresent(workspace: string, relative: string|null, expected: ContentDigest|null, canonical: string, fileOwner: ManagedFileOwner, runtime?: MacosHelperRuntime): Promise<void> {
  if(!relative)return;
  const bytes = await artifact(workspace,relative,canonical,fileOwner);
  if(!bytes)return;
  if(expected === null || exactByteDigest(bytes) !== expected)conflict("Cleanup artifact changed: "+relative);
  native(workspace,relative,"discard",expected!,runtime);
}
async function cleanup(workspace: string, journal: ManagedTransactionJournal, runtime?: MacosHelperRuntime): Promise<void> {
  for(const op of journal.operations) {
    await discardIfPresent(workspace,op.stage,op.after,op.path,op.owner,runtime);
    await discardIfPresent(workspace,op.backup,op.before,op.path,op.owner,runtime);
  }
  await discardIfPresent(workspace,journalSibling(".chat-harness/source-policy.yaml","stage",journal.transactionId),exactByteDigest(SOURCE_POLICY_TEMPLATE),".chat-harness/source-policy.yaml","scaffold",runtime);
  await discardIfPresent(workspace,journalSibling(MANIFEST,"stage",journal.transactionId),journal.targetManifest,MANIFEST,"workspace",runtime);
  await discardIfPresent(workspace,journalSibling(MANIFEST,"backup",journal.transactionId),journal.startingManifest,MANIFEST,"workspace",runtime);
  const tokenDigest = journal.startingManifest === journal.targetManifest && journal.operations.length
    ? exactByteDigest(expectedCompletionMarker(journal)) : null;
  await discardIfPresent(workspace,journalSibling(TOKEN,"stage",journal.transactionId),tokenDigest,TOKEN,"transaction",runtime);
  // Retirement is atomic commit/rollback completion evidence. The active
  // reservation stays intact until every canonical state and sidecar is settled.
  retireMacosReconciliationLock(workspace,runtime);
  await cleanupRetired(workspace,journal,runtime);

}
async function cleanupRetired(workspace: string, journal: ManagedTransactionJournal, runtime?: MacosHelperRuntime): Promise<void> {
  const token = RETIRED+"/commit.token", record = RETIRED+"/journal.json";
  const tokenDigest = journal.startingManifest === journal.targetManifest && journal.operations.length
    ? exactByteDigest(expectedCompletionMarker(journal)) : null;
  await discardIfPresent(workspace,token,tokenDigest,token,"transaction",runtime);
  await discardIfPresent(workspace,record,exactByteDigest(serializeRecoveryRecord(journal)),record,"transaction",runtime);
  native(workspace,RETIRED,"rmdir",undefined,runtime);
}
async function recoverRetired(workspace: string, runtime?: MacosHelperRuntime): Promise<"rolled_back"|"committed"|"cleaned"> {
  const names = await readdir(path.join(workspace,RETIRED));
  // Only a retired reservation can reach this terminal empty state; an active
  // empty reservation never gets this treatment. rmdir cannot delete content.
  if(names.length === 0){native(workspace,RETIRED,"rmdir",undefined,runtime);return "cleaned";}
  if(names.some(n=>n!=="journal.json" && n!=="commit.token"))conflict("Unknown retired transaction evidence");
  const record = RETIRED+"/journal.json";
  const bytes=await artifact(workspace,record,record,"transaction");
  if(!bytes || bytes.length > 64*1024)conflict("Invalid retired journal");
  const j=validateManagedJournal(JSON.parse(bytes!.toString("utf8")));
  if(!bytes!.equals(Buffer.from(serializeRecoveryRecord(j))))conflict("Noncanonical retired journal");
  const tokenPath=RETIRED+"/commit.token";
  const token=await artifact(workspace,tokenPath,tokenPath,"transaction");
  if(token && !matchesCompletionMarker(token,j))conflict("Invalid retired completion token");
  const manifest=await digest(workspace,MANIFEST,"workspace");
  const states=await Promise.all(j.operations.map(op=>digest(workspace,op.path,op.owner)));
  const after=manifest === j.targetManifest && states.every((s,i)=>s===j.operations[i]!.after);
  const before=manifest === j.startingManifest && states.every((s,i)=>s===j.operations[i]!.before);
  if(!after && !before)conflict("Retired transaction has changed canonical outputs");
  if(token && !after)conflict("Retired completion token contradicts canonical outputs");
  if(after)await verifyCommittedManifest(workspace,j.targetManifest,runtime);
  await cleanupRetired(workspace,j,runtime);
  return after?"committed":"rolled_back";
}
async function recoverLocked(workspace: string, runtime?: MacosHelperRuntime): Promise<"absent"|"rolled_back"|"committed"|"cleaned"> {
  const lock = await observeReadonlyManagedPath(workspace,LOCK,"transaction");
  const retired=await observeReadonlyManagedPath(workspace,RETIRED,"transaction");
  if(retired.kind !== "missing") {
    if(retired.kind !== "directory" || lock.kind !== "missing")conflict("Ambiguous active/retired transaction state");
    return recoverRetired(workspace,runtime);
  }
  if(lock.kind === "missing")return "absent";
  if(lock.kind !== "directory")conflict("Unsafe transaction reservation");
  const bytes = await artifact(workspace,JOURNAL,JOURNAL,"transaction");
  if(!bytes || bytes.length > 64*1024)conflict("Missing, incomplete or oversized transaction journal");
  let journal: ManagedTransactionJournal;
  try {journal = validateManagedJournal(JSON.parse(bytes!.toString("utf8")));} catch(error){return conflict("Invalid transaction journal: "+String(error));}
  if(!bytes!.equals(Buffer.from(serializeRecoveryRecord(journal))))conflict("Noncanonical transaction journal");
  const entries = await readdir(path.join(workspace,LOCK));
  const allowed = ["journal.json","commit.token",path.posix.basename(journalSibling(TOKEN,"stage",journal.transactionId))];
  if(entries.some(e=>!allowed.includes(e)))conflict("Unknown transaction evidence");
  const policyStage = await artifact(workspace,journalSibling(".chat-harness/source-policy.yaml","stage",journal.transactionId),".chat-harness/source-policy.yaml","scaffold");
  if(policyStage && exactByteDigest(policyStage) !== exactByteDigest(SOURCE_POLICY_TEMPLATE))conflict("Additive Source Policy stage is incomplete or changed; preserve evidence");
  const observed = await observeRecovery(workspace,journal);
  const assessment = assessManagedRecovery(journal,observed);
  if(assessment.decision === "conflict")conflict(assessment.conflicts.join("; "));
  if(assessment.decision === "committed") {
    await verifyCommittedManifest(workspace,journal.targetManifest,runtime);
  } else {
    for(const op of [...journal.operations].reverse()) {
      // Observe again immediately before every rollback; no third state can
      // authorize removal. Move the after file back to its recorded stage,
      // never unlink a canonical path to make room for a backup.
      const current = await digest(workspace,op.path,op.owner);
      const backup = await artifactDigest(workspace,op.backup,op);
      if(current === op.before && backup === null)continue;
      if(current !== null && current !== op.after)conflict("Rollback canonical changed: "+op.path);
      if(current === op.after && current !== null) {
        if(await artifactDigest(workspace,op.stage,op) !== null)conflict("Rollback stage occupied: "+op.path);
        move(workspace,op.path,op.stage!,op.after!,runtime);
      }
      if(op.before !== null) {
        if(backup !== op.before)conflict("Rollback backup changed: "+op.path);
        move(workspace,op.backup!,op.path,op.before,runtime);
      }
      if(await digest(workspace,op.path,op.owner) !== op.before)conflict("Rollback verification failed: "+op.path);
    }
    if(observed.canonicalManifest === null && journal.startingManifest !== null)
      move(workspace,journalSibling(MANIFEST,"backup",journal.transactionId),MANIFEST,journal.startingManifest,runtime);
    if(await digest(workspace,MANIFEST,"workspace") !== journal.startingManifest)conflict("Old manifest not restored");
  }
  await cleanup(workspace,journal,runtime);
  return assessment.decision === "committed" ? "committed" : "rolled_back";
}

export async function recoverManagedReconciliation(workspace: string, runtime?: MacosHelperRuntime): Promise<"absent"|"rolled_back"|"committed"|"cleaned"> {
  verifiedMacosHelper(runtime); // Fail before acquiring or changing anything.
  const lease = await acquireMacosWorkspaceLease(workspace,runtime);
  try {
    const base={...withMacosRootIdentity(lease.identity,runtime),leasePid:lease.pid};
    const temp=await observeReadonlyManagedPath(workspace,".chat-harness/temp","scaffold");
    return await recoverLocked(workspace,temp.kind === "directory" ? {...base,tempIdentity:await lease.pin()}:base);
  } finally {await lease.release();}
}

export async function executeManagedReconciliation(plan: CombinedReadonlyPlan, runtime?: MacosHelperRuntime): Promise<{committed:true;cleanupPending:boolean}> {
  verifiedMacosHelper(runtime);
  if(!plan.safeToPresent || !plan.request || plan.findings.some(f=>f.severity === "error"))throw new ReconciliationError("setup.stale_plan","Conflicted plan cannot execute");
  // Recompute semantic ownership and desired bytes rather than trust a supplied
  // plan object. Lock-time exact observations below then close the TOCTOU gap.
  const manifestOp = plan.operations.at(-1);
  if(!manifestOp || !manifestOp.content && manifestOp.action !== "unchanged")throw new ReconciliationError("setup.stale_plan","Incomplete manifest operation");
  const releaseVersion = manifestOp.content ? parseManifest(manifestOp.content).harness.version :
    parseManifest((await observeReadonlyManagedPath(plan.workspace,MANIFEST,"workspace")).bytes!.toString("utf8")).harness.version;
  const fresh = await inspectAndPlanReadonlyReconciliation(plan.workspace,{specialists:plan.request.desiredSpecialists.join(",") || "none",
    scaffoldDomain:plan.request.scaffoldDomain,adoptWorkspace:plan.request.adoptWorkspace,replaceAgents:plan.request.replaceAgents},releaseVersion);
  if(!fresh.safeToPresent || JSON.stringify(fresh.operations) !== JSON.stringify(plan.operations))throw new ReconciliationError("setup.stale_plan","Semantic plan changed before reservation");
  const intent = compileReadonlyTransactionIntent(plan,randomBytes(16).toString("hex"));
  if(Buffer.byteLength(serializeRecoveryRecord(intent.journal),"utf8") > 64*1024)throw new ReconciliationError("setup.stale_plan","Transaction journal exceeds the bounded 64 KiB contract");
  const lease = await acquireMacosWorkspaceLease(plan.workspace,runtime);
  runtime = {...withMacosRootIdentity(lease.identity,runtime),leasePid:lease.pid};
  const bootstrapped = new Set<string>();
  try {
    // Fresh install bootstrap is additive, descriptor-anchored and authorized.
    for(const p of [".chat-harness",".chat-harness/temp"]) {
      const entry = await observeReadonlyManagedPath(plan.workspace,p,"scaffold");
      if(entry.kind === "missing") {native(plan.workspace,p,"mkdir",undefined,runtime);bootstrapped.add(p);}
      else if(entry.kind !== "directory")conflict("Unsafe bootstrap path: "+p);
    }
    runtime={...runtime,tempIdentity:await lease.pin()};
    reserveMacosReconciliationLock(plan.workspace,runtime);
    stage(plan.workspace,JOURNAL,serializeRecoveryRecord(intent.journal),runtime);
    await requireState(plan,bootstrapped);
    for(const op of plan.operations) {
      if(op.action === "create_directory" && !bootstrapped.has(op.path)) {
        await inspectManagedDestination(plan.workspace,op.path,"scaffold"); native(plan.workspace,op.path,"mkdir",undefined,runtime);
      }
      if(op.owner === "scaffold" && op.action === "create_file") {
        await inspectManagedDestination(plan.workspace,op.path,"scaffold");
        const stagedPolicy=journalSibling(op.path,"stage",intent.journal.transactionId);
        stage(plan.workspace,stagedPolicy,op.content!,runtime);
        move(plan.workspace,stagedPolicy,op.path,op.afterDigest!,runtime);
      }
    }
    for(const s of intent.stages)stage(plan.workspace,s.path,s.content,runtime);
    // Recheck the entire managed before-set after staging, including unchanged
    // managed files, consent-bound Workspace bytes and manifest ownership.
    for(const op of plan.operations.filter(o=>o.owner !== "scaffold")) {
      const actual = await digest(plan.workspace,op.path,owner(op));
      const expected = op.expected.kind === "exact_file" ? op.expected.digest : null;
      if(actual !== expected)throw new ReconciliationError("setup.stale_plan","Post-staging precondition changed: "+op.path);
    }
    for(const op of intent.journal.operations)await applyMutation(plan.workspace,op,runtime);
    await verifyOutputs(plan,false,runtime);
    const j = intent.journal;
    if(j.startingManifest !== j.targetManifest) {
      const manifestMutation: JournalMutation = {path:MANIFEST,owner:"workspace",action:j.startingManifest?"replace":"create",
        before:j.startingManifest,after:j.targetManifest,stage:journalSibling(MANIFEST,"stage",j.transactionId),
        backup:j.startingManifest?journalSibling(MANIFEST,"backup",j.transactionId):null};
      await applyMutation(plan.workspace,manifestMutation,runtime);
    } else if(intent.commitTokenRequired) {
      const tokenStage = journalSibling(TOKEN,"stage",j.transactionId);
      stage(plan.workspace,tokenStage,expectedCompletionMarker(j),runtime);
      move(plan.workspace,tokenStage,TOKEN,exactByteDigest(expectedCompletionMarker(j)),runtime);
    }
    await verifyOutputs(plan,true,runtime);
    try {await cleanup(plan.workspace,j,runtime);return {committed:true,cleanupPending:false};}
    catch {return {committed:true,cleanupPending:true};}
  } catch(error) {
    // Never guess away an incomplete journal/stage or a third state. Verified
    // rollback is attempted; an unprovable state remains intact for diagnosis.
    try {await recoverLocked(plan.workspace,runtime);} catch(recovery) {
      throw new ReconciliationError("setup.recovery_conflict",String(error)+"; "+String(recovery));
    }
    throw error;
  } finally {await lease.release();}
}
