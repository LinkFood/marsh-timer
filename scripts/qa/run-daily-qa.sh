#!/bin/bash
# Daily QA runner for duckcountdown.com — launchd wrapper.
# Runs a headless `claude -p` QA agent (checks + real-Chrome screenshots), then
# commits the report to the qa-daily branch via a DEDICATED WORKTREE (never
# touches the main working tree's checked-out branch) and posts a macOS
# notification with the verdict.
#
# Install:
#   cp scripts/qa/com.duckcountdown.daily-qa.plist ~/Library/LaunchAgents/
#   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.duckcountdown.daily-qa.plist
# Uninstall:
#   launchctl bootout gui/$(id -u)/com.duckcountdown.daily-qa

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

REPO=/Users/jameschellis/marsh-timer
QA_WT="$HOME/.dcd-qa-worktree"
TODAY=$(date -u +%Y-%m-%d)

# Extended through the timebox (2026-08-10): the blind-spot sweep is the
# Formation Layer's daily examiner (new thesis, 2026-07-17) — it must outlive
# the original one-week trial. Re-decide at the timebox verdict.
if [[ "$TODAY" > "2026-08-10" ]]; then
  echo "QA window ended ($TODAY > 2026-08-10); exiting."
  exit 0
fi

cd "$REPO"

SUPABASE_SERVICE_ROLE_KEY=$(npx supabase projects api-keys --project-ref rvhyotvklfowklzjahdd --output json 2>/dev/null \
  | jq -r '.[] | select(.id=="service_role") | .api_key' || true)
if [[ -z "$SUPABASE_SERVICE_ROLE_KEY" ]]; then
  osascript -e 'display notification "Could not fetch service key — QA did not run" with title "🦆 DCD QA"' || true
  echo "no service key; aborting"
  exit 1
fi
export SUPABASE_SERVICE_ROLE_KEY

rm -f /tmp/dcd-qa-report.md /tmp/dcd-qa-verdict.txt

# The QA agent: analytical only — it writes /tmp outputs, never touches git.
# Retry loop (added 2026-07-18): the 8:30 slot died 3 mornings running on
# transient API connection errors while later-day reruns always succeeded —
# retry up to 3 attempts with a growing pause before declaring no-verdict.
for attempt in 1 2 3; do
  claude -p "$(cat "$REPO/scripts/qa/DAILY-QA-PROMPT.md")" \
    --allowedTools "Bash,Read,Write,Glob,Grep" \
    || true
  [[ -f /tmp/dcd-qa-verdict.txt ]] && break
  echo "attempt $attempt produced no verdict; retrying in $((attempt * 120))s"
  sleep $((attempt * 120))
done

VERDICT=$(cat /tmp/dcd-qa-verdict.txt 2>/dev/null || echo "❌ DCD QA $TODAY: agent produced no verdict — check /tmp/dcd-daily-qa.log")

# Commit the report on qa-daily via a dedicated worktree (main tree untouched).
if [[ -f /tmp/dcd-qa-report.md ]]; then
  git fetch origin qa-daily || true
  if [[ ! -d "$QA_WT" ]]; then
    git worktree add "$QA_WT" qa-daily 2>/dev/null \
      || git worktree add -b qa-daily "$QA_WT" origin/qa-daily \
      || git worktree add -b qa-daily "$QA_WT" origin/main
  fi
  cd "$QA_WT"
  git pull --rebase origin qa-daily 2>/dev/null || true
  mkdir -p docs/qa
  cp /tmp/dcd-qa-report.md "docs/qa/${TODAY}.md"
  git add docs/qa/
  git commit -m "QA report ${TODAY}" || true
  git push origin qa-daily || true
  cd "$REPO"
fi

osascript -e "display notification \"${VERDICT//\"/}\" with title \"🦆 DCD daily QA\"" || true
echo "$VERDICT"
