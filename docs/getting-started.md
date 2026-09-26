# Getting started

This guide is for people who want the benefits of Chat Harness without needing to understand its internal architecture first.

A **Workspace** is simply the folder you want your AI assistant to work with over time. Chat Harness adds a small set of instruction and state files inside that folder so work is easier to resume, verify, and maintain.

This guide uses **ChatGPT Projects + Google Drive** because that is the current reference setup.

## What you will do

1. install Chat Harness;
2. run setup inside your project folder;
3. review what Chat Harness will create;
4. connect that folder to a ChatGPT Project;
5. copy the generated Chat Harness instructions into Project Instructions;
6. start using the Project.

The local CLI cannot complete the ChatGPT website steps for you, so setup finishes with clear manual instructions.

## 1. Install Chat Harness

### macOS or Linux

Open Terminal and run:

```bash
curl -fsSL https://raw.githubusercontent.com/carlosboeing/chat-harness/main/install.sh | sh
```

### Windows PowerShell

Open PowerShell and run:

```powershell
irm https://raw.githubusercontent.com/carlosboeing/chat-harness/main/install.ps1 | iex
```

### npm

If you already use Node.js 22.12 or newer:

```bash
npm install -g chat-harness
```

Then verify the installed version:

```bash
chat-harness --version
```

If you installed Chat Harness previously with npm, update it with:

```bash
npm install -g chat-harness@latest
```

## 2. Open your Workspace folder in Terminal

Choose the folder you want ChatGPT to use for this project.

If you are using Google Drive, put the folder somewhere in Google Drive so ChatGPT can later access the same files.

Then open that folder in your terminal.

### macOS tip

In Terminal, type `cd ` including the space, then drag the folder from Finder into the Terminal window and press Return.

For example:

```bash
cd "/Users/you/Google Drive/Travel"
```

You do not need to type the folder path into later Chat Harness commands when you run them from inside the folder.

## 3. Run setup

For the easiest first-time experience, run:

```bash
chat-harness setup
```

Interactive setup asks what you mainly use the Workspace for, for example travel, shopping, career, or technology.

You can also choose directly:

```bash
chat-harness setup --specialist travel
```

Before Chat Harness creates optional folders or replaces an existing managed file, it shows what the choice means. Before writing the final plan, it shows the exact files and folders it will create or replace.

Existing content not listed in the plan is left unchanged.

## 4. Understand what was created

A normal Workspace contains:

```text
Your folder/
├── AGENTS.md
├── _inbox/
└── .chat-harness/
    ├── WORKSPACE.md
    ├── README.md
    ├── source-policy.yaml
    ├── workstreams/
    ├── workbench/
    ├── procedures/
    └── temp/
```

The two files most useful to understand at first are:

- **`AGENTS.md`** — the generic Chat Harness instructions for the AI assistant.
- **`.chat-harness/WORKSPACE.md`** — guidance specific to what this Workspace is for.

You can customize `WORKSPACE.md` later. Chat Harness manages recognized `AGENTS.md` files so generic instructions can be refreshed by future versions.

## 5. Connect the Workspace to ChatGPT

Creating the files does not automatically configure ChatGPT. There are two manual steps.

### Step A — add the Google Drive folder as a Project source

1. Open ChatGPT and create or open the Project you want to use.
2. Find the Project's **Sources** area.
3. Choose **Add source** or the equivalent option.
4. Paste the link to the Google Drive folder containing this Workspace.
5. If ChatGPT asks you to connect Google Drive, sign in to the Google account that can access the folder and approve the requested access.

OpenAI currently documents Google Drive **files and folders** as supported Project source links. Availability can still depend on your plan, region, workspace settings, and Google permissions.

### Step B — add the Chat Harness instructions

1. In the ChatGPT Project, open the **•••** menu.
2. Choose **Project settings**.
3. Open the generated `AGENTS.md` file in your Workspace.
4. Copy **the entire file**.
5. Paste it into **Project Instructions**.
6. Save the Project settings.

Do not copy only part of `AGENTS.md`, and do not merge the specialist text from `WORKSPACE.md` into Project Instructions.

The official OpenAI Projects guide currently shows **Project settings** in the Project menu:

![Official OpenAI screenshot showing Project settings in a ChatGPT Project](https://images.ctfassets.net/j22is2dtoxu1/intercom-img-dfd7518cb9b5ab4588cb814d/6ca9c53aec99d74eda875f16468276a2/Screenshot_2026-02-24_at_11.48.11%C3%A2__AM.png)

*Official OpenAI Help Center screenshot. ChatGPT's interface can change; follow the labels in the written instructions if your layout looks different.*

For the latest ChatGPT UI details, see OpenAI's [Projects in ChatGPT](https://help.openai.com/en/articles/10169521-projects-in-chatgpt) and [Google Drive app setup](https://help.openai.com/en/articles/10929079-google-drive-app-and-setup-in-chatgpt).

## 6. Check the Workspace

These commands do not change your files:

```bash
chat-harness validate
chat-harness doctor
```

- `validate` checks the Chat Harness file and Workstream contracts.
- `doctor` checks local Workspace health and installation prerequisites.

If both look healthy, the local side is ready.

## 7. Start using the Project

Open a new conversation inside the configured ChatGPT Project and work normally.

For example, in a travel Workspace:

> Help me plan a two-week family trip to Japan. Start by checking whether this continues any existing work in the Workspace, then help me work out the main itinerary.

Chat Harness is designed to make the assistant retrieve the right durable state as work becomes substantial. You do not need to manually mention every internal Chat Harness file in normal conversations.

## Common questions

### Do I have to pass a folder path to every command?

No. The normal pattern is:

```bash
cd /path/to/your/project
chat-harness setup
chat-harness validate
chat-harness doctor
```

The optional `[path]` argument is only needed when you want to target another existing directory.

### Does Chat Harness search parent folders automatically?

No. If no path is supplied, the current directory is the Workspace.

### Can setup reorganize my existing files?

No. Optional domain scaffolding only creates exact missing folders. Chat Harness does not move, rename, merge, or fuzzy-match your existing domain content.

### What if setup finds an existing AGENTS.md or WORKSPACE.md?

Interactive setup explains the situation before any destructive choice. Existing user-owned files are preserved by default; replacement requires explicit approval.

### Where can I see every CLI option?

See the [CLI reference](cli.md) or run:

```bash
chat-harness --help
chat-harness setup --help
```

## Next reading

- [CLI reference](cli.md)
- [Specialists](specialists.md)
- [ChatGPT setup](hosts/chatgpt.md)
- [Concepts](concepts.md)
- [Architecture](architecture.md)
