# Compatibility

Chat Harness tracks host compatibility by **capability and evidence**, not by a speculative vendor-version matrix.

Status meanings:

- **documented** — current vendor documentation says the relevant host capability exists;
- **verified** — Chat Harness has exercised the exact path in a real smoke/eval scenario;
- **unverified** — the architecture may map, but no tested support claim is made.

## ChatGPT Projects

| Field | Current record |
|---|---|
| Status | **documented**; end-to-end Chat Harness binding **unverified** |
| Surface | ChatGPT Projects |
| Reference role | Reference hosted binding |
| Canonical generic instructions | Root `AGENTS.md`, copied in full to Project Instructions |
| Workspace-specific instructions | `.chat-harness/WORKSPACE.md`, retrieved from the Workspace |
| Context path | Project sources and connected apps, including supported Google Drive files/folders |
| Last documentation check | 2026-09-26 |

Current OpenAI documentation says Project Instructions apply only inside the Project and override global custom instructions. It also documents adding supported Google Drive files/folders as Project sources and using connected apps from Project chats.

Google Drive added inside a Project can search and access relevant files on demand, but it is not a personal pre-synced index. Administrator-managed Drive sync is a separate capability for eligible managed workspaces.

These primitives support the Chat Harness binding, but vendor documentation alone does **not** prove that the full Chat Harness recovery and persistence loop works end-to-end.

Material limitations:

- app/source availability varies by plan, region, surface, workspace settings, and connected-account permissions;
- personal/individual Google Drive connections provide live access rather than a personal synced index;
- `doctor` cannot introspect hidden server-side feature flags or entitlement state;
- Source Policy on host-native retrieval is policy-aware behavior where Chat Harness does not control the underlying read boundary.

Authoritative references:

- https://help.openai.com/en/articles/10169521-projects-in-chatgpt
- https://help.openai.com/en/articles/10929079-google-drive-app-and-setup-in-chatgpt
- https://help.openai.com/en/articles/11487775-connected-apps-in-chatgpt

See [ChatGPT host binding](hosts/chatgpt.md) for setup.

## Claude and other assistants

Status: **unverified** unless a specific host path has been exercised and recorded.

The architecture deliberately uses portable concepts. A host that can consume `AGENTS.md` directly may not need the ChatGPT copy step, but similar primitives alone do not establish tested support.

## Reverification policy

Reverify after a material host change, when a user reports a regression, when a host smoke fails, or before making a stronger support claim.

Chat Harness versions its own software and contracts, not hosted product releases.
