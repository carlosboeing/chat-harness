# Specialists

Specialists are versioned setup-time bundles, not agents. Their managed guidance is composed into `.chat-harness/WORKSPACE.md` in lexical ID order. General or mixed use is Core only: zero Specialists. Research methodology belongs to Core.

```bash
chat-harness setup --specialists travel,shopping
chat-harness setup --specialists "finance, tax,finance"
chat-harness setup --specialists none
```

Selection is an exact desired set: whitespace is trimmed and duplicate IDs collapse. `none` must appear alone. Omitted selection preserves the installed set; fresh non-interactive setup defaults to Core only. Interactive setup preselects installed bundles and offers a multiselect plus General / mixed use as an exclusive empty selection.

| ID | Domain | Optional additive folders |
|---|---|---|
| `business` | Business & Entrepreneurship | None |
| `career` | Career | `Opportunities/`, `Profile/` |
| `dev` | Software Development | `Projects/` |
| `education` | Education & Learning | None |
| `finance` | Finance | `Finance/` |
| `health` | Health | None |
| `home` | Home & Property | None |
| `legal` | Legal | None |
| `shopping` | Shopping | `Purchases/`, `Research/` |
| `tax` | Tax | `Tax/` |
| `tech` | Technology & IT | None |
| `travel` | Travel | `Trips/` |

Choose `tech` for selecting, configuring and troubleshooting devices, services, networks and AI products. Choose `dev` for building software, APIs, MCP servers and agentic systems. They are selected by the objective, not by a runtime router.

Shopping owns two manifest-recorded Procedures under `.chat-harness/procedures/`: `shopping-research-methodology.md` and `deal-discovery-and-channel-optimization.md`. Deselecting Shopping removes these only when their exact last-applied bytes still match. Unknown files and changed Procedures are preserved and cause conflicts.

Career recommends `linkedin.job.lookup`; it does not install or require it. Doctor reports missing local verification as a warning. Capability declarations grant no new permissions.

Customize only the suffix after `<!-- chat-harness-user: workspace -->`. Setup preserves that suffix byte-for-byte, regenerates the managed prefix, and rejects malformed/duplicate markers. Unmarked instructions require `--adopt-workspace`; adoption preserves the entire original byte sequence under the boundary. A marker alone never grants manifest ownership.

`--scaffold-domain` creates the union of missing selected-Specialist starter folders. These are user-owned, additive and never automatically removed.

Bundle content is embedded in Node/npm and standalone builds. Edit `src/specialists/assets/`, increment the affected integer component version when effective behavior changes, and regenerate/check with `bun scripts/generate-specialist-assets.ts`.
