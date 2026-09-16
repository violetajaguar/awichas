#!/usr/bin/env bash
# Bring a new/updated animal model into the app.
#   bash tools/import-model.sh path/to/monkey.blend monkey     # export from Blender, optimise, install
#   bash tools/import-model.sh path/to/monkey.glb monkey       # already a GLB: optimise, install
# Result: public/models/<animal>.glb (meshopt-compressed, WebP textures), and the clip names are printed
# so you can set clip / handClip in src/animals.js.
set -euo pipefail
cd "$(dirname "$0")/.."
src="$1"; animal="$2"
tmp=$(mktemp -d)
case "$src" in
  *.blend)
    echo "exporting from Blender…"
    blender -b "$src" --python tools/blender-export.py -- "$tmp/raw.glb" >"$tmp/blender.log" 2>&1 || { tail -20 "$tmp/blender.log"; exit 1; }
    raw="$tmp/raw.glb" ;;
  *.glb|*.gltf) raw="$src" ;;
  *) echo "expected a .blend or .glb file"; exit 1 ;;
esac
echo "optimising…"
npx --no-install gltf-transform optimize "$raw" "public/models/$animal.glb" \
  --compress meshopt --texture-compress webp --texture-size 2048 --simplify false --join false --flatten false --prune true >"$tmp/optimize.log" 2>&1 || { tail -20 "$tmp/optimize.log"; exit 1; }
echo "installed public/models/$animal.glb ($(du -h "public/models/$animal.glb" | cut -f1)); clips:"
npx --no-install gltf-transform inspect "public/models/$animal.glb" 2>/dev/null | awk '/ANIMATIONS/{f=1} f&&/│/{print}' | head -20
