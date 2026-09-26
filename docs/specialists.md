# Specialists

Specialists give a new Workspace useful domain-specific guidance without turning Chat Harness into a multi-agent runtime.

A specialist is a **setup-time seed for `.chat-harness/WORKSPACE.md`**. It defines the kind of judgement the assistant should apply, the strongest evidence for the domain, important failure modes and boundaries, and what good output should look like.

After setup, `WORKSPACE.md` is user-owned. There is no runtime specialist inheritance, composition, or template synchronization.

## Choose what the Workspace is mainly for

For most people, run setup from inside the Workspace and let the guided flow explain the choices:

```bash
chat-harness setup
```

Or choose directly:

```bash
chat-harness setup --specialist tech
```

The optional `[path]` argument is only needed when targeting another existing directory:

```bash
chat-harness setup /path/to/project --specialist tech
```

If `--specialist` is omitted, interactive setup asks what the Workspace is mainly for and defaults to `general`; non-interactive setup uses `general`.

| Specialist | Best fit | Emphasis |
|---|---|---|
| `general` | Broad knowledge work | factual integrity, source quality, currentness, explicit uncertainty, pragmatic output |
| `research` | Evidence-heavy investigation | precise framing, primary evidence, provenance, contradictory evidence, reproducibility |
| `tech` | Engineering and technical research | Principal/Staff+ judgement, real repositories, maintainability, operability, security, cost, anti-overengineering |
| `tax` | Tax research and planning | jurisdiction and tax period, primary authority, ownership/treatment distinctions, conservative factual discipline |
| `finance` | Financial analysis | goals, horizon, liquidity, risk, fees, tax, scenarios, provider evidence |
| `career` | Career positioning | evidence-grounded claims, no invented achievements, current opportunity facts, restrained writing |
| `shopping` | Purchase research | buyer fit, broad discovery, true net cost, reliability, support, current terms |
| `travel` | Travel planning | traveller fit, realistic logistics, current entry/schedule facts, confirmed vs proposed plans |

These descriptions summarize the templates implemented by setup; the generated `WORKSPACE.md` contains the actual guidance.

## Specialist vs Procedure

Specialists and Procedures solve different problems:

```text
Specialist = how this Workspace generally works
Procedure  = how a recurring task is performed
```

Selecting a specialist does not install Procedures or create a separate agent.

## Customize the Workspace

The generated `WORKSPACE.md` is meant to evolve. Add the domain invariants, preferred evidence sources, approval boundaries, output conventions, and judgement rules that are specific to the real Workspace.

Keep generic Chat Harness behavior in `AGENTS.md`. For ChatGPT, copy the complete `AGENTS.md` into Project Instructions and leave specialist/domain guidance in `WORKSPACE.md`.

Setup does not silently overwrite an existing `WORKSPACE.md`; replacement requires an explicit choice.

## Optional domain folders

Specialists can also suggest a small domain folder layout, but those folders are not core architecture. Interactive setup **shows the exact suggested folders before asking** whether to create them. Non-interactive setup requires `--scaffold-domain`.

| Specialist | Optional starter folders |
|---|---|
| `general` | none |
| `research` | `Research/` |
| `tech` | `Projects/` |
| `tax` | `Tax/` |
| `finance` | `Finance/` |
| `career` | `Opportunities/`, `Profile/` |
| `shopping` | `Purchases/`, `Research/` |
| `travel` | `Trips/` |

Domain scaffolding is additive only. Chat Harness does not rename, move, merge, fuzzy-match, or reorganize an existing corpus.

## Related documentation

- [Architecture](architecture.md) — instruction ownership and runtime retrieval.
- [Concepts](concepts.md) — canonical terminology.
- [ChatGPT host binding](hosts/chatgpt.md) — where `AGENTS.md` and `WORKSPACE.md` belong.
