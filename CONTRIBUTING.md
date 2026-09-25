# Contributing

Chat Harness is intentionally small. Contributions should solve a demonstrated problem without turning the project into a generic agent platform.

## Development

Requirements:

- Bun 1.4.2+
- Git

Run the local gates:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run validate
bun run validate:docs
bun run validate:evals
bun run test
```

Browser-runtime changes should also run:

```bash
bunx playwright install --with-deps --only-shell chromium
bun run smoke:browser
```

## Design rules

Prefer:

- host-before-framework;
- evidence-before-abstraction;
- narrow typed capabilities over generic power;
- incremental changes with deterministic tests;
- existing domain/source ownership over copied canon.

Do not add a provider hierarchy, model abstraction, workflow engine, generic browser/shell/HTTP capability, Workspace backend interface, or migration subsystem without real implementation pressure and design review.

Public copy must preserve the positioning in the root README and current architecture terminology.

## Pull requests

Keep changes coherent and explain:

- the real workflow/failure motivating the change;
- the contract affected;
- security/authority implications;
- deterministic evidence added;
- any compatibility claim that needs current host verification.

Do not include private workspace data, secrets, production credentials, or model chain-of-thought in fixtures or logs.


## Releases

The normal release path is a release pull request, not a manually pushed tag.

A release PR must:

- increase the stable `x.y.z` version in `package.json`;
- add matching release notes at `docs/releases/vx.y.z.md`;
- pass the normal protected-main checks.

When that PR merges to `main`, `.github/workflows/release.yml` compares the new package version with the previous `main` commit. Ordinary merges with no version change are explicit no-ops. A coherent version bump causes the workflow to qualify the exact merge commit, build and smoke the standalone and npm artifacts, create the matching Git tag, publish to npm through trusted publishing/OIDC, create the GitHub Release, and smoke the installed registry artifact.

The tag-push trigger remains as a recovery/maintainer escape hatch. Do not normally push release tags by hand.

A manual `workflow_dispatch` run is build/qualification-only and never publishes.
