# v1 manifest contract

Schema-1 `.chat-harness/manifest.yaml` records `harness.version`, independent Core and Specialist integer versions, and exact-byte SHA-256 digests of wholly managed files. The pure parser/serializer and preview functions do not mutate files or grant ownership by markers. The supported native transaction engine independently revalidates all observations before apply.

WORKSPACE customization, Source Policy, Workbench, Inbox, temp and additive folders are excluded from durable manifest ownership. Unknown/future schemas, unknown/too-new components, aliased/traversing paths, duplicate YAML keys and malformed records fail closed. Older supported components are distinguished from drift and may be updated only when their recorded bytes still match.

See [reconciliation and recovery](reconciliation.md) for the production executor and its tested platform boundary. The old PR-C-only checkpoint is historical Git context, not the current CLI contract.
