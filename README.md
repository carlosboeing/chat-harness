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

## Initial capability

- `linkedin.job.lookup` — read-only lookup of one public LinkedIn job by numeric job ID through LinkedIn's unauthenticated guest job endpoint.

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

## Safety properties

- private repository;
- only owner-authored `[capability]` issues execute;
- allowlisted named capabilities;
- strict capability-specific input validation;
- handler-owned network destinations;
- no arbitrary URL/host/header/cookie inputs;
- HTTPS-only redirects restricted by each handler;
- bounded request, response, timeout, and output sizes;
- least-privilege GitHub workflow permissions;
- one-minute workflow timeout;
- no artifacts or caches;
- no LinkedIn credentials or authenticated session.

## Repository layout

```text
.github/workflows/capability-dispatch.yml
capabilities/
  linkedin-job/
    handler.mjs
protocol/
  request-response.schema.json
src/
  dispatch.mjs
tests/
  linkedin-job.test.mjs
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

Examples that may be useful later:

- Work & Career: job/company source resolvers;
- Shopping: selected retailer/API lookups and deal verification helpers;
- Tech & AI: API/benchmark probes;
- life admin: narrow public-data/API lookups.

Do **not** add a generic `run_script`, shell execution tool, or unrestricted `fetch_url` capability.
