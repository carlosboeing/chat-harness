# Compatibility

Chat Harness tracks host compatibility by **capability and evidence**, not by a speculative vendor-version matrix.

Status meanings:

- **documented** — current vendor documentation says the relevant host capability exists;
- **verified** — Chat Harness has exercised the exact path in a real smoke/eval scenario;
- **unverified** — the architecture may map, but no tested support claim is made.

## ChatGPT web

| Field | Current record |
|---|---|
| Status | **documented**; end-to-end Chat Harness binding **unverified** |
| Surface | ChatGPT web, Projects |
| Reference role | v0.1 first-class host |
| Canonical instructions | `AGENTS.md` in the Workspace, reached through a narrow Project Instructions binding |
| Context path | Project sources and connected apps; Google Drive files/folders can be added as project sources or accessed through the connected app |
| Last documentation check | 2026-09-24 |
| Release verification | Pending Phase 9 real-host smoke |

Current OpenAI documentation says Project Instructions are scoped to the project and override global custom instructions. It also documents adding Google Drive files/folders and Slack channels as Project sources and using connected apps from project chats. Google Drive added inside a Project is accessed on demand rather than pre-synced.

That documents the primitives needed for the binding. It does **not** prove that the Chat Harness `AGENTS.md` bootstrap, Workstream recovery, Source Policy-aware cross-context behaviour, and persistence loop are effective end-to-end.

Material limitations:

- app/source availability varies by plan, region, surface, workspace settings, and connected-account permissions;
- personal/individual Google Drive connections provide live access rather than a personal synced index;
- `doctor` cannot introspect hidden server-side feature flags or entitlement state;
- Source Policy on host-native retrieval is policy-aware behaviour where Chat Harness does not control the underlying read boundary.

Authoritative references:

- https://help.openai.com/en/articles/10169521-projects-in-chatgpt
- https://help.openai.com/en/articles/10929079-google-drive-app-and-setup-in-chatgpt
- https://help.openai.com/en/articles/20001052

## Claude and other assistants

Status: **unverified**.

The architecture deliberately uses portable concepts, but v0.1 does not claim tested Claude or other-host integration merely because similar primitives exist.

## Reverification policy

Reverify when preparing a release where the claim matters, after a material vendor change, when a user reports a regression, when a host smoke fails, or before adding a new support claim.

Chat Harness semver versions Chat Harness software/contracts, not hosted product releases.
