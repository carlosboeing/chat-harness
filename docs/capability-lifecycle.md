# Capability lifecycle

A Chat Harness-managed external capability is **disposable by default**.

The production registry is an allowlist of operations that earned durable maintenance through recurring use or an explicit recurring workflow. A one-off capability spike may exist on a branch to complete or prove real work; it is removed before merge unless deliberately promoted.

> **First occurrence creates a spike, not a product feature. Repetition or an explicit recurring workflow earns permanence.**

## Promotion

A durable capability requires a stable semantic identity, strict typed input, authority classification, bounded destination/network policy, security/data profile, runtime/output/action budgets where relevant, structured result/failure states, tests and successful real execution, acceptable maintenance cost, and promotion evidence.

The registry supports `recurring-use` and `recurring-workflow`. Recurring-use requires at least two independent real uses; recurring-workflow means an established workflow explicitly expects the operation and it has been proved end-to-end.

## Production hygiene

On the release branch/main:

- every capability handler is registered;
- every registered handler exists;
- every entry is durable;
- disposable `spikes/` and `experiments/` trees are forbidden;
- security metadata must satisfy the invoking transport.

The current GitHub persistent transport is stricter: only public-data, no-credential, read-only, persistent-transport-safe capabilities are accepted.

## Current durable capability

`linkedin.job.lookup` resolves one public LinkedIn job by numeric job ID using a handler-owned LinkedIn guest endpoint. The reusable Playwright runtime remains infrastructure but no generic browser capability is registered.

## Extension boundary

This lifecycle applies to Chat Harness-managed external capabilities. Native assistant tools, connected apps, and MCP servers are not forced into this registry for conceptual symmetry.
