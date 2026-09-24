export const AGENTS_TEMPLATE = `# Chat Harness Project Instructions

Use \`.chat-harness/README.md\` as the Workspace Map for source-of-truth routing.

For substantial ongoing work:

- orient from the relevant file in \`.chat-harness/workstreams/\`;
- retrieve only the additional sources needed for the current objective;
- keep working state separate from canonical domain records;
- persist material decisions, state changes, unresolved issues, and an explicit next action;
- preserve user-owned content and request approval before consequential external actions.

Do not treat conversation history or model memory as canonical project state.
`;

export const WORKSPACE_MAP_TEMPLATE = `# Workspace Map

This file is user-owned after setup. Describe where authoritative information lives and how the assistant should route to it.

## Harness state

- Current resumable work: \`.chat-harness/workstreams/\`

## Domain sources

Add the existing files, folders, repositories, connected apps, or external authorities that own domain truth. Do not reorganize the Workspace merely to fit Chat Harness.
`;
