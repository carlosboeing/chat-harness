# vNext versioned Specialist bundles

The new registry is in `src/specialists/definitions.ts`. It defines the 12 approved first-party domain IDs: `business`, `career`, `dev`, `education`, `finance`, `health`, `home`, `legal`, `shopping`, `tax`, `tech` and `travel`. `general`/mixed-use selects zero bundles, `research` is Core methodology, and `none` is a future CLI sentinel—not a Specialist.

Each bundle has a monotonic integer version, typed label/summary, managed Workspace fragment, and optional managed Procedures, capability declarations and additive scaffold paths. Sections compose in lexical ID order. Technology & IT is about **using/configuring** technology; Software Development is about **building/shipping** software.

Editable Markdown sources are in `src/specialists/assets/`. Run `bun scripts/generate-specialist-assets.ts` after changing them. This deterministically produces `src/specialists/embedded-assets.ts`, whose exact text strings are bundled into both Node/npm and standalone binary releases without a runtime source checkout. Run `bun scripts/generate-specialist-assets.ts --check` to catch stale generation. Version numbers change only when effective installed content or declared behavior changes.

Shopping includes two managed Procedures (product research and deal/channel optimization); Career **recommends**, but does not require, `linkedin.job.lookup`. Capability declarations never install tools or grant access, and a Procedure marker alone does not confer manifest ownership.

**Implementation boundary:** This is an isolated PR B registry. The existing v0.3.7-style singular `--specialist` CLI and its seed definitions remain functional until the validated manifest-aware reconciliation and planned CLI cutover. The registry does not authorize destructive Workspace changes, automatic migration, purchases, bookings, privileged connections or uploads.
