# Concepts

Chat Harness keeps the public vocabulary deliberately small.

## Harness engineering

Engineering the context, state, authority, verification, and recovery environment around an AI assistant rather than treating each chat as an isolated prompt/response exchange.

## Workspace

The durable ownership and resume boundary for a body of work. It is not an information silo: relevant authorized context may be federated from other Workspaces, repositories, connected apps, assistant context systems, and public sources.

## AGENTS.md

The canonical portable source of generic Chat Harness behavior. A host that can consume it directly should do so; ChatGPT uses the complete file as the basis for Project Instructions.

## WORKSPACE.md

The single Workspace-specific instruction extension. It captures domain role, judgement, evidence/currentness standards, invariants, output expectations, boundaries, and domain-specific approvals.

It is seeded during setup and then user-owned.

## Specialist

A setup-time seed for `WORKSPACE.md`. A specialist captures durable domain judgement and evidence standards; it is not a separate agent, runtime mode, inheritance hierarchy, or Procedure package.

See [Specialists](specialists.md).

## Workspace Map

`.chat-harness/README.md`, a human-readable orientation and source-routing document. It says where authoritative information lives and points to important Workstreams and Procedures. It is not a Workspace manifest or machine routing registry.

## Workstream

A coherent resumable unit of ongoing work.

> **independent objective + independent next action + likely future continuation = Workstream**

A Workstream stores enough current state to resume safely. It is neither a transcript nor a primary domain record, and its relevant sources are not an information-access boundary.

## Workbench

Durable working artifacts produced during substantial work, organized as ideas, research, analysis, plans, and reviews.

These categories describe the artifact, not a required lifecycle. Workstreams and Workbench are parallel outputs.

## Durable project state

Explicit inspectable state outside transient conversation history: objective, current direction, material decisions, dependencies, source/artifact references, blockers, and next action. This is more precise than calling the system “memory.”

## Source of truth

The source that owns a fact, record, artifact, or instruction. Retrieval convenience does not transfer ownership. Derived summaries should retain provenance and should not silently become competing canon.

## Source Policy

The `.chat-harness/source-policy.yaml` contract for privacy/source handling. It classifies user-owned sources as `public`, `personal`, `confidential`, or `restricted`.

It is narrow source-handling policy, not IAM, a Workspace manifest, specialist configuration, or general configuration.

## Procedure

Reusable methodology for recurring work. A Procedure may be Markdown, a playbook, a host-native Skill, or another readable form. Stable methodology remains separate from changing Workstream state.

A useful distinction is: **specialist = how this Workspace generally works; Procedure = how a recurring task is performed.**

## Checkpoint

A material durable update that makes interruption and recovery safe. An updated Workstream plus references to material artifacts normally supplies the checkpoint; there is no separate checkpoint database object.

Checkpoint material changes rather than chat noise, and never persist private chain-of-thought.

## Artifact

A meaningful durable output such as a report, itinerary, design, spreadsheet, or decision record. Not every intermediate file is an Artifact.

## _inbox

Visible user/automation → assistant intake. Its contents are user-owned.

## temp

Assistant → assistant non-canonical transient space. Promote valuable results before closeout.

## Capability

Any bounded ability available to the assistant: native web/files, an app/connector, MCP, or a Chat Harness-managed extension.

## CapabilityProvider

The Chat Harness-managed external extension boundary whose contract, policy, transport/runtime, and structured result semantics Chat Harness controls. Host-native tools are not wrapped behind this interface for symmetry.

## Context engineering

Deliberate selection and routing of instructions, current Workstream state, canonical sources, volatile-source refreshes, and capability descriptions. The default is minimum high-value context first, with progressive broadening when material.

## CREATE and CLOSE

**CREATE**: before adding durable canon, check whether an existing artifact already owns that truth.

**CLOSE**: before substantial handoff or interruption, persist valuable outputs to their durable home and leave current resumable Workstream state.

## Action Transparency

Explain meaningful external mutations before they happen without narrating routine tool mechanics. Consequential actions still require explicit approval; transparency is not authorization.

## Host binding

The minimum host-specific glue that makes canonical `AGENTS.md` instructions and relevant Workspace context effective when a host cannot consume them directly. Host bindings are operational configuration, not competing instruction canon.
