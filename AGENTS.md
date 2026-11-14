# Chat Harness contributor guidance

Follow [CONTRIBUTING.md](CONTRIBUTING.md) for contribution scope, checks and release procedures.

## Project Map

- **Public repository**. Source code, tests, templates, and public product documentation in `docs/`. Use GitHub issues and pull requests for public coordination.
- **Engineering working memory**. When a separate private checkout is present at `.workbench/`, follow its own contributor instructions for new engineering lifecycle records. Verify that `git check-ignore .workbench/` reports the path before editing there. Commit public and private files separately. With only the public checkout, use issues and pull requests for engineering discussion.

Installed Workspaces own their live Workstreams. For product behavior and layout, see the [Workspace documentation](README.md#how-a-workspace-works).
