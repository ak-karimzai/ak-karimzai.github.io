#!/usr/bin/env bash
# Builds the site and publishes dist/ to the gh-pages branch, which GitHub Pages serves.
# Usage: npm run deploy
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
touch dist/.nojekyll
remote=$(git remote get-url origin)
tmp=$(mktemp -d)
git -C dist init -q -b gh-pages
git -C dist add -A
git -C dist -c user.name="$(git config user.name)" -c user.email="$(git config user.email)" commit -q -m "Deploy $(git rev-parse --short HEAD)"
git -C dist push -f "$remote" gh-pages:gh-pages
rm -rf dist/.git "$tmp"
echo "Published to gh-pages."
