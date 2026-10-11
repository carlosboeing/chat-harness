#!/bin/bash
set -euo pipefail

# Runs only on macOS GitHub Actions with the system toolchain.
if [[ "$(uname -s)" != Darwin ]]; then
  echo "This proof is macOS-only" >&2
  exit 2
fi
root="$(cd "$(dirname "$0")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cc -std=c11 -Wall -Wextra -D GATE0_TEST_HOOKS "$root/native/macos/gate0-safe-move.c" -o "$tmp/gate0"
bin="$tmp/gate0"
mkdir -p "$tmp/work"
cd "$tmp/work"
hash() { shasum -a 256 "$1" | awk '{print $1}'; }
fail() { echo "FAIL: $*" >&2; exit 1; }

# Move to independent backup and non-overwriting restore.
printf 'original\n' > managed.md
digest="$(hash managed.md)"
"$bin" move "$PWD" managed.md backup.md "$digest"
[[ ! -e managed.md && -f backup.md ]] || fail "move state"
"$bin" restore "$PWD" backup.md managed.md "$digest"
[[ -f managed.md && ! -e backup.md ]] || fail "restore state"
[[ "$(hash managed.md)" == "$digest" ]] || fail "restore bytes"

# Already occupied destination must NEVER be overwritten.
printf 'keep this\n' > backup.md
if "$bin" move "$PWD" managed.md backup.md "$digest"; then fail "backup collision accepted"; fi
[[ "$(cat backup.md)" == 'keep this' ]] || fail "existing backup overwritten"
[[ "$(hash managed.md)" == "$digest" ]] || fail "source lost on collision"
rm backup.md

# Wrong hash or symlink source must never be moved.
if "$bin" move "$PWD" managed.md backup.md "$(printf '0%.0s' {1..64})"; then fail "wrong digest accepted"; fi
[[ -f managed.md && ! -e backup.md ]] || fail "digest conflict mutated"
ln -s managed.md redirect.md
if "$bin" move "$PWD" redirect.md backup.md "$digest"; then fail "symlink leaf accepted"; fi
[[ -L redirect.md && ! -e backup.md ]] || fail "symlink conflict mutated"

# A symlinked parent leaf is refused, not traversed.
cd "$tmp"
ln -s work linked
if "$bin" move "$tmp/linked" managed.md backup.md "$digest"; then fail "parent symlink accepted"; fi
cd "$tmp/work"

# No-replace stage promotion, including an intervening created file.
printf 'new\n' > stage.md
stage_digest="$(hash stage.md)"
printf 'intervening\n' > managed-destination.md
if "$bin" promote "$PWD" stage.md managed-destination.md "$stage_digest"; then fail "occupied promotion accepted"; fi
[[ "$(cat managed-destination.md)" == 'intervening' && -f stage.md ]] || fail "promotion clobbered"
rm managed-destination.md
"$bin" promote "$PWD" stage.md managed-destination.md "$stage_digest"
[[ ! -e stage.md && "$(hash managed-destination.md)" == "$stage_digest" ]] || fail "promotion result"

# Deterministic accidental writer after precheck, before atomic move:
# the moved backup's *post-move* digest mismatches, and the newer source
# content is moved back with RENAME_EXCL rather than deleted/overwritten.
printf 'before concurrency\n' > racing.md
raced_digest="$(hash racing.md)"
GATE0_TEST_DELAY_US=700000 "$bin" move "$PWD" racing.md racing.backup "$raced_digest" > "$tmp/race.log" 2>&1 &
pid=$!
sleep 0.20
printf 'edited by another process\n' > racing.md
if wait "$pid"; then fail "concurrent changed source incorrectly accepted"; fi
[[ -f racing.md && ! -e racing.backup ]] || fail "race did not restore safely"
[[ "$(cat racing.md)" == 'edited by another process' ]] || fail "racing bytes were lost"

echo "PASS: macOS native no-replace move, backup, restore, collision, symlink and race spike"
