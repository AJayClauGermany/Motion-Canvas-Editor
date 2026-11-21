#!/usr/bin/env bash
# One-shot, idempotent setup for the Claude Code cloud sandbox (Linux x64/arm64).
# Safe to re-run. Run from the repo root: tools/sandbox/setup.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
# 1. Runtime libs for Electrobun on Linux (webview + tray + svg) and a headless
#    display + software Vulkan so WebGPU/Dawn (Electrobun UI) works without a GPU.
if command -v apt-get >/dev/null && ! dpkg -s libwebkit2gtk-4.1-0 mesa-vulkan-drivers xvfb >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    libwebkit2gtk-4.1-0 libayatana-appindicator3-1 librsvg2-2 mesa-vulkan-drivers xvfb xauth imagemagick
fi
# 2. Hutch's Bun toolchain (Hutch can't download through the sandbox proxy itself).
tools/sandbox/seed-hutch-toolchains.sh "$(bun --version 2>/dev/null || echo 1.4.4)"
# 3. Upstream docs/source for offline grep.
tools/refs.sh
# 4. JS deps, if the project has a package.json yet.
[ -f package.json ] && bun install
echo "sandbox setup done"
