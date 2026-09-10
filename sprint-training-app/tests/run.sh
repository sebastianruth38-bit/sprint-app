#!/usr/bin/env bash
# Runs every suite and prints one line each. Exits non-zero if any failed.
#
#   ./tests/run.sh          everything that needs no clips
#   ./tests/run.sh --clips  also crop_flow_test, which needs tests/clips/
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$here/setup.sh" >/dev/null

# Pure logic first: they are fast, and if the grader's maths is broken there
# is no point spending two minutes booting browsers.
node_only=(
  tracking_test framing_test motion_test gait_test subject_test
  dense_test frames_test coverage_test v2_test
  logic_test split_test bodyweight_test expand_test2
  legal_test guide_test docs_test warmup_test
)
browser=(
  local_flow_test ui_test4 sched_test e2e_sched
  avail_test ref_test btn_test quota_ui_test delete_account_test
)
[ "${1:-}" = "--clips" ] && browser+=(crop_flow_test)

failed=()
for t in "${node_only[@]}" "${browser[@]}"; do
  printf '%-18s ' "$t"
  out="$(cd "$here" && node "$t.js" 2>&1)"
  if [ $? -eq 0 ]; then
    echo "${out##*$'\n'}"
  else
    failed+=("$t")
    echo "FAILED"
    echo "$out" | grep '^FAIL' | sed 's/^/    /'
  fi
done

if [ ${#failed[@]} -gt 0 ]; then
  echo
  echo "${#failed[@]} suite(s) failed: ${failed[*]}"
  exit 1
fi
echo
echo "all green"
