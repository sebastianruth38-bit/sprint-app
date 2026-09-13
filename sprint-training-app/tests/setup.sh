#!/usr/bin/env bash
# Builds tests/fixtures/app -- the copy of the app that the browser tests
# serve over localhost.
#
# It is a copy rather than the app directory itself because index.html pulls
# supabase-js from jsdelivr, and the sandbox these tests run in blocks every
# CDN. The fixture swaps that one <script> tag for the vendored copy in
# tests/vendor/. Nothing else is changed: app.js, config.js and styles.css are
# the shipped files, so a test that passes here is testing what deploys.
#
# Re-run this after editing app.js, index.html or styles.css. It is cheap.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
app="$(dirname "$here")"
out="$here/fixtures/app"

mkdir -p "$out"
cp "$app/app.js" "$app/config.js" "$app/styles.css" "$out/"
cp "$here/vendor/supabase.js" "$out/supabase.js"

# Point the CDN tag at the vendored file. If index.html ever stops loading
# supabase from jsdelivr this quietly becomes a no-op and the fixture starts
# failing to boot, so fail loudly instead.
if ! grep -q 'cdn.jsdelivr.net/npm/@supabase/supabase-js' "$app/index.html"; then
  echo "setup.sh: index.html no longer loads supabase-js from jsdelivr." >&2
  echo "  Update the rewrite below to match how it loads now." >&2
  exit 1
fi
sed 's#https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2#supabase.js#' \
  "$app/index.html" > "$out/index.html"

echo "fixture built: $out"
