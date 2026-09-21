# ChatGPT GitHub Capability Bridge

A small, auditable execution bridge that lets **ordinary ChatGPT Project chats** invoke vetted capabilities through the GitHub plugin and GitHub Actions.

## Architecture

```text
ChatGPT Project
  -> GitHub issue request
  -> capability-dispatch workflow
  -> vetted capability handler
  -> structured issue comment result
  -> ChatGPT GitHub plugin
```

The dispatcher is generic; capabilities are explicit and typed. This repository intentionally does **not** expose arbitrary shell/Python/JavaScript execution, arbitrary URL fetching, user-controlled headers/cookies, or unrestricted network access.

The GitHub transport is replaceable. Capability names and request/result contracts should remain stable if the runtime later moves to MCP, serverless infrastructure, or another execution backend.

## Capabilities

- `linkedin.job.lookup` — read-only lookup of one public LinkedIn job by numeric job ID through LinkedIn's unauthenticated guest job endpoint.
- `private-health.quote.qch` — experimental read-only browser-backed smoke test of Queensland Country Health Fund's quote flow using a fixed synthetic household profile. It does not submit contact details or join/purchase.
- `private-health.hospital.qch` — read-only direct-HTTP lookup of allowlisted hospitals in Queensland Country Health Fund's public hospital network search.

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

An optional `request_id` may be supplied by the caller.

## Response protocol

The workflow posts one issue comment beginning with `CAPABILITY_RESULT`, followed by structured JSON, then closes the issue.

The response contains explicit identity/provenance fields so a caller can distinguish exact-resource verification from partial, blocked, expired, mismatched, or unresolved results.

## Runtime classes

Capabilities declare a runtime in `registry.json`:

- `node` — normal dependency-free Node execution.
- `browser` — installs a pinned Playwright runtime and Chromium for that capability invocation only.

The GitHub Actions job has a coarse outer timeout. Each registered capability also has a tighter `timeout_seconds` and `max_output_chars` budget enforced by the dispatcher.

## Safety properties

- private repository;
- only owner-authored `[capability]` issues execute;
- allowlisted named capabilities;
- strict capability-specific input validation;
- handler-owned network destinations;
- no arbitrary URL/host/header/cookie inputs;
- browser capabilities restrict top-level navigation and do not bypass CAPTCHA/bot protection;
- bounded request, response, timeout, and output sizes;
- least-privilege GitHub workflow permissions;
- no persistent browser profiles, caches, or credentials;
- synthetic profile only for the first browser-backed quote experiment.

## Repository layout

```text
.github/workflows/capability-dispatch.yml
capabilities/
  linkedin-job/
    handler.mjs
  private-health-qch/
    handler.mjs
protocol/
  request-response.schema.json
src/
  dispatch.mjs
  resolve-runtime.mjs
tests/
  linkedin-job.test.mjs
  private-health-qch.test.mjs
registry.json
```

## Adding capabilities

Add capabilities only for a concrete ChatGPT Project execution gap.

Every capability should have:

- a stable name;
- a typed and validated input contract;
- deterministic destination/permission policy;
- bounded runtime/output;
- a structured result contract;
- tests;
- an explicit side-effect classification.

Do **not** add a generic `run_script`, shell execution tool, unrestricted `fetch_url`, or unrestricted browser capability.
