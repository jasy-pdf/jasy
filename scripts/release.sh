#!/bin/bash
set -euo pipefail

# Release one or more packages in ONE command: bump, commit, tag and push each, wait for its CI publish
# run and for npm to serve it, then - once, at the end - ask for an npm OTP and move `latest` to the
# prereleases. Nothing to do on GitHub or npmjs.com by hand.
#
# Usage:   ./scripts/release.sh <package> <version> [<package> <version> ...]
#   package = pdf | e-invoice | cli | vue | nuxt | react | angular   (pdf is the workspace ROOT)
#   version = semver, e.g. 1.0.0 or 1.0.0-beta.7
# Example: ./scripts/release.sh pdf 1.0.0-beta.7 vue 1.0.0-beta.3 react 1.0.0-beta.3
#
# The packages are released in dependency order whatever order you name them in: pdf, then its dependents.
# Needs `gh` (logged in) and `npm` (logged in, for the dist-tag); both are checked before anything is pushed.

# Dependency order: a package is released after everything it builds against.
ORDER=(pdf e-invoice cli vue react nuxt angular)

usage() {
  echo "Usage: ./scripts/release.sh <package> <version> [<package> <version> ...]"
  echo "  package: ${ORDER[*]}"
  echo "  example: ./scripts/release.sh pdf 1.0.0-beta.7 vue 1.0.0-beta.3"
  exit 1
}
fail() {
  echo ""
  echo "Error: $*"
  exit 1
}

# How long to wait for npm to serve a version CI has published. It is usually a minute, and was five
# once; after this the script asks whether to keep waiting instead of giving up.
NPM_WAIT=${JASY_NPM_WAIT:-600}
NPM_POLL=${JASY_NPM_POLL:-10}

# What the registry serves NOW: --prefer-online skips npm's local cache of the package document.
npm_version() { npm view "$1" version --prefer-online 2>/dev/null || true; }
npm_latest() { npm view "$1" dist-tags.latest --prefer-online 2>/dev/null || true; }

dir_of() {
  case "$1" in
    pdf) echo "." ;;
    e-invoice | cli | vue | nuxt | react | angular) echo "packages/$1" ;;
    *) return 1 ;;
  esac
}

# ---------------------------------------------------------------------------------------------------
# 1. Arguments
# ---------------------------------------------------------------------------------------------------
if [ $# -eq 0 ] || [ $(($# % 2)) -ne 0 ]; then usage; fi
declare -A WANTED=()
while [ $# -gt 0 ]; do
  PACKAGE="$1"
  VERSION="$2"
  shift 2
  # The old name still works, so a habit does not become an error.
  if [ "$PACKAGE" = "zugferd" ]; then
    echo "Note: '@jasy/zugferd' is now '@jasy/e-invoice'."
    PACKAGE="e-invoice"
  fi
  dir_of "$PACKAGE" >/dev/null || fail "unknown package '$PACKAGE' (use: ${ORDER[*]})"
  [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-.+)?$ ]] || fail "'$VERSION' is not semver (e.g. 1.0.0 or 1.0.0-beta.7)"
  if [ -n "${WANTED[$PACKAGE]:-}" ]; then fail "'$PACKAGE' is named twice"; fi
  WANTED[$PACKAGE]="$VERSION"
done

RELEASES=()
for p in "${ORDER[@]}"; do
  if [ -n "${WANTED[$p]:-}" ]; then RELEASES+=("$p"); fi
done

# ---------------------------------------------------------------------------------------------------
# 2. Everything that could stop us, checked BEFORE anything is pushed
# ---------------------------------------------------------------------------------------------------
command -v gh >/dev/null || fail "the GitHub CLI 'gh' is not installed."
gh auth status >/dev/null 2>&1 || fail "you are not logged in to GitHub. Run:  gh auth login"
NPM_USER=$(npm whoami 2>/dev/null) || fail "you are not logged in to npm. Run:  npm login"

# Release ONLY from an up-to-date, clean `main`. A feature branch strands the bump commits (a squash-merged
# branch is divergent from main); a stale main bumps the wrong base.
BRANCH=$(git branch --show-current)
[ "$BRANCH" = "main" ] || fail "releases run on 'main', but you are on '$BRANCH'. Run:  git checkout main && git pull"
git fetch --quiet origin main || fail "could not fetch origin/main to check you are up to date."
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] ||
  fail "local 'main' is not in sync with origin/main - pull (or push) first, then run this again."
[ -z "$(git status --porcelain)" ] || fail "the working tree is not clean. Commit or stash first."

for p in "${RELEASES[@]}"; do
  NAME=$(node -p "require('./$(dir_of "$p")/package.json').name")
  VERSION="${WANTED[$p]}"
  if git rev-parse -q --verify "refs/tags/$p-v$VERSION" >/dev/null; then
    fail "the tag $p-v$VERSION already exists."
  fi
  if [ -n "$(npm_version "$NAME@$VERSION")" ]; then fail "$NAME@$VERSION is already on npm."; fi
done

echo "Release, in this order (npm user: $NPM_USER):"
for p in "${RELEASES[@]}"; do echo "  $(node -p "require('./$(dir_of "$p")/package.json').name") ${WANTED[$p]}"; done
read -r -p "Go? [y/N] " ok
[ "$ok" = "y" ] || [ "$ok" = "Y" ] || {
  echo "Aborted."
  exit 1
}

