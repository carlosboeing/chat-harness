# Capability Bridge Design

## Purpose

This repository implements a **use-case-agnostic external capability layer for ordinary ChatGPT Project chats**.

The bridge exists so a ChatGPT Project can invoke narrowly bounded operations that are unavailable or unreliable through native ChatGPT tools, while keeping ChatGPT itself as the orchestrator.

Domain workloads such as LinkedIn job lookup or private-health-insurance verification are **proving cases and adapters**, not the architecture.

Cross-project policy for when capabilities should exist is canonical in:

`Tech & AI/20 - Knowledge/Guides/chatgpt-capability-extension.md`

This document owns the **repository implementation design**.

## Design goals

The bridge should:

- extend ordinary ChatGPT Project chats without turning them into a generic remote shell;
- expose stable, typed capability contracts;
- keep domain Projects unaware of transport/runtime plumbing;
- prefer the smallest reliable execution primitive;
- make side effects, permissions, timeouts, output limits and network destinations explicit;
- return structured evidence and failure states that ChatGPT can reason over;
- keep execution backends replaceable;
- be cheap and understandable enough for a small codebase to own.

## Non-goals

The bridge is intentionally **not**:

- a generic browser agent;
- arbitrary remote code execution;
- arbitrary HTTP fetching;
- a workflow engine for whole research processes;
- a replacement for native ChatGPT search/plugins;
- a place to persist sensitive user data;
- a mechanism for bypassing authentication, CAPTCHA or anti-bot controls;
- a platform that requires every capability to share the same execution runtime.

## Architecture

```text
ChatGPT Project
     |
     | typed capability request
     v
Transport
(currently private GitHub Issue)
     |
     v
Capability Bridge
+-----------------------------+
| registry                    |
| dispatcher                  |
| runtime resolver            |
| request/result envelope     |
| timeout/output enforcement  |
+-----------------------------+
     |
     | selects registered handler/runtime
     v
Execution runtime
+-----------------------------+
| node / direct HTTP          |
| browser / Playwright        |
| future serverless/MCP/etc.  |
+-----------------------------+
     |
     v
Bounded durable adapter
+-----------------------------+
| linkedin.job.lookup         |
| future promoted adapters    |
+-----------------------------+
     |
     v
Structured result + provenance
     |
     v
ChatGPT continues workflow
```

The important boundary is:

> **The bridge is generic; capability adapters are specific.**

A new domain should normally add a registered capability adapter, not a new transport or orchestration layer.

## Stable vs replaceable components

### Stable contract

The architectural asset is the capability contract:

```text
invoke(capability_name, typed_input)
    -> structured result
```

A capability should have:

- stable name;
- typed/validated input;
- explicit side-effect class;
- bounded timeout/output;
- destination/network policy;
- structured result and failure states;
- provenance/identity evidence;
- tests.

Domain Projects should depend on this contract, not on GitHub Actions, Playwright, or any other backend.

### Replaceable plumbing

The following are implementation choices and may change without changing Project workflows:

- GitHub Issue transport;
- GitHub Actions execution;
- Node runtime;
- Playwright;
- future MCP endpoint;
- serverless/container runtime;
- managed browser;
- another model or semantic worker.

If latency, geography, IP reputation, cost, concurrency or statefulness becomes material, move the runtime while preserving capability names/contracts.

## Control-plane ownership

ChatGPT remains the control plane.

It decides:

- what fact/action is needed;
- whether the gap is material;
- which registered capability fits;
- how returned evidence affects the larger workflow;
- whether additional verification is required;
- when an approval boundary has been reached.

The bridge should not become an autonomous planner for the user's whole task.

## Execution selection

Use the least complex reliable path:

```text
native ChatGPT capability
    -> equivalent authoritative source
    -> direct API / HTTP
    -> deterministic browser
    -> semantic browser assistance
    -> managed/stateful browser
    -> authenticated or side-effecting flow
```

This is an architectural rule, not just an optimization.

A capability that was initially discovered through browser inspection should be simplified to direct HTTP/API if a stable bounded request exists.

### Evidence from the first browser spike

The Shopping/private-health benchmark produced three useful cases:

1. **QCH personalised quote**
   - multi-step interaction was genuinely required;
   - deterministic Playwright completed it;
   - this justified the `browser` runtime class.

