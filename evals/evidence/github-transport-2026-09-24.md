# GitHub transport smoke — 2026-09-24

Status: **pass**

## Scope

Exercise the real owner-gated GitHub Issue → Actions → structured comment → close transport against the merged private default-branch Chat Harness implementation.

## Execution

- repository state: private `main`, merge commit `3f5921d4ff8624eaed74c0514b7bbb5d851ad138`
- issue: #19, `[capability] v0.1 release smoke`
- workflow run: `36013775019`
- request id: `v0.1-release-smoke-2026-09-24`
- capability: `linkedin.job.lookup`
- input: public numeric job ID `4468897387`

No private, credentialed, or sensitive data was supplied.

## Observed result

The workflow:

1. accepted the owner-authored issue;
2. installed the pinned Bun toolchain/dependencies;
3. resolved the capability runtime;
4. executed the TypeScript dispatcher and handler;
5. returned a structured result with:
   - `ok: true`
   - `state: EXACT_VERIFIED`
   - exact observed job identity matching `4468897387`
   - public-source provenance;
6. posted the `CAPABILITY_RESULT` JSON as an issue comment;
7. closed the issue automatically.

Issue #19 closed at 2026-09-24T14:34:48Z.

## Qualification meaning

This proves the real persistent GitHub transport works end-to-end on the merged v0.1 implementation. It does not weaken the separate negative security tests: v0.1 still permits only public-data, no-credential, read-only capabilities explicitly approved for persistent transport.
