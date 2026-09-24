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
