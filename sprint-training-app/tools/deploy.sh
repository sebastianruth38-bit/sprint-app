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

trap 'git -C "$ROOT" worktree remove "$WORK" --force >/dev/null 2>&1 || true; git -C "$ROOT" worktree prune' EXIT

git -C "$ROOT" worktree add "$WORK" gh-pages -f >/dev/null
cp "$APP/app.js" "$APP/styles.css" "$APP/config.js" "$APP/index.html" "$WORK/"

# Version every local asset so a cached copy can never shadow a new deploy.
python3 - "$WORK/index.html" "$SHA" <<'PY'
import re, sys
path, sha = sys.argv[1], sys.argv[2]
html = open(path).read()
html = re.sub(r'(src|href)="([\w.-]+\.(?:js|css))(\?v=[^"]*)?"',
              lambda m: f'{m.group(1)}="{m.group(2)}?v={sha}"', html)
open(path, 'w').write(html)
print(f"stamped assets with ?v={sha}")
PY

node --check "$WORK/app.js"
git -C "$WORK" add -A
if git -C "$WORK" diff --cached --quiet; then
  echo "nothing to deploy"
  exit 0
fi
git -C "$WORK" commit -q -m "$MSG"
git -C "$WORK" push origin gh-pages
echo "deployed $SHA"