2. **QCH hospital lookup**
   - looked interactive;
   - browser inspection exposed a stable GET contract;
   - steady-state implementation was reduced to direct HTTP.

3. **Medibank provider finder**
   - Chromium loaded the public page;
   - no actionable public provider-search UI was exposed;
   - this was classified as a public-data/auth/source boundary rather than solved by adding a smarter browser.

These results reinforce that **browser is one execution primitive, not the default fallback for every blocked page**.

## Current transport

The current transport is:

```text
owner-authored private GitHub Issue
    -> capability-dispatch workflow
    -> structured CAPABILITY_RESULT comment
    -> issue closed
    -> ChatGPT reads result through GitHub integration
```

This transport is pragmatic because ordinary ChatGPT Projects can access the connected GitHub repository.

It is not part of the permanent capability contract.

## Registry

`registry.json` is the allowlist and execution metadata source.

Each entry defines, as applicable:

- capability description;
- handler path;
- runtime class;
- side-effect classification;
- timeout;
- maximum output;
- network policy;
- typed input schema.

The registry must never become an escape hatch for caller-controlled scripts, hosts, headers, cookies or credentials.

## Dispatcher

`src/dispatch.mjs` is deliberately generic.

Its responsibilities are:

1. validate the outer request envelope;
2. resolve the capability from the registry;
3. enforce registered execution budgets;
4. load the registered handler;
5. pass bounded execution context;
6. normalize the result into the v1 response envelope;
7. reject oversized results.

It should not contain domain logic.

## Runtime classes

### `node`

Use for deterministic computation, parsing, direct HTTP/API calls and other short-lived operations that do not need browser state.

Current durable example:

- `linkedin.job.lookup`.

The QCH hospital spike demonstrated that an apparently interactive workflow could be simplified to direct HTTP, but the spike adapter itself is no longer registered.

### `browser`

Use only when interaction/rendered application state is actually required.

The runtime was first proven by the disposable `private-health.quote.qch` spike. That adapter has been removed from the active registry; the reusable browser runtime remains and is regression-tested with a domain-agnostic local fixture.

Any future browser-backed capability must still be a **bounded durable operation** after promotion. ChatGPT does not receive a generic `browser.run(url, prompt)`.

Potential future runtime classes should be added only after a real workload justifies them.

## Browser runtime principles

A shared browser runtime may provide common mechanics such as:

- launch/cleanup;
- locale/timezone;
- timeout/action budgets;
- HTTPS top-level navigation allowlists;
- abort handling;
- sanitized diagnostics;
- optional tracing/screenshots under an explicit policy.

It should not absorb domain navigation logic prematurely.

Adapters own the concrete workflow and verification rules.

Do not introduce semantic browser control such as Jev until deterministic Playwright demonstrates real selector/recovery maintenance problems.

## Capability adapter responsibilities

A capability adapter owns:

- domain-specific input validation;
- exact destinations/endpoints;
- selectors/request construction;
- result extraction;
- identity verification;
- domain-specific failure states;
- stopping before prohibited side effects.

Adapters should be easy to delete or replace.

The shared bridge should remain useful even when a particular adapter becomes obsolete.

## Safety model

### Read-only by default

Most automatically invoked capabilities should be read-only.

Examples:

- public resource lookup;
- quote calculation that stops before contact submission;
- provider/network verification;
- deterministic analysis.

### Consequential actions

Purchases, messages, applications, account mutations, bookings, cancellations and destructive actions require a stronger capability-specific design and explicit approval semantics.

They should not be smuggled into an otherwise read-only adapter.

### Sensitive data

The GitHub Issue transport persists request bodies and comments.

Do not put:

- credentials;
- auth cookies/tokens;
- payment data;
- sensitive health data;
- private identifiers;
- unnecessary PII

into capability requests/results.

Where private state is eventually required, prefer a stable opaque reference to preconfigured secure state rather than embedding the data in the request.

## Failure model

Failures are part of the contract and should be explicit rather than hidden behind generic exceptions.

Useful classes include:

- `INVALID_INPUT`;
- `UNKNOWN_CAPABILITY`;
- `TIMEOUT`;
- `OUTPUT_TOO_LARGE`;
- `NOT_FOUND`;
- `PARTIAL_EVIDENCE`;
- `UI_CHANGED`;
- `BOT_BLOCKED`;
- `AUTH_REQUIRED`;
- `FETCH_FAILED`;
- domain-specific unavailable/mismatch states.

