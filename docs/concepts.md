# Concepts

Chat Harness keeps the public vocabulary deliberately small.

## Harness engineering

Engineering the context, state, authority, verification, and recovery environment around an AI assistant rather than treating each chat as an isolated prompt/response exchange.

## Workspace

An ownership and durable resume boundary for a body of work. It is not an information silo: relevant authorized context may be federated from other Workspaces, repositories, connected apps, assistant context systems, and public sources.

## AGENTS.md

The canonical self-contained generic Chat Harness behavior. The complete file is the portable Project Instructions artifact.

Chat Harness owns a recognizably managed `AGENTS.md`; setup may refresh that managed file wholesale. Unknown/unmanaged same-name content is preserved as a brownfield collision.

For ChatGPT, copy the complete current file into Project Instructions.

## WORKSPACE.md

The one Workspace-specific instruction extension: specialist/domain role, judgement, evidence/currentness standards, invariants, output expectations, boundaries, and domain-specific approvals.

It is seeded at setup and then becomes user-owned.

## Specialist

A setup-time seed for `WORKSPACE.md`. A specialist captures durable domain judgement and evidence standards; it is not a separate agent, runtime mode, inheritance hierarchy, or procedure package.

See [Specialists](specialists.md).

## Workspace Map

`.chat-harness/README.md`: a compact user-owned orientation and routing/index document. It points to authoritative domain sources, important locations, Procedures, and Workstreams.

It is not another instruction file or machine manifest.

## Workstream

A coherent, compact resume point for an ongoing objective.

> **independent objective + independent next action + likely future continuation = Workstream**

A Workstream holds objective, current direction, material durable state/rationale, blockers/open questions, relevant artifacts/sources, and an explicit Next action. It is continuously maintained and compacted rather than used as a transcript.

A Workstream does not override stronger canonical domain evidence.

## Workbench

Substantial durable working artifacts produced during chats:

- **ideas** — brainstorms, hypotheses, questions, concepts, option generation;
- **research** — discovery, evidence collection, investigations, experiments;
- **analysis** — synthesis, comparison, strategy, design, decision analysis, modelling;
- **plans** — implementation, action, booking, compliance, experiment plans;
- **reviews** — reviews, audits, critiques, evaluations, retrospectives.

The taxonomy is organizational, not a state machine. Workstreams and Workbench are parallel outputs from work.

## Procedure

Reusable detailed methodology for a recurring class of work.

A useful distinction:

```text
WORKSPACE specialist = who/how this Workspace generally works
Procedure            = how a specific recurring task is performed
```

## _inbox

Visible human/automation → assistant intake. Contents are user-owned.

## temp

Assistant → assistant non-canonical transient space. Promote valuable results before closeout and clean disposable harness-created material when appropriate.

## Durable project state

Explicit inspectable state outside transient conversation history: objective, current direction, material decisions, dependencies, source/artifact references, blockers, and next action.

This is more precise than calling the system “memory.”

## Source of truth

The source that owns a fact, record, artifact, or instruction. Retrieval convenience does not transfer ownership. Derived summaries should retain provenance and should not silently become competing canon.

## Source Policy

The narrow `.chat-harness/source-policy.yaml` contract for privacy/source handling. It is not IAM, a Workspace manifest, specialist configuration, or general behavior configuration.

## Checkpoint

A material durable update that makes interruption and recovery safe.

Useful triggers include a meaningful direction change, decision-relevant finding, accepted/rejected option, blocker/dependency change, valuable artifact update, next-action change, phase boundary, or substantial handoff.

Avoid checkpoint noise. Never persist private chain-of-thought.

## Capability

A bounded ability available to the assistant: native host tool, app/connector, MCP, or Chat Harness-managed extension.

## Context engineering

Deliberate selection and routing of instructions, current Workstream state, canonical sources, volatile-source refreshes, and capability descriptions. The default is minimum high-value context first, with progressive broadening when material.

## Action Transparency

Explain meaningful external mutations at goal level without narrating routine mechanics. Transparency is not authorization.

## Related documentation

- [Architecture](architecture.md)
- [Specialists](specialists.md)
- [Security](security.md)
