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
  tracking_test grading_test framing_test motion_test gait_test subject_test
  dense_test frames_test coverage_test v2_test
  logic_test workouts_test split_test bodyweight_test expand_test2
  legal_test guide_test docs_test warmup_test gym_test
)
browser=(
  boot_test local_flow_test times_test ui_test4 sched_test e2e_sched
  avail_test ref_test btn_test quota_ui_test delete_account_test
)
# crop_flow_test is the only suite that runs the real capture against real
# clips, and the only place the diagnostics wiring can be proved at all. It
# used to run only under --clips, so when compressForStorage was deleted it
# threw on a missing name for days and nobody saw it. A suite nobody runs is a
# suite that lies.
#
# Its clips are 33MB of the athlete's own footage and are deliberately not in
# the repo, so it cannot simply be added to the list. It runs whenever they
# are present, and when they are not it says so on its own line -- silence is
# exactly how it rotted the first time. --clips stays accepted and does
# nothing, for muscle memory.
clips_present=0
if [ -f "$here/clips/blockStart.webm" ] && [ -f "$here/clips/scrolled.webm" ]; then
  browser+=(crop_flow_test)
  clips_present=1
fi

if [ "$clips_present" = 0 ]; then
  printf '%-18s %s\n' "crop_flow_test" "SKIPPED -- tests/clips/ is empty (33MB, not in the repo)"
fi

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
