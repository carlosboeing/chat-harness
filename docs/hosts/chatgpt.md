# Connect Chat Harness to ChatGPT

This guide walks through the manual steps needed after `chat-harness setup`.

The CLI creates the Chat Harness files in your Workspace, but it **cannot configure the ChatGPT website for you**. To finish connecting the Workspace to a ChatGPT Project, you need to:

1. add the Workspace's Google Drive folder as a Project source;
2. copy the generated `AGENTS.md` into Project Instructions.

For a complete first-time walkthrough, start with [Getting started](../getting-started.md).

## Before you start

You need:

- a Chat Harness Workspace;
- the Workspace folder available in Google Drive;
- a ChatGPT Project;
- a Google account that can access the Workspace folder.

OpenAI currently documents Google Drive files and folders as supported Project source links. Availability can vary by ChatGPT plan, region, workspace settings, connected-account permissions, and Google Workspace policy.

Current OpenAI references:

- [Projects in ChatGPT](https://help.openai.com/en/articles/10169521-projects-in-chatgpt)
- [Google Drive app and setup in ChatGPT](https://help.openai.com/en/articles/10929079-google-drive-app-and-setup-in-chatgpt)

These instructions were checked against OpenAI documentation on 2026-09-26.

## 1. Prepare the Workspace

From inside the folder:

```bash
chat-harness setup
```

Or choose a specialist directly:

```bash
chat-harness setup --specialist travel
```

When setup finishes successfully, it prints these ChatGPT connection steps again.

## 2. Add the Google Drive folder to the ChatGPT Project

First copy the Google Drive link for the folder that contains the Workspace.

Then in ChatGPT:

1. create or open the Project you want to use;
2. find the Project's **Sources** area;
3. choose **Add source** or the equivalent option;
4. paste the Google Drive folder link;
5. if prompted, connect Google Drive and approve access using the account that can see the folder.

OpenAI's current Projects documentation describes this flow for Google Drive file and folder links. It specifically documents adding app links from a private Project.

If you cannot see an Add source option or Google Drive cannot be connected, check your ChatGPT plan/workspace settings and Google permissions before changing the Chat Harness Workspace.

## 3. Add the Chat Harness instructions

The generated root `AGENTS.md` is the portable generic Chat Harness instruction source.

In your ChatGPT Project:

1. open the **•••** menu;
2. choose **Project settings**;
3. open `AGENTS.md` from your Workspace in a text editor;
4. copy **the entire file**;
5. paste it into **Project Instructions**;
6. save the Project settings.

The official OpenAI Projects guide currently shows **Project settings** in the Project menu:

![Official OpenAI screenshot showing Project settings in a ChatGPT Project](https://images.ctfassets.net/j22is2dtoxu1/intercom-img-dfd7518cb9b5ab4588cb814d/6ca9c53aec99d74eda875f16468276a2/Screenshot_2026-02-24_at_11.48.11%C3%A2__AM.png)

*Official OpenAI Help Center screenshot. ChatGPT's interface changes over time; follow the written labels if your layout looks different.*

Do **not** copy only selected sections of `AGENTS.md`. Do not merge specialist text from `.chat-harness/WORKSPACE.md` into Project Instructions.

`AGENTS.md` is the generic Chat Harness behavior. `WORKSPACE.md` stays in the Workspace and contains Workspace-specific judgement.

## 4. Check that ChatGPT can see the Workspace

Start a new chat inside the configured Project and ask something simple such as:

> Find `.chat-harness/WORKSPACE.md` in the Project's Google Drive source and tell me what kind of Workspace it describes. Do not change any files.

This is a practical host check, not part of `chat-harness validate` or `doctor`; the local CLI cannot inspect hosted Project configuration.

If ChatGPT cannot retrieve the file:

- confirm the correct Google Drive folder link was added;
- confirm the connected Google account can access that folder;
- confirm Google Drive is available for your ChatGPT plan/workspace;
- reconnect Google Drive if its permissions have changed.

## 5. Start using Chat Harness normally

Once the source and Project Instructions are configured, use the Project normally. You do not need to mention Chat Harness internals in every prompt.

For example:

> Help me plan our family trip to Japan. Check whether this continues any existing Workspace work before starting a new plan.

For substantial work, the Project Instructions direct ChatGPT to retrieve `WORKSPACE.md`, the Workspace Map, relevant Workstreams, Procedures, and authoritative sources selectively.

## When Chat Harness updates AGENTS.md

A future `chat-harness setup` may refresh a recognizably Chat Harness-managed `AGENTS.md`.

If that happens:

1. open the new complete `AGENTS.md`;
2. replace the existing ChatGPT Project Instructions with the complete current file.

Do not maintain a separate hand-edited minimal copy; `AGENTS.md` is the canonical generic instruction source.

## What the binding means

ChatGPT Project Instructions are a **binding** of the portable `AGENTS.md`, not a second source of truth.

The Workspace remains host-independent. The same Workspace can later be connected to another assistant without changing its core structure.

Google Drive access from an individual ChatGPT account is live, on-demand access rather than a personal synchronized index. Relevant files may therefore need to be retrieved when work requires them.

## Source Policy caveat

ChatGPT-native file/app retrieval is a host-native path. Chat Harness instructions require Source Policy-aware behavior, but Chat Harness cannot claim hard pre-read enforcement where it does not intercept retrieval.

For non-obvious cross-context use, the applicable privacy classification and approval/transparency rules still govern assistant behavior.

## Authority

Normal research and retrieval may proceed when safe and authorized. Consequential external actions still require explicit approval at the action boundary unless that action class was already authorized.

## Verification status

The ChatGPT binding remains **documented but unverified** until a real host scenario demonstrates that:

- the complete `AGENTS.md` binding materially affects behavior;
- Workspace Map and Workstream recovery work;
- a fresh-session continuation resumes from the current Next action;
- Source Policy/transparency behavior matches the documented contract;
- durable closeout state is persisted.

Vendor documentation establishes available host primitives; it does not by itself prove the complete Chat Harness behavioral binding.
