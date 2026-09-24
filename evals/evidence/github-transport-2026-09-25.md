# GitHub transport smoke — 2026-09-25

Status: **passed**

This is release-qualification evidence for the concrete v0.1 GitHub-backed Chat Harness extension path.

- repository state: private `main`
- merge commit: `3f5921d4ff8624eaed74c0514b7bbb5d851ad138`
- issue: `#20`
- workflow run: `36013831053`
- capability: `linkedin.job.lookup`
- fixture: public LinkedIn job ID `4468897387`
- request id: `v0.1-release-smoke-2026-09-25`
- authority/data profile: public, no credentials, read-only, persistent transport allowed
- workflow conclusion: success
- capability outcome: `ok: true`, `EXACT_VERIFIED`
- identity evidence: requested and observed job IDs both `4468897387`
- transport outcome: structured `CAPABILITY_RESULT` comment posted; issue closed with reason `completed`

The smoke used no private account data, cookies, credentials or caller-controlled network destination. It proves the actual default-branch Issue → Actions → dispatcher → capability → structured comment → close path, not only the local dispatcher contract.

This evidence does not change the separate ChatGPT host-binding status, which remains unverified until exercised through a configured ChatGPT Project.
