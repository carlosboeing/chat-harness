# From capability bridge to Chat Harness

Chat Harness evolved in place from `chatgpt-github-capability-bridge`, a small private implementation for invoking vetted external capabilities from ordinary ChatGPT Project chats through owner-gated GitHub Issues and Actions.

That concrete bridge established durable lessons: generic infrastructure can coexist with narrow domain capabilities; typed requests and structured failure states beat generic remote execution; capabilities need explicit authority/network/budget/lifecycle boundaries; one-off adapters should be disposable; and persistent transports are confidentiality/retention boundaries.

Using the bridge also exposed a broader problem: external tools were only one part of making substantial assistant work reliable. Long-running projects also needed explicit state, source ownership, context routing, recovery, validation, and durable handoff.

The repository therefore evolved through normal commits into Chat Harness rather than hiding the bridge history or creating an unrelated replacement repository. Git history remains the detailed chronology; current architecture lives in [../architecture.md](../architecture.md).
