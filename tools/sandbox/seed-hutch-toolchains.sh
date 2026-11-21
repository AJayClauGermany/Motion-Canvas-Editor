#!/usr/bin/env bash
# Pre-seed Hutch's managed Bun toolchain in the Claude Code cloud sandbox.
# Hutch hardcodes https://github.com/oven-sh/bun/releases/... and its Zig HTTP
# client cannot use the sandbox proxy, so we download with curl (proxy-aware)
# into the layout Hutch expects: $HUTCH_HOME/toolchains/bun/<ver>/<platform>/{bun,.hutch-toolchain}
# Usage: tools/sandbox/seed-hutch-toolchains.sh [bun-version]   (default 1.4.4)
set -euo pipefail
ver="${1:-1.4.4}"
home="${HUTCH_HOME:-$HOME/.hutch}"
case "$(uname -m)" in aarch64|arm64) arch=aarch64; key=linux-arm64 ;; *) arch=x64; key=linux-x64 ;; esac
root="$home/toolchains/bun/$ver/$key"
if [ -x "$root/bun" ] && [ "$(cat "$root/.hutch-toolchain" 2>/dev/null)" = "$ver" ]; then
  echo "bun $ver toolchain already seeded at $root"; exit 0
fi
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
curl -fsSL -o "$tmp/bun.zip" "https://github.com/oven-sh/bun/releases/download/bun-v$ver/bun-linux-$arch.zip"
python3 -I -c 'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$tmp/bun.zip" "$tmp/x"
mkdir -p "$root"
install -m 0755 "$tmp"/x/*/bun "$root/bun"
printf '%s' "$ver" > "$root/.hutch-toolchain"
"$root/bun" --version
echo "seeded bun $ver toolchain at $root"
