# v0.1 release readiness

Status: **release candidate — external/manual gates remain**

This document is the implementation-side qualification record for Chat Harness v0.1. It separates implemented/tested behaviour from release actions that require a real hosted-assistant path or explicit maintainer approval.

## Deterministic implementation coverage

| Contract area | Status | Evidence |
|---|---|---|
| Product/package/CLI identity `chat-harness`; control namespace `.chat-harness/` | pass | package metadata, CLI tests, docs validation |
| Canonical portable `AGENTS.md` + narrow host-binding model | pass in repository; host effect pending | setup/templates + docs; ChatGPT smoke still required |
| Minimal Workspace and brownfield-safe setup | pass | setup tests + four validating examples |
| Idempotence, dry-run/apply parity, path containment, symlink/race safety | pass | setup test suite |
| Workstream contract + supersession | pass | validation tests |
| Optional lifecycle contract | pass | validation tests + scientific example |
| Source Policy v1 grammar, precedence, conflict handling, unavailable fail-closed semantics | pass | source-policy tests + eval fixtures |
| Workspace ownership/federated context/CREATE/CLOSE conventions | repository contract present | AGENTS/docs + behavioural scenarios; host behaviour tested only when real-host smoke runs |
| `setup / validate / doctor` only; cwd/explicit path; no parent traversal | pass | CLI tests |
| Stable findings, JSON envelope, exit semantics, no-color/non-TTY behaviour | pass | CLI/render tests |
| Doctor is read-only and reports hosted state unknown | pass | doctor tests |
| Capability registry identity/schema/authority/security/budgets/lifecycle | pass | registry validation + tests |
| Strict capability input validation before handler execution | pass | dispatcher integration tests |
| GitHub persistent transport public/no-credential/read-only security gate | pass | negative tests |
| TypeScript LinkedIn capability exact/mismatch/partial evidence semantics | pass | fixture tests |
| Browser helper bounded but not represented as full egress sandbox | pass | browser policy tests + docs |
| Frozen Phase 0 dispatcher behaviour under TypeScript | pass | dispatcher parity suite |
| Four public examples | pass | each passes actual Workspace validation |
| Behavioural eval catalog | pass | 19 explicit required/forbidden scenarios; fixture validator |
| Public positioning no-drift anchors | pass | docs validator + package metadata |
| Standalone binary distribution | pass | native five-platform private smoke |
| Standalone does not require installed Bun/Node | pass | native runner smoke with empty `PATH` |
| SHA-256 sidecars | pass | five-platform private smoke + checksum unit test |
| Node/npm compatibility path | pass | Node 20 vs standalone JSON-equivalence smoke |
| npm package surface excludes examples/evals/extensions/capability runtime/tests | pass | real `npm pack --dry-run` allowlist check |
| License/contribution/security basics | pass | repository files |
| Release automation does not publish implicitly | pass | manual build-only release workflow; no tag/release/npm-publish step |

## Supported build matrix evidence

Private native smoke run `36012528324` succeeded on 2026-09-24 for:

- Linux x64 — `ubuntu-24.04`
- Linux arm64 — `ubuntu-24.04-arm`
- macOS x64 — `macos-15-intel`
- macOS arm64 — `macos-15`
- Windows x64 — `windows-2025`

Each job compiled its native Bun standalone executable, ran `--version`, `setup --json`, and `validate --json` with an empty `PATH`, generated a SHA-256 sidecar, and uploaded a private Actions artifact.

The regular CI distribution job independently builds Linux x64 standalone plus the bundled Node-compatible npm CLI, compares their `validate --json` results under Node 20, and validates the actual npm pack surface.

## Public documentation/positioning audit

Required public surfaces exist:

- root README
- architecture
- concepts
- security
- compatibility ledger
- ChatGPT host binding
- alternatives
- capability lifecycle
- design history
- four examples
- eval documentation
- CONTRIBUTING
- SECURITY
- LICENSE

The public category remains **harness engineering for AI assistants**. The repository does not position Chat Harness as an agent runtime, model framework, memory database, or universal provider abstraction. ChatGPT remains first-class while non-ChatGPT host support is not claimed as verified.

## Security review

Current release-candidate state:

- no generic arbitrary shell/RCE/HTTP/browser capability is registered;
- capability caller input cannot widen authority/network/credentials;
- GitHub Issue/comment transport rejects private, credentialed, write, consequential, and non-approved persistent profiles before execution;
- setup automatic mutation is contained to known Workspace paths and rejects unsafe collisions/symlink escape;
- setup does not silently mutate Source Policy or existing human-authored Markdown;
- portable instructions treat retrieved instructions as untrusted source data rather than authority;
- consequential actions require explicit human approval;
- non-obvious sensitive cross-context reads have proportional notice semantics;
- examples/evals use synthetic data;
- observability uses structured findings/results rather than private transcripts or chain-of-thought.

## Qualification still pending

These are real evidence/action gates rather than missing architecture:

1. **Real ChatGPT host smoke** — requires a ChatGPT Project configured with the documented Project Instructions binding and a retrievable fixture Workspace. It must demonstrate that `AGENTS.md` is effective, Workspace Map/Workstream retrieval works, a fresh session resumes from `Next action`, cross-context Source Policy/transparency behaviour matches the documentation, and CLOSE persists durable state. Until then ChatGPT remains **documented / end-to-end unverified** in `docs/compatibility.md`.
2. **Real GitHub transport smoke of the new implementation** — issue-triggered workflows use the default branch. Run after the release-candidate implementation is on private `main`, using only synthetic/public data, then verify structured result comment and automatic issue closure.
3. **Canonical repository rename** to `carlosboeing/chat-harness` — explicit maintainer approval gate.
4. **Authoritative npm name check** immediately before publication. A collision requires an explicit naming/scoping decision; do not silently change package identity.
5. **External publication actions** — private→public, `v0.1.0` tag, GitHub Release, and npm publish each remain explicit maintainer approval gates.

## Release decision

Do not call v0.1 released or mark ChatGPT as verified until the required hosted smoke and publication gates have actually occurred. No deferred v0.1 architecture should be pulled into the release merely to clear these gates.
