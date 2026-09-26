# Specialists

Specialists give a new Workspace a useful domain-specific starting point without turning Chat Harness into a multi-agent runtime.

A specialist is a **setup-time seed for `.chat-harness/WORKSPACE.md`**. It answers questions such as:

- What kind of judgement should the assistant apply here?
- Which evidence is strongest for this domain?
- Which facts need current verification?
- What failure modes should the assistant actively avoid?
- What domain boundaries or approval constraints matter?
- What does good output look like?

After setup, `WORKSPACE.md` is user-owned and canonical for that Workspace. There is no runtime specialist inheritance, composition, precedence system, or template synchronization.

## Choosing a specialist

```bash
chat-harness setup /path/to/project --specialist tech
```

If `--specialist` is omitted, interactive setup asks and defaults to `general`. Non-interactive setup uses `general` deterministically.

| ID | Best fit | What the seed emphasizes |
|---|---|---|
| `general` | Broad ongoing knowledge work | factual integrity, source quality, currentness, explicit uncertainty, pragmatic output |
| `research` | Investigations and evidence synthesis | precise framing, primary evidence, provenance, contradictory evidence, uncertainty, separation of evidence from interpretation |
| `tech` | Software engineering and technical research | Principal/Staff+ judgement, real repo inspection, maintainability, operability, security, debugging, cost, ecosystem maturity, reversibility, anti-overengineering |
| `tax` | Tax research and preparation | jurisdiction, tax period, entity/capacity, primary tax authority and legislation, factual integrity, ownership/treatment distinctions, conservative handling of unsupported positions |
| `finance` | Personal or product financial analysis | goals, horizon, liquidity, risk, fees, tax, friction, scenarios, authoritative provider documents, historical-vs-forward-looking discipline |
| `career` | Career positioning and opportunity work | evidence-grounded claims, no invented metrics/scope, private/public evidence boundaries, current company/process facts, restrained human writing |
| `shopping` | Product/service purchasing research | buyer fit, broad-enough discovery, true net cost, reliability/support, ownership friction, current availability/terms, dependable economics vs uncertain promotions |
| `travel` | Travel research and itinerary work | traveller fit, transfer/time realism, current entry/schedule/seasonality facts, confirmed-vs-proposed distinction, non-overpacked plans, approval before bookings/cancellations |

## What specialists are not

A specialist is **not**:

- a separate agent;
- a model selection;
- a runtime mode;
- a procedure package;
- a hierarchy of inherited prompts;
- a permanent upstream template that overwrites your changes.

This separation is deliberate:

```text
WORKSPACE specialist = who/how this Workspace generally works
Procedure            = how a specific recurring task is performed
```

Chat Harness always scaffolds `.chat-harness/procedures/`, but specialist selection does not automatically install Procedures.

## Customizing the seed

The generated `WORKSPACE.md` is meant to be edited. Add the domain invariants, evidence sources, approval boundaries, output conventions, and judgement rules that are specific to your real Workspace.

Keep generic Chat Harness behavior out of it. Generic startup, retrieval, persistence, checkpointing, and recovery behavior belongs in the managed root `AGENTS.md`.

Likewise, do not copy the specialist into ChatGPT Project Instructions. For the ChatGPT binding, Project Instructions contain the **complete `AGENTS.md`**; the assistant retrieves `WORKSPACE.md` as the Workspace-specific extension.

## Existing WORKSPACE.md

Setup does not silently overwrite an existing `WORKSPACE.md`.

In interactive setup, the safe default is to keep the current file. You can explicitly choose to replace it with the selected specialist template, preview the template, or cancel. In non-interactive use, replacement requires an explicit option.

This matters because specialist templates are starting points. Once a Workspace exists, its own `WORKSPACE.md` is the source of truth.

## Optional domain scaffolding

Some specialists can suggest a small domain folder layout. Those folders are **not core Chat Harness architecture**.

Interactive setup defaults to **no**. Non-interactive setup requires explicit opt-in:

```bash
chat-harness setup /path/to/project --specialist tech --scaffold-domain
```

Domain scaffolding is additive only: missing exact paths may be created; existing directories are reused; file/type clashes or unsafe paths are reported and left untouched. Chat Harness does not fuzzy-match, rename, move, merge, or reorganize an existing corpus.

## Examples

A technical Workspace might begin with:

```bash
chat-harness setup ~/Projects/platform-research --specialist tech
```

A tax Workspace:

```bash
chat-harness setup ~/Documents/tax --specialist tax
```

A broad household or personal-admin Workspace can simply use:

```bash
chat-harness setup ~/Documents/household --specialist general
```

The specialist changes the initial Workspace-specific operating guidance, not the core scaffold or runtime architecture.

## Related documentation

- [Architecture](architecture.md) — instruction ownership and runtime retrieval.
- [Concepts](concepts.md) — canonical terminology.
- [ChatGPT host binding](hosts/chatgpt.md) — where `AGENTS.md` and `WORKSPACE.md` belong in ChatGPT.
- [Security](security.md) — authority, Source Policy, and approval boundaries.
