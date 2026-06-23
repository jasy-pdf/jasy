#!/usr/bin/env bash
# Renders the showcase templates (examples/templates/*.ts) to PDFs + PNGs under examples/out/.
#   bash examples/render.sh              # all templates
#   bash examples/render.sh invoice      # just one
#   SKIP_BUILD=1 bash examples/render.sh invoice   # skip the @jasy/pdf rebuild (faster iteration)
set -euo pipefail
cd "$(dirname "$0")/.."

# Make "@jasy/pdf" + "@jasy/zugferd" resolve to this repo so templates read like real user code.
mkdir -p node_modules/@jasy
ln -sfn "$PWD" node_modules/@jasy/pdf
ln -sfn "$PWD/packages/zugferd" node_modules/@jasy/zugferd

[ "${SKIP_BUILD:-}" = "1" ] || { echo "==> building @jasy/pdf"; pnpm build >/dev/null; }

echo "==> rendering"
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON examples/render.ts "${1:-}"

echo "==> rasterising (150 dpi)"
if [ -n "${1:-}" ]; then pdfs="examples/out/$1.pdf"; else pdfs=examples/out/*.pdf; fi
for pdf in $pdfs; do
  [ -e "$pdf" ] || continue
  base="$(basename "$pdf" .pdf)"
  rm -f "examples/out/$base"-*.png # drop stale pages so a 2->1 page change can't leave a ghost PNG
  pdftoppm -png -r 150 "$pdf" "examples/out/$base"
done

echo "==> done:"
ls examples/out/*.png
