# Concepts

## Workspace
An ownership/resume boundary, not an information silo.

## AGENTS.md
Wholly Chat Harness-owned generic behavior. The complete file is the portable Project Instructions artifact. ChatGPT users copy the entire file into Project Instructions.

## WORKSPACE.md
The one Workspace-specific instruction extension: specialist/domain role, judgement, evidence/currentness standards, invariants, output expectations, boundaries, and domain-specific approvals. Seeded at setup, then user-owned.

## Workspace Map
`.chat-harness/README.md`: compact user-owned routing/index state pointing to authoritative domain sources, important locations, Procedures, and Workstreams. It is not another instruction file or machine manifest.

## Workstream
Compact current resume state for an ongoing objective.

> independent objective + independent next action + likely future continuation = Workstream

It holds objective, current direction, material durable state/rationale, blockers/open questions, relevant artifacts/sources, and Next action. It does not override stronger canonical domain evidence.

## Workbench
Substantial durable working artifacts produced during chats:
- ideas;
- research;
- analysis;
- plans;
- reviews.

The taxonomy is organizational, not a state machine. Workstreams and Workbench are parallel outputs.

## Procedure
Reusable detailed methodology for a recurring class of work. Specialist = who/how the Workspace generally works; Procedure = how a recurring task is performed.

## _inbox
Visible user/automation → assistant intake. Contents are user-owned.

## temp
Assistant → assistant non-canonical transient space. Promote valuable results before closeout.

## Source Policy
Narrow machine-readable privacy/source-handling rules in `.chat-harness/source-policy.yaml`. Not generic behavior/configuration.

## Source of truth
The source that owns a fact/artifact/instruction. Retrieval convenience does not transfer ownership.

## Checkpoint
A material durable update that makes interruption/recovery safe. Avoid checkpoint noise and never persist private chain-of-thought.

## Capability
A bounded ability available to the assistant: native host tool, app/connector, MCP, or Chat Harness-managed extension.

## Action Transparency
Explain meaningful external mutations at goal level without narrating routine mechanics. Transparency is not authorization.
