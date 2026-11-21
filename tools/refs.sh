#!/usr/bin/env bash
# Shallow-clone upstream sources + docs into .refs/ (gitignored) so agents can
# grep current docs/source offline. Re-run to update. Works anywhere git works.
#   tools/refs.sh            # clone or update all
#   tools/refs.sh civet      # just one
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .refs
declare -A REPOS=(
  [electrobun]=https://github.com/blackboardsh/electrobun.git      # docs/src/content/docs, templates/, package/src/ui-core
  [hutch]=https://github.com/blackboardsh/hutch.git                # Electrobun 2 build CLI (Zig)
  [canvas-commons]=https://github.com/canvas-commons/canvas-commons.git  # packages/docs/docs, packages/*/src
  [civet]=https://github.com/DanielXMoore/Civet.git                # civet.dev/*.md, source/
  # Cross-reference only (prior art; not dependencies):
  [motion-canvas]=https://github.com/motion-canvas/motion-canvas.git     # upstream of Canvas Commons; packages/docs/docs
  [manim]=https://github.com/ManimCommunity/manim.git              # Manim Community: docs/source (rst), manim/ (API docstrings)
  [manimgl]=https://github.com/3b1b/manim.git                      # 3Blue1Brown's ManimGL: docs/source, manimlib/
)
names=("$@"); [ ${#names[@]} -eq 0 ] && names=("${!REPOS[@]}")
for n in "${names[@]}"; do
  url="${REPOS[$n]:?unknown ref: $n}"
  if [ -d ".refs/$n/.git" ]; then
    git -C ".refs/$n" fetch -q --depth 1 origin HEAD && git -C ".refs/$n" reset -q --hard FETCH_HEAD
  else
    git clone -q --depth 1 "$url" ".refs/$n"
  fi
  echo "$n @ $(git -C ".refs/$n" log -1 --format='%h %cs')"
done
