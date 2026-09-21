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

The dispatcher is generic; capabilities are explicit and typed. This repository intentionally does **not** expose arbitrary shell/Python/JavaScript execution, arbitrary URL fetching, user-controlled headers/cookies, or unrestricted browser control.

The GitHub transport/runtime is replaceable. Capability names and request/result contracts should remain stable if execution later moves to MCP, serverless infrastructure, a managed browser service, or another backend.

## Capabilities

- `linkedin.job.lookup` — read-only lookup of one public LinkedIn job by numeric job ID through LinkedIn's unauthenticated guest job endpoint.
- `private-health.quote.qch` — experimental read-only Queensland Country Health Fund quote verification using a single approved synthetic household profile. This capability exists to benchmark browser-backed execution; it does not accept arbitrary household details or perform signup/contact actions.

## Runtime classes

Registry entries declare a runtime class:

- `node` — dependency-free/direct HTTP or deterministic Node handlers.
- `browser` — installs the pinned Playwright runtime and Chromium only for that capability invocation.

Browser-backed handlers still use the same capability protocol and dispatcher. They do not expose a general-purpose browser surface to ChatGPT.

## Request protocol

Create an owner-authored issue titled:

```text
[capability] <capability-name>
```

with a raw JSON body. Example:

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

The response contains explicit state/provenance fields so a caller can distinguish exact verification from partial, blocked, expired, mismatched, timed-out, or unresolved results.

## Safety properties

- private repository;
- only owner-authored `[capability]` issues execute;
- allowlisted named capabilities;
- strict capability-specific input validation;
- handler-owned network destinations;
- no arbitrary URL/host/header/cookie inputs;
- browser capabilities enforce HTTPS top-level navigation allowlists;
- bounded request, result, action, and execution budgets;
- dispatcher centrally enforces registered execution timeout and output size;
- least-privilege GitHub workflow permissions;
- five-minute outer workflow timeout with tighter per-capability limits;
- no CAPTCHA bypass;
- no browser traces/screenshots/artifacts by default;
- no credentials or authenticated sessions in the current capabilities;
- the synthetic QCH experiment stops before contact submission, account creation, or joining.

## Repository layout

```text
.github/workflows/
  capability-dispatch.yml
  ci.yml
capabilities/
  linkedin-job/
    handler.mjs
  private-health-qch-quote/
    handler.mjs
protocol/
  request-response.schema.json
src/
  browser-runtime.mjs
  dispatch.mjs
  resolve-runtime.mjs
tests/
  browser-runtime.test.mjs
  linkedin-job.test.mjs
  private-health-qch-quote.test.mjs
registry.json
package.json
package-lock.json
```

## Adding capabilities

Add capabilities only for a concrete ChatGPT Project execution gap.

Every capability should have:

- a stable name;
- a typed and validated input contract;
- deterministic destination/permission policy;
- bounded runtime/output/cost;
- a structured result contract;
- tests;
- an explicit side-effect classification.

Prefer the simplest execution path that works:

```text
authoritative/public API
  -> reproducible direct HTTP/XHR
  -> deterministic browser
  -> semantic browser assistance
  -> managed browser/proxy
```

Browser automation is an implementation option behind a bounded capability, not a reason to expose `browser.run`.

Do **not** add a generic `run_script`, shell execution tool, unrestricted `fetch_url`, unrestricted browser prompt, or caller-controlled credentials/cookies/headers.
