# Capability Adapter Lifecycle

## Purpose

Keep the capability bridge small and use-case agnostic while still allowing fast one-off experiments.

The repository distinguishes **reusable infrastructure** from **capability adapters**:

- infrastructure may be durable even when the workload that proved it was temporary;
- adapters are disposable by default and must earn promotion to the active registry.

The active registry on `main` is a production allowlist, not a history of experiments.

## States

### Spike

Default state for a new task-specific adapter.

Use when:

- the need has been observed once;
- the adapter exists mainly to complete or test one task;
- reuse is plausible but unproven;
- the adapter is helping validate generic infrastructure.

Rules:

- branch-only;
- may temporarily modify the branch registry for end-to-end testing;
- should normally live in its natural capability path while the branch is active;
- must not remain in the active registry on `main`;
- must be deleted before merge unless it is explicitly promoted to durable;
- domain-specific smoke tests must also be removed or replaced by generic infrastructure tests before merge.

A spike PR may intentionally fail the lifecycle validator until cleanup/promotion is complete.

### Durable

A registered capability intended to remain callable from future ChatGPT sessions/projects.

Promotion is allowed only through one of these two bases:

#### 1. Recurring use

At least **two independent real tasks/sessions** successfully needed the same bounded capability contract.

The registry promotion metadata must cite at least two evidence references.

#### 2. Recurring workflow

A durable Project/workflow explicitly depends on the capability as an expected recurring operation, and the capability has been proven end-to-end at least once.

The registry promotion metadata must cite the workflow requirement.

Either route still requires:

- stable typed contract;
- clear side-effect classification;
- bounded destination/network policy;
- tests;
- successful real transport execution;
- acceptable maintenance/operational cost;
- no simpler native/API/HTTP alternative that makes the adapter unnecessary.

## Decision procedure

For every observed external-capability gap:

```text
material gap after native/fallback?
  no  -> do not build
  yes
   |
existing durable capability fits?
  yes -> reuse it
  no
   |
need adapter to complete/prove this task?
  no  -> leave unresolved / use another source
  yes
   |
recurrence already proven?
  no  -> SPIKE (branch-only)
  yes -> candidate for DURABLE promotion
```

After a spike succeeds:

```text
did it expose reusable infrastructure?
  yes -> extract/refactor infrastructure for main
  no  -> no infra change

does adapter meet durable promotion rule?
  yes -> add promotion metadata + keep handler
  no  -> delete adapter + domain tests before merge
```

## Registry contract

Every capability in `registry.json` on `main` must declare:

```json
{
  "lifecycle": "durable",
  "promotion": {
    "basis": "recurring-use | recurring-workflow",
    "evidence": ["..."],
    "reviewed_at": "YYYY-MM-DD"
  }
}
```

There is intentionally no valid `spike` lifecycle value for the production registry.

## Repository hygiene rules

On `main`:

- every `capabilities/**/handler.mjs` must be referenced by the registry;
- every registry entry must point to an existing handler;
- every registry entry must be `lifecycle: durable`;
- `spikes/` and `experiments/` directories are forbidden;
- disposable domain-specific smoke tests are forbidden once their adapter is removed.

Historical spike evidence belongs in:

- Git history / closed PRs;
- concise design rationale in `docs/design.md`;
- external durable research/workbench state when relevant.

Do not keep dead adapter code merely as an example.

## Generic runtime testing

Reusable runtimes should have **domain-agnostic** tests.

For the browser runtime, CI launches Chromium and exercises `src/browser-runtime.mjs` against an in-memory local HTML fixture. This proves:

- Playwright dependency/install;
- Chromium launch;
- bounded step execution;
- DOM interaction/extraction;
- diagnostics;

without preserving a health-insurance, retailer, job-site, or other domain adapter.

## CI enforcement

`scripts/validate-registry.mjs` fails when:

- a registry entry is not durable;
- promotion metadata is missing/invalid;
- recurring-use promotion has fewer than two evidence references;
- a registered handler is missing;
- an orphan handler exists under `capabilities/`;
- `spikes/` or `experiments/` exists on the branch.

This makes cleanup a merge prerequisite rather than a convention.

For strongest enforcement, configure the repository so the CI `test` check is required on `main`. The codebase can validate lifecycle deterministically, but GitHub branch protection/rulesets are what prevent an administrator from merging despite a failed check.

## Examples

### LinkedIn exact job lookup

`linkedin.job.lookup` is durable because exact LinkedIn job retrieval is part of a recurring Work & Career workflow and has been proven end-to-end.

### QCH health-insurance adapters

The QCH quote and hospital adapters were spikes used to prove:

- browser-backed capability execution;
- progressive fallback from browser to direct HTTP;
- structured evidence through the real Issue -> Actions -> ChatGPT path.

They did not establish a recurring capability need, so the adapters themselves are removed from `main`.

The reusable browser runtime, dispatcher/runtime changes, tests and design lessons remain.
