#!/bin/bash
set -euo pipefail
if [[ "$(uname -s)" != Darwin ]]; then echo "This proof is macOS-only" >&2; exit 2; fi
root="$(cd "$(dirname "$0")/../.." && pwd -P)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cc -std=c11 -Wall -Wextra -D GATE0_TEST_HOOKS "$root/native/macos/gate0-safe-move.c" -o "$tmp/gate0"
bin="$tmp/gate0"
mkdir -p "$tmp/work/.chat-harness/procedures"
workspace="$(cd -P "$tmp/work" && pwd -P)"
tmp_physical="$(cd -P "$tmp" && pwd -P)"
cd "$workspace"
hash() { shasum -a 256 "$1" | awk '{print $1}'; }
fail() { echo "FAIL: $*" >&2; exit 1; }
run() { "$bin" "$1" "$workspace" "$2" "$3" "$4" "$5"; }

# Normal backup and restore, anchored at root.
printf 'original\n' > managed.md
digest="$(hash managed.md)"
run move "." managed.md backup.md "$digest"
[[ ! -e managed.md && -f backup.md ]] || fail "move state"
run restore "." backup.md managed.md "$digest"
[[ -f managed.md && ! -e backup.md && "$(hash managed.md)" == "$digest" ]] || fail "restore state"

# Destination collision must be rejected atomically.
printf 'keep this\n' > backup.md
if run move "." managed.md backup.md "$digest"; then fail "backup collision accepted"; fi
[[ "$(cat backup.md)" == 'keep this' && "$(hash managed.md)" == "$digest" ]] || fail "clobber on collision"
rm backup.md

# Wrong digest, symlink source, absolute parent and traversal cannot be used.
if run move "." managed.md backup.md "$(printf '0%.0s' {1..64})"; then fail "wrong digest accepted"; fi
ln -s managed.md redirect.md
if run move "." redirect.md backup.md "$digest"; then fail "symlink leaf accepted"; fi
if run move "../" managed.md backup.md "$digest"; then fail "parent traversal accepted"; fi
[[ -f managed.md && -L redirect.md && ! -e backup.md ]] || fail "unsafe path mutated"

# Nested legitimate managed paths work.
cd "$workspace/.chat-harness/procedures"
printf 'shopping procedure\n' > shopping.md
shopping_digest="$(hash shopping.md)"
run move ".chat-harness/procedures" shopping.md shopping.backup "$shopping_digest"
[[ ! -e shopping.md && -f shopping.backup ]] || fail "nested move"
run restore ".chat-harness/procedures" shopping.backup shopping.md "$shopping_digest"
[[ "$(hash shopping.md)" == "$shopping_digest" ]] || fail "nested restore"

# A symlink anywhere in the Workspace root's absolute chain is rejected.
ln -s "$workspace" "$tmp_physical/linked-workspace"
if "$bin" move "$tmp_physical/linked-workspace" ".chat-harness/procedures" shopping.md shopping.backup "$shopping_digest"; then
  fail "symlinked absolute root accepted"
fi

# A symlink in the relative parent chain is rejected before touching a file.
ln -s "$workspace/.chat-harness" "$workspace/redirect-parent"
if run move "redirect-parent/procedures" shopping.md shopping.backup "$shopping_digest"; then
  fail "symlinked intermediate directory accepted"
fi
[[ -f shopping.md && ! -e shopping.backup ]] || fail "intermediate symlink mutated"

cd "$workspace"
# Non-overwriting promotion, including a destination appearing after stage verification.
printf 'new\n' > stage.md
stage_digest="$(hash stage.md)"
printf 'intervening\n' > destination.md
if run promote "." stage.md destination.md "$stage_digest"; then fail "occupied promotion accepted"; fi
[[ "$(cat destination.md)" == 'intervening' && -f stage.md ]] || fail "promotion clobbered"
rm destination.md
run promote "." stage.md destination.md "$stage_digest"
[[ ! -e stage.md && "$(hash destination.md)" == "$stage_digest" ]] || fail "promotion result"

# Deterministic in-place editor after precheck: post-move mismatch is restored.
printf 'before concurrency\n' > racing.md
raced_digest="$(hash racing.md)"
GATE0_TEST_DELAY_US=700000 "$bin" move "$workspace" "." racing.md racing.backup "$raced_digest" > "$tmp/race.log" 2>&1 &
pid=$!
sleep 0.20
printf 'edited by another process\n' > racing.md
if wait "$pid"; then fail "concurrent changed source incorrectly accepted"; fi
[[ -f racing.md && ! -e racing.backup ]] || fail "racing file not restored safely"
[[ "$(cat racing.md)" == 'edited by another process' ]] || fail "racing bytes lost"

# Different inode with identical content cannot be mistaken for the same file.
printf 'same bytes\n' > inode-race.md
inode_digest="$(hash inode-race.md)"
GATE0_TEST_DELAY_US=700000 "$bin" move "$workspace" "." inode-race.md inode.backup "$inode_digest" > "$tmp/inode.log" 2>&1 &
pid=$!
sleep 0.20
mv inode-race.md inode-original.md
cp inode-original.md inode-race.md
if wait "$pid"; then fail "same-byte source substitution accepted"; fi
[[ -f inode-race.md && ! -e inode.backup && -f inode-original.md ]] || fail "source substitution lost evidence"

# Inject SIGKILL after a completed no-replace move, before post-move verification.
printf 'interrupted original\n' > interrupted.md
interrupted_digest="$(hash interrupted.md)"
signal="$tmp_physical/native-moved.flag"
GATE0_TEST_AFTER_MOVE_SIGNAL="$signal" GATE0_TEST_AFTER_MOVE_DELAY_US=2000000 \
  "$bin" move "$workspace" "." interrupted.md interrupted.backup "$interrupted_digest" > "$tmp/killed.log" 2>&1 &
pid=$!
for _ in {1..100}; do
  [[ -f "$signal" ]] && break
  sleep 0.02
done
[[ -f "$signal" ]] || fail "never observed after-move signal"
kill -9 "$pid"
wait "$pid" 2>/dev/null || true
[[ ! -e interrupted.md && -f interrupted.backup ]] || fail "interrupted backup lost"
# Recovery is explicit, non-overwriting, and still requires a verified digest.
run restore "." interrupted.backup interrupted.md "$interrupted_digest"
[[ -f interrupted.md && ! -e interrupted.backup && "$(hash interrupted.md)" == "$interrupted_digest" ]] || fail "interrupted restore"

# If another file appears during recovery, preserve both copies and report a conflict.
run move "." interrupted.md interrupted.backup "$interrupted_digest"
printf 'other user file\n' > interrupted.md
if run restore "." interrupted.backup interrupted.md "$interrupted_digest"; then fail "recovery clobbered new file"; fi
[[ "$(cat interrupted.md)" == 'other user file' && -f interrupted.backup ]] || fail "conflict evidence discarded"

echo "PASS: macOS root-anchored move, nested paths, no-clobber, inode races and SIGKILL recovery proof"

# Separate disposable-Workspace journal proof; never used by installed CLI.
cd "$root"
GATE0_SPIKE_NATIVE="$bin" bun test tests/native/macos-journal-spike.test.ts

# Multi-file manifest-last, no-replace commit and deterministic rollback rehearsal.
# All paths are disposable test Workspaces; the installed CLI is not mutated.
GATE0_SPIKE_NATIVE="$bin" bun test tests/native/macos-multifile-recovery-spike.test.ts
