#!/usr/bin/env bash
# Publish the app to the gh-pages branch.
#
# Stamps the current commit onto every asset URL. Without that, a browser
# that has app.js cached keeps running the old code no matter how many times
# the page itself is reloaded -- adding ?v= to the URL only refetches
# index.html, and the <script src="app.js"> inside it is a separate request
# that Safari happily serves from cache. That cost a morning of testing
# against a build that had already been replaced.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="$ROOT/sprint-training-app"
WORK="$(mktemp -d)"
SHA="$(git -C "$ROOT" rev-parse --short HEAD)"
MSG="${1:-Sync: $SHA}"

# Every page that ships. Named in one place because a page missing from this
# list does not fail -- it just silently never reaches the site.
PAGES=(index.html privacy.html terms.html)

trap 'git -C "$ROOT" worktree remove "$WORK" --force >/dev/null 2>&1 || true; git -C "$ROOT" worktree prune' EXIT

git -C "$ROOT" worktree add "$WORK" gh-pages -f >/dev/null
cp "$APP/app.js" "$APP/styles.css" "$APP/config.js" "$WORK/"
for page in "${PAGES[@]}"; do
  cp "$APP/$page" "$WORK/"
done

# Version every local asset so a cached copy can never shadow a new deploy.
# Every page, not just index: the legal pages load the same stylesheet and
# would otherwise keep serving a cached copy of it.
for page in "${PAGES[@]}"; do
  python3 - "$WORK/$page" "$SHA" <<'PY'
import re, sys, os
path, sha = sys.argv[1], sys.argv[2]
html = open(path).read()
html = re.sub(r'(src|href)="([\w.-]+\.(?:js|css))(\?v=[^"]*)?"',
              lambda m: f'{m.group(1)}="{m.group(2)}?v={sha}"', html)
open(path, 'w').write(html)
print(f"stamped {os.path.basename(path)} with ?v={sha}")
PY
done

node --check "$WORK/app.js"
git -C "$WORK" add -A
if git -C "$WORK" diff --cached --quiet; then
  echo "nothing to deploy"
  exit 0
fi
git -C "$WORK" commit -q -m "$MSG"
git -C "$WORK" push origin gh-pages
echo "deployed $SHA"
