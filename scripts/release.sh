#!/bin/bash
set -e

# Release one package: bump its version, commit, tag, push. The pushed tag triggers the GitHub
# "Release" workflow, which builds (the package + its workspace deps) and publishes to npm.
#
# Usage:   ./scripts/release.sh <package> <version>
#   package = pdf | zugferd | cli   (pdf is the workspace ROOT)
#   version = semver, e.g. 0.1.0 or 0.1.0-alpha.1
#
# Release order matters (dependency chain): pdf -> zugferd -> cli. Release pdf first so that, when
# zugferd publishes, its `@jasy/pdf: workspace:*` resolves to the version pdf was just released at.

usage() {
  echo "Usage: ./scripts/release.sh <package> <version>"
  echo "  package: pdf | zugferd | cli"
  echo "  example: ./scripts/release.sh pdf 0.1.0"
  exit 1
}

PACKAGE="$1"
VERSION="$2"
[ -z "$PACKAGE" ] || [ -z "$VERSION" ] && usage

# package -> directory (pdf is the root package, the others live under packages/)
case "$PACKAGE" in
  pdf)     DIR="." ;;
  zugferd) DIR="packages/zugferd" ;;
  cli)     DIR="packages/cli" ;;
  *) echo "Error: unknown package '$PACKAGE' (use: pdf, zugferd, cli)"; exit 1 ;;
esac

# semver: 1.2.3 or 1.2.3-alpha.1
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-.+)?$ ]]; then
  echo "Error: version must be semver (e.g. 0.1.0 or 0.1.0-alpha.1)"
  exit 1
fi

PKG_JSON="$DIR/package.json"
NPM_NAME=$(node -e "console.log(require('./$PKG_JSON').name)")
TAG="${PACKAGE}-v${VERSION}"

# the working tree must be clean - we're about to commit + tag exactly the version bump
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: working tree not clean. Commit or stash first."
  exit 1
fi

echo "Release $NPM_NAME v$VERSION  (tag: $TAG)"
read -r -p "Push the tag and let CI publish to npm? [y/N] " ok
[ "$ok" = "y" ] || [ "$ok" = "Y" ] || { echo "Aborted."; exit 1; }

# bump the version in package.json
node -e "
const fs = require('fs');
const p = '$PKG_JSON';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
j.version = '$VERSION';
fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
"

git add "$PKG_JSON"
git commit -m "release: $NPM_NAME v$VERSION"
git tag "$TAG"
git push origin HEAD
git push origin "$TAG"

echo ""
echo "Done. The Release workflow will publish $NPM_NAME v$VERSION to npm."