ChatGPT must be able to distinguish:

- retryable execution failure;
- permanent source limitation;
- missing public information;
- authentication boundary;
- successful but partial evidence.

## Observability

Every non-trivial capability should return enough sanitized metadata to diagnose reliability:

- retrieved timestamp;
- execution mode;
- final/source URL where safe;
- duration;
- meaningful step count where applicable;
- explicit result state.

Do not return entire page dumps or sensitive browser artifacts by default.

## Capability lifecycle

Adapters are disposable by default. The production registry on `main` contains only durable capabilities.

See [`docs/capability-lifecycle.md`](capability-lifecycle.md) for the enforceable lifecycle and promotion rules.

In short:

- first observed one-off need -> spike branch;
- repeated need across at least two independent real tasks -> eligible for durable promotion;
- explicitly recurring Project/workflow need + successful end-to-end proof -> eligible for durable promotion;
- otherwise remove the adapter before merge and keep only genuinely reusable infrastructure.

CI validates that every handler on `main` is registered, every registry entry is durable with promotion evidence, and no `spikes/` or `experiments/` tree is present.

## Adding a capability

Before implementation:

1. prove native tools/plugins do not already solve the material gap;
2. check the registry for an existing overlapping capability;
3. define the smallest useful operation;
4. classify side effects;
5. define typed inputs and destination policy;
6. choose the simplest runtime;
7. define verification and failure states.

Then:

1. create a spike adapter on a branch unless recurrence is already proven;
2. test through the real transport;
3. measure latency/reliability/maintenance;
4. extract only genuinely reusable infrastructure;
5. promote the adapter only if it meets the durable lifecycle rule;
6. otherwise delete the adapter and domain-specific tests before merge;
7. keep domain methodology in the domain Project.

## Domain independence

The bridge has already been exercised from two domains:

### Work & Career

`linkedin.job.lookup` proved:

- ordinary ChatGPT -> external typed capability;
- exact-resource verification;
- direct HTTP handler;
- structured evidence returned to the same workflow.

### Shopping

Private health insurance proved:

- the same transport/registry/dispatcher can support another domain;
- some operations require a different runtime class;
- browser-backed execution can be added without changing the Project-side architectural model;
- apparent browser gaps may reduce to HTTP or turn out to be source/auth boundaries.

Future domains should reuse the same bridge rather than fork domain-specific execution infrastructure.

## PR/spike interpretation

The health-insurance work is a **spike used to validate the generic execution architecture**.

The QCH adapters were intentionally narrow and have now been removed from the active registry after serving their spike purpose.

What should survive the spike is:

- typed capability registry;
- generic dispatch;
- enforceable execution budgets;
- runtime selection;
- safe browser execution pattern;
- structured provenance/failure states;
- progressive escalation discipline.

## Initial browser-runtime rollout

The first browser-runtime implementation was developed through two divergent spike branches:

- PR #13 explored stronger reusable runtime/packaging structure;
- PR #14 accumulated the live QCH experiments and empirical findings.

They were alternatives, not cumulative dependencies. The useful reusable pieces from #13 — pinned package/lockfile, shared browser runtime, action/navigation budgets, sanitized diagnostics and separate CI — were deliberately consolidated into PR #14 rather than merging both branches.

PR #14 was the canonical initial browser-runtime change. PR #13 was superseded by that consolidation.

After the runtime was proven, the private-health adapters were removed from `main` because recurrence was not established. The browser runtime, safety controls, dispatcher changes and generic regression coverage remain.

The durable lesson is broader than those PRs: future capability spikes may use disposable domain adapters, but reusable execution infrastructure should be reconciled into one implementation path before promotion to `main`, and adapters themselves must separately earn durable status.

## Future evolution

Possible future extensions include:

- serverless execution;
- MCP transport;
- managed browsers;
- semantic decision workers such as Jev;
- external LLM review workers;
- deterministic data/optimization jobs;
- authenticated capabilities with a dedicated secret/private-state boundary.

They should all preserve the same principle:

> **ChatGPT orchestrates; the capability layer exposes bounded typed operations; execution providers remain replaceable.**
