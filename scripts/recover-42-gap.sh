#!/usr/bin/env bash
# Recover the 42 pre-hardening stitcher naming failures (docs/stitch-naming-failures-1990-2008.txt).
# Each line documents a NOTABLE cluster lost before the stitcher gained its fallback-stage safety
# net. These clusters are NOT in the staged file, and the later hardened full pass didn't re-derive
# most of them (the multi-week/multi-state ones were eaten by the commit-stage season-blob gate).
#
# A TIGHT per-event --probe window can't form a season-blob, so probe --name rescues exactly what
# the full-pass blob gate dropped. This driver replays the prescribed path — one probe per line,
# constrained to that event's states — appending named clusters to .stitched-events.jsonl. Run
# `event-stitcher.ts --commit` afterward to embed + insert (dedup + blob gate still apply).
#
# Usage: bash scripts/recover-42-gap.sh
set -uo pipefail
cd "$(dirname "$0")/.."
DOC="docs/stitch-naming-failures-1990-2008.txt"
n=0
while IFS='|' read -r family members states range rest; do
  [ -z "${range// }" ] && continue
  states_clean="$(echo "$states" | tr -d ' ')"
  range_clean="$(echo "$range" | tr -d ' ')"
  n=$((n+1))
  echo "=== [$n] $(echo "$family" | tr -d ' ') $range_clean states=$states_clean ==="
  npx tsx scripts/event-stitcher.ts --probe "$range_clean" --states "$states_clean" --name 2>&1 \
    | grep -E '^★|naming failed|candidate clusters|staged rows' || true
done < "$DOC"
echo "=== RECOVERY PROBES DONE ($n windows) ==="
