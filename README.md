# ChatGPT GitHub Capability Bridge

A small, auditable execution bridge that lets **ordinary ChatGPT Project chats** invoke vetted external capabilities through the GitHub plugin and GitHub Actions.

## Architecture

```text
ChatGPT Project
  -> typed capability request
  -> private GitHub Issue
  -> generic registry / dispatcher
  -> selected runtime
     -> node / direct HTTP
     -> browser / Playwright
     -> future runtime
  -> bounded durable capability adapter
  -> structured result
  -> ChatGPT continues workflow
```

The bridge infrastructure is use-case agnostic. Capability adapters are specific and **disposable by default**; only adapters that satisfy the durable-promotion rules belong in the active registry on `main`.

See:

- [`docs/design.md`](docs/design.md) — implementation architecture and runtime boundaries.
- [`docs/capability-lifecycle.md`](docs/capability-lifecycle.md) — deterministic spike vs durable adapter lifecycle.

## Active durable capabilities

- `linkedin.job.lookup` — read-only lookup of one public LinkedIn job by numeric job ID through LinkedIn's unauthenticated guest endpoint.

The browser runtime is available on `main`, but there is currently **no durable browser-backed adapter registered**. It was proven with a disposable private-health spike and is now tested with a domain-agnostic local browser smoke test.

## Request protocol

Create an owner-authored issue titled:

```text
[capability] linkedin.job.lookup
```

with a raw JSON body:

```json
{
  "version": 1,
  "capability": "linkedin.job.lookup",
  "input": {
    "job_id": "4468897387"
  }
}
```

An optional `request_id` may be supplied.

## Response protocol

The workflow posts one issue comment beginning with `CAPABILITY_RESULT`, followed by structured JSON, then closes the issue.

## Runtime classes

Capabilities declare a runtime in `registry.json`:

- `node` — deterministic computation, parsing, direct HTTP/API calls.
- `browser` — pinned Playwright/Chromium for bounded interactive workflows.

A runtime can remain durable even when the spike adapter that proved it is removed.

## Safety properties

- private repository;
- only owner-authored `[capability]` issues execute;
- allowlisted named capabilities;
- strict capability-specific input validation;
- handler-owned network destinations;
- no arbitrary shell/script execution;
- no arbitrary URL/host/header/cookie inputs;
- browser top-level navigation is HTTPS + allowlist constrained;
- bounded request, response, action, navigation and runtime budgets;
- least-privilege GitHub workflow permissions;
- no persistent browser profiles, caches or credentials;
- CAPTCHA/bot/auth boundaries are failures, not bypass targets.

## Capability lifecycle

New task-specific adapters start as **spikes**.

A spike:

- stays on a branch;
- may temporarily use the branch registry for end-to-end testing;
- must be removed before merge unless explicitly promoted;
- must not leave orphan handler/test code on `main`.

A durable adapter must satisfy one of:

1. **Recurring use** — at least two independent real tasks/sessions needed the same bounded capability contract.
2. **Recurring workflow** — a durable Project/workflow explicitly depends on it as an expected recurring operation and it has been proven end-to-end.

The active registry on `main` accepts only `lifecycle: durable` entries with promotion evidence.

`scripts/validate-registry.mjs` enforces this in CI.

## Repository layout

```text
.github/workflows/
  capability-dispatch.yml
  ci.yml

capabilities/
  linkedin-job/
    handler.mjs

docs/
  design.md
  capability-lifecycle.md

protocol/
  request-response.schema.json

scripts/
  validate-registry.mjs
  smoke-browser-runtime.mjs

src/
  browser-runtime.mjs
  dispatch.mjs
  resolve-runtime.mjs

tests/
  browser-runtime.test.mjs
  linkedin-job.test.mjs

registry.json
package.json
package-lock.json
```

## Adding a capability

Do not add an adapter merely because one task was awkward.

Follow the lifecycle decision:

```text
material native gap?
  -> existing durable capability fits? reuse
  -> otherwise one-off/unproven? spike branch
  -> recurring need proven? durable promotion candidate
```

For a durable promotion, require:

- stable typed contract;
- explicit side-effect class;
- bounded timeout/output;
- destination/network policy;
- structured result/failure states;
- tests;
- successful real transport execution;
- promotion evidence in the registry.

Do **not** add a generic `run_script`, shell execution tool, unrestricted `fetch_url`, or unrestricted browser capability.
