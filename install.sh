#!/bin/sh
set -eu

REPO="carlosboeing/chat-harness"
VERSION="${CHAT_HARNESS_VERSION:-latest}"
INSTALL_DIR="${CHAT_HARNESS_INSTALL_DIR:-$HOME/.local/bin}"

os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
  Darwin) platform="darwin" ;;
  Linux) platform="linux" ;;
  *) echo "Unsupported OS: $os" >&2; exit 1 ;;
esac

case "$arch" in
  x86_64|amd64) machine="x64" ;;
  arm64|aarch64) machine="arm64" ;;
  *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
esac

asset="chat-harness-${platform}-${machine}"
if [ "$VERSION" = "latest" ]; then
  base="https://github.com/$REPO/releases/latest/download"
else
  case "$VERSION" in v*) tag="$VERSION" ;; *) tag="v$VERSION" ;; esac
  base="https://github.com/$REPO/releases/download/$tag"
fi

tmp="$(mktemp -d)"
stage=""
metadata_tmp=""
helper_stage=""
helper_checksum_stage=""
helper_suffix=".macos-safe-move"
have_helper=0
cleanup() {
  rm -rf "$tmp"
  [ -z "$stage" ] || rm -f "$stage"
  [ -z "$metadata_tmp" ] || rm -f "$metadata_tmp"
  [ -z "$helper_stage" ] || rm -f "$helper_stage"
  [ -z "$helper_checksum_stage" ] || rm -f "$helper_checksum_stage"
}
trap cleanup EXIT INT TERM

curl -fsSL "$base/$asset" -o "$tmp/$asset"
curl -fsSL "$base/$asset.sha256" -o "$tmp/$asset.sha256"

if [ "$platform" = "darwin" ]; then
  # Must be present in the release. Never compile or fetch source on the user Mac.
  helper_asset="$asset$helper_suffix"
  have_helper=1
  curl -fsSL "$base/$helper_asset" -o "$tmp/$helper_asset"
  curl -fsSL "$base/$helper_asset.sha256" -o "$tmp/$helper_asset.sha256"
fi

verify_sha256() {
  item="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$tmp" && sha256sum -c "$item.sha256")
  elif command -v shasum >/dev/null 2>&1; then
    expected="$(awk '{print $1}' "$tmp/$item.sha256")"
    actual="$(shasum -a 256 "$tmp/$item" | awk '{print $1}')"
    [ "$expected" = "$actual" ] || { echo "Checksum verification failed for $item" >&2; exit 1; }
  else
    echo "sha256sum or shasum is required for checksum verification" >&2
    exit 1
  fi
}

verify_sha256 "$asset"
if [ "$platform" = "linux" ]; then
  helper_suffix=".linux-safe-move"
  helper_asset="$asset$helper_suffix"
  if curl -fsSL "$base/$helper_asset" -o "$tmp/$helper_asset" && curl -fsSL "$base/$helper_asset.sha256" -o "$tmp/$helper_asset.sha256"; then
    have_helper=1
  else
    # Preserve installation of historical pre-v1 Linux releases. A stable v1
    # release must contain its precompiled helper; never compile at install.
    chmod 0755 "$tmp/$asset"
    installed_version="$("$tmp/$asset" --version)"
    case "$installed_version" in 0.*) ;; *) echo "Required Linux native helper missing" >&2; exit 1 ;; esac
  fi
fi
if [ "$have_helper" = 1 ]; then
  verify_sha256 "$helper_asset"
fi

mkdir -p "$INSTALL_DIR"
destination="$INSTALL_DIR/chat-harness"
if [ "$have_helper" = 1 ]; then
  helper_stage="$INSTALL_DIR/.chat-harness-helper-install.$$"
  helper_checksum_stage="$INSTALL_DIR/.chat-harness-helper-sha-install.$$"
  install -m 0755 "$tmp/$helper_asset" "$helper_stage"
  (
    umask 077
    helper_digest="$(awk '{print $1}' "$tmp/$helper_asset.sha256")"
    printf '%s  chat-harness%s\n' "$helper_digest" "$helper_suffix" > "$helper_checksum_stage"
  )
  # Companion first; an interrupted install leaves an invalid/missing helper
  # fail-closed rather than permitting destructive filesystem operations.
  mv -f "$helper_stage" "$INSTALL_DIR/chat-harness$helper_suffix"
  helper_stage=""
  mv -f "$helper_checksum_stage" "$INSTALL_DIR/chat-harness$helper_suffix.sha256"
  helper_checksum_stage=""
fi

stage="$INSTALL_DIR/.chat-harness-install.$$"
install -m 0755 "$tmp/$asset" "$stage"
mv -f "$stage" "$destination"
stage=""

metadata="$INSTALL_DIR/.chat-harness-install.json"
metadata_tmp="$metadata.tmp.$$"
(
  umask 077
  printf '%s\n' '{"schema":1,"channel":"standalone"}' > "$metadata_tmp"
)
mv -f "$metadata_tmp" "$metadata"
metadata_tmp=""

echo "Installed chat-harness to $destination"
