import { describe, expect, test } from "bun:test";
import {
  assessManagedRecovery, journalSibling, validateManagedJournal,
  type ManagedTransactionJournal, type RecoveryObservation,
} from "../../src/setup/multifile-journal-contract.js";
import { exactByteDigest } from "../../src/setup/manifest.js";

const sha = (name: string) => exactByteDigest(name);
const id = "1234567890abcdef";
const proc = ".chat-harness/procedures/shopping.md";
const work = ".chat-harness/WORKSPACE.md";
const file = "AGENTS.md";
const oldManifest = sha("old manifest");
const newManifest = sha("new manifest");
const journal: ManagedTransactionJournal = {
  schema: 1, transactionId: id, startingManifest: oldManifest, targetManifest: newManifest,
  operations: [
    {
      path: proc, owner: "specialist", action: "remove", before: sha("old procedure"), after: null,
      stage: null, backup: journalSibling(proc,"backup",id),
    },
    {
      path: work, owner: "workspace", action: "replace", before: sha("old workspace"), after: sha("new workspace"),
      stage: journalSibling(work,"stage",id), backup: journalSibling(work,"backup",id),
    },
    {
      path: file, owner: "core", action: "create", before: null, after: sha("new AGENTS"),
      stage: journalSibling(file,"stage",id), backup: null,
    },
  ],
};
function snapshot(
  canonicalManifest: RecoveryObservation["canonicalManifest"] = oldManifest,
): RecoveryObservation {
  return {
    canonicalManifest, manifestBackup: null, equalManifestCommit: "absent",
    operations: [
      { path: proc, canonical: sha("old procedure"), stage: null, backup: null },
      { path: work, canonical: sha("old workspace"), stage: sha("new workspace"), backup: null },
      { path: file, canonical: null, stage: sha("new AGENTS"), backup: null },
    ],
  };
}

describe("multi-file journal proof and recovery classification (no I/O)",()=>{
  test("valid journal has lexical destinations and tightly named sibling artifacts",()=>{
    const result = validateManagedJournal(journal);
    expect(result.operations.map(x=>x.path)).toEqual([proc,work,file]);
    expect(result.operations[1]?.stage).toBe(".chat-harness/.WORKSPACE.md.chat-harness-stage-"+id);
    expect(assessManagedRecovery(journal,snapshot())).toMatchObject({
      decision:"rollback",executable:false,conflicts:[],
    });
  });
  test("uncommitted multi-file partial states are individually proven before rollback",()=>{
    const now=snapshot();
    now.operations[0]!.canonical=null;
    now.operations[0]!.backup=sha("old procedure");
    now.operations[1]!.canonical=sha("new workspace");
    now.operations[1]!.backup=sha("old workspace");
    now.operations[1]!.stage=null;
    now.operations[2]!.canonical=sha("new AGENTS");
    now.operations[2]!.stage=null;
    const result=assessManagedRecovery(journal,now);
    expect(result.decision).toBe("rollback");
    expect(result.files.map(x=>x.state)).toEqual(["backed_up","after","after"]);
  });
  test("new manifest proves commit only if EVERY output and backup is consistent",()=>{
    const now=snapshot(newManifest);
    now.manifestBackup=oldManifest;
    now.operations[0]!.canonical=null;
    now.operations[0]!.backup=sha("old procedure");
    now.operations[1]!.canonical=sha("new workspace");
    now.operations[1]!.backup=sha("old workspace");
    now.operations[1]!.stage=null;
    now.operations[2]!.canonical=sha("new AGENTS");
    now.operations[2]!.stage=null;
    expect(assessManagedRecovery(journal,now).decision).toBe("committed");
    now.operations[2]!.canonical=sha("intervening user edit");
    expect(assessManagedRecovery(journal,now).decision).toBe("conflict");
  });
  test("third-state paths and poisoned backup stop ALL recovery decisions",()=>{
    const now=snapshot();
    now.operations[1]!.canonical=sha("unknown");
    expect(assessManagedRecovery(journal,now)).toMatchObject({decision:"conflict",executable:false});
    now.operations[1]!.canonical=sha("old workspace");
    now.operations[1]!.backup=sha("bad backup");
    expect(assessManagedRecovery(journal,now).decision).toBe("conflict");
  });
  test("same-manifest-digest changes require independently verified atomic commit token",()=>{
    const same={...journal,startingManifest:oldManifest,targetManifest:oldManifest};
    const before=snapshot();
    before.operations[0]!.canonical=null;
    before.operations[0]!.backup=sha("old procedure");
    before.operations[1]!.canonical=sha("new workspace");
    before.operations[1]!.backup=sha("old workspace");
    before.operations[2]!.canonical=sha("new AGENTS");
    expect(assessManagedRecovery(same,before).decision).toBe("rollback");
    before.equalManifestCommit="verified";
    expect(assessManagedRecovery(same,before).decision).toBe("committed");
    before.equalManifestCommit="unsafe";
    expect(assessManagedRecovery(same,before).decision).toBe("conflict");
  });
  test("invalid journal schema, stage aliases, owner paths and duplicate paths are rejected",()=>{
    expect(()=>validateManagedJournal({...journal,schema:2})).toThrow();
    expect(()=>validateManagedJournal({...journal,transactionId:"../../bad"})).toThrow();
    expect(()=>validateManagedJournal({...journal,operations:[journal.operations[0],journal.operations[0]]})).toThrow();
    expect(()=>validateManagedJournal({...journal,operations:[{
      ...journal.operations[0],path:"../../outside",
    }]})).toThrow();
    expect(()=>validateManagedJournal({...journal,operations:[{
      ...journal.operations[0],stage:journalSibling(proc,"stage",id),
    }]})).toThrow();
    expect(()=>validateManagedJournal({...journal,operations:[{
      ...journal.operations[1],backup:".chat-harness/WORKSPACE.md",
    }]})).toThrow();
  });
  test("unexpected observed paths, missing observations or symlinks are conflict",()=>{
    const now=snapshot();
    now.operations.pop();
    expect(assessManagedRecovery(journal,now).decision).toBe("conflict");
    now.operations.push({path:"unexpected.md",canonical:null,stage:null,backup:null});
    expect(assessManagedRecovery(journal,now).decision).toBe("conflict");
    now.operations[0]!.canonical="unsafe";
    expect(assessManagedRecovery(journal,now).decision).toBe("conflict");
  });
});