# ---------------------------------------------------------------------------------------------------
# 3. One package after the other: bump, tag, push, wait for CI, wait for npm
# ---------------------------------------------------------------------------------------------------
PRERELEASES=()
for p in "${RELEASES[@]}"; do
  DIR=$(dir_of "$p")
  NAME=$(node -p "require('./$DIR/package.json').name")
  VERSION="${WANTED[$p]}"
  TAG="$p-v$VERSION"
  echo ""
  echo "==> $NAME $VERSION"

  node -e "
    const fs = require('fs');
    const file = '$DIR/package.json';
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    json.version = '$VERSION';
    fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  "
  git add "$DIR/package.json"
  git commit --quiet -m "release: $NAME v$VERSION"
  git tag "$TAG"
  git push --quiet origin HEAD
  git push --quiet origin "$TAG"

  # The tag starts the "Release" workflow; its run carries the tag as its head branch.
  RUN=""
  for _ in $(seq 1 30); do
    RUN=$(gh run list --workflow release.yml --event push --limit 20 \
      --json databaseId,headBranch --jq ".[] | select(.headBranch==\"$TAG\") | .databaseId" | head -1)
    if [ -n "$RUN" ]; then break; fi
    sleep 4
  done
  [ -n "$RUN" ] || fail "no release run started for $TAG within 2 minutes. Look at:  gh run list --workflow release.yml"

  echo "    CI: $(gh run view "$RUN" --json url --jq .url)"
  if ! gh run watch "$RUN" --exit-status --compact --interval 10; then
    fail "the release run for $TAG failed - nothing after it was released, no dist-tag was moved.
  Look at:   gh run view $RUN --log-failed
  Fixed it?  gh run rerun $RUN --failed
             then, for a prerelease:  npm dist-tag add $NAME@$VERSION latest --otp=<code>
             and run this script again for the packages after $p."
  fi
  echo "    CI passed."

  # npm serves a new version a minute or several after the publish.
  printf "    Waiting for npm to serve it (usually a minute, sometimes five) "
  WAITED=0
  until [ "$(npm_version "$NAME@$VERSION")" = "$VERSION" ]; do
    if [ "$WAITED" -ge "$NPM_WAIT" ]; then
      echo ""
      read -r -p "    Not on npm after $((WAITED / 60)) minutes. Keep waiting? [Y/n] " more
      if [ "$more" = "n" ] || [ "$more" = "N" ]; then
        fail "stopped. CI published $NAME@$VERSION; once npm shows it (npm view $NAME@$VERSION), run:
  npm dist-tag add $NAME@$VERSION latest --otp=<code>   (for a prerelease)
  and this script again for the packages after $p."
      fi
      WAITED=0
      printf "    Waiting "
    fi
    printf "."
    sleep "$NPM_POLL"
    WAITED=$((WAITED + NPM_POLL))
  done
  echo ""
  echo "    On npm."

  # A prerelease is published to its own dist-tag (beta, alpha) by CI; `latest` follows below.
  if [[ "$VERSION" == *-* ]]; then PRERELEASES+=("$NAME@$VERSION"); fi
done

# ---------------------------------------------------------------------------------------------------
# 4. `latest` for the prereleases: one OTP, asked again only if npm refuses it
# ---------------------------------------------------------------------------------------------------
if [ ${#PRERELEASES[@]} -gt 0 ]; then
  echo ""
  echo "Point 'latest' at: ${PRERELEASES[*]}"
  OTP=""
  for spec in "${PRERELEASES[@]}"; do
    while true; do
      if [ -z "$OTP" ]; then read -r -p "npm one-time password (empty = stop): " OTP; fi
      if [ -z "$OTP" ]; then
        fail "stopped. Everything is published; set the rest yourself:  npm dist-tag add $spec latest --otp=<code>"
      fi
      if ERR=$(npm dist-tag add "$spec" latest --otp="$OTP" 2>&1 >/dev/null); then
        # Read back what the registry says, rather than trusting the success message.
        LATEST=""
        for _ in 1 2 3 4 5 6; do
          LATEST=$(npm_latest "${spec%@*}")
          if [ "$LATEST" = "${spec##*@}" ]; then break; fi
          sleep 5
        done
        if [ "$LATEST" = "${spec##*@}" ]; then
          echo "    latest -> $spec (checked on the registry)"
        else
          echo "    npm accepted it, but the registry still says latest = ${LATEST:-?}. Check:  npm dist-tag ls ${spec%@*}"
        fi
        break
      fi
      # A used-up or mistyped code is the usual reason; npm's own message says if it is something else.
      echo "    npm said: $(echo "$ERR" | grep -m1 -iE "error|otp" || echo "$ERR" | head -1)"
      OTP=""
    done
  done
fi

echo ""
echo "Done."
for p in "${RELEASES[@]}"; do
  NAME=$(node -p "require('./$(dir_of "$p")/package.json').name")
  echo "  $NAME: $(npm view "$NAME" dist-tags --json --prefer-online | tr -d '\n ' | sed 's/,/, /g')"
done
