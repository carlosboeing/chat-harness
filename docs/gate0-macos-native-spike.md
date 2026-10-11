# Gate 0 macOS native helper — anchored feasibility spike

**Not a production reconciliation engine.** This helper is not built into the released CLI, nor called by setup/doctor/validate, and it never automatically modifies an existing Workspace.

## Focused personal-use contract

Practical protection against accidental edits, accidental overwrites, symlinked directories, uncoordinated file changes and a stopped process. It is not a security boundary against a malicious same-user actor and does not promise OS-crash/power-loss durability. The existing approved Design still governs release and cross-platform behavior.

## Interface

Compile on macOS: `cc -std=c11 -Wall -Wextra native/macos/gate0-safe-move.c -o gate0-safe-move`.

`gate0-safe-move move|promote|restore WORKSPACE_ROOT RELATIVE_PARENT SOURCE_BASE TARGET_BASE SHA256_HEX`

- `WORKSPACE_ROOT` must be an **absolute physical path** with no symlink in its ancestor chain. The native code descends from `/` with `openat(O_DIRECTORY|O_NOFOLLOW)` and keeps one verified descriptor per level.
- `RELATIVE_PARENT` is `.` for the Workspace root, or slash-separated real directories such as `.chat-harness/procedures`. A missing/symlinked/traversal segment is a conflict.
- The source and target must be simple leaf names in that same pinned directory; no cross-directory rename is attempted.
- Source bytes must match exact SHA-256 plus inode identity. `renameatx_np(RENAME_EXCL)` refuses to overwrite an already-occupied destination. Immediately after moving, the helper re-verifies both the digest and the original inode. A changed or substituted source is restored with another no-replace rename if possible, otherwise left at the target as conflict evidence.
- `move`, `promote` and `restore` are deliberately the same primitive; higher-level transaction decisions and authorization do not live in C.

## Verification

`bash tests/native/macos-gate0-spike.sh` runs on the macOS CI runner. It tests basic backup/restore, destination collisions, digest conflicts, symlinked leaf, symlinked Workspace root, symlinked intermediate parent, nested managed paths, exclusive stage promotion, a concurrent in-place editor, a different inode with identical content, and **SIGKILL after the move** with explicit no-replace restoration.

The SIGKILL test does not implement automatic recovery. It verifies a safe, observable state from which a future journal-guided reconciler can recover. If a different file appears at the source path, restoration fails without overwriting it, preserving the backup.

The pause/signal hooks are compiled **only** with `GATE0_TEST_HOOKS` for deterministic CI fault injection; production compilation has no such functionality.

## Remaining boundaries and decisions

- **No manifest-last multi-file transaction, durable commit signal, recovery journal, cleanup protocol or actual `setup` integration.**
- Not a complete solution for same-user malicious filesystem races: the input Workspace path can itself change after traversal, and directory entry aliases/case identity are subject to separate preflight and filesystem rules.
- Only a macOS prototype; neither Windows nor Linux compatibility is proven.
- No native-helper bundling/install policy for npm/standalone yet. Production packaging should not require a compiler at runtime.
- This spike alone does not close Gate 0 or permit destructive automation. A higher-level reconciler must verify manifest ownership/digests, refuse unsupported states, and journal transaction intent before invoking the helper.

Next: verify this latest spike in macOS CI, then design the smallest helper packaging and **one-file** journal-guided round trip in a disposable Workspace before attempting a multi-file upgrade. Keep existing Workspaces untouched.
