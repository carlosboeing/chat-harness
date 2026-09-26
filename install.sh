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
cleanup() {
  rm -rf "$tmp"
  [ -z "$stage" ] || rm -f "$stage"
  [ -z "$metadata_tmp" ] || rm -f "$metadata_tmp"
}
trap cleanup EXIT INT TERM

curl -fsSL "$base/$asset" -o "$tmp/$asset"
curl -fsSL "$base/$asset.sha256" -o "$tmp/$asset.sha256"

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$tmp" && sha256sum -c "$asset.sha256")
elif command -v shasum >/dev/null 2>&1; then
  expected="$(awk '{print $1}' "$tmp/$asset.sha256")"
  actual="$(shasum -a 256 "$tmp/$asset" | awk '{print $1}')"
  [ "$expected" = "$actual" ] || { echo "Checksum verification failed" >&2; exit 1; }
else
  echo "sha256sum or shasum is required for checksum verification" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
destination="$INSTALL_DIR/chat-harness"
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
