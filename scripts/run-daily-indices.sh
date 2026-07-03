#!/bin/bash
# Wrapper for launchd to run push-daily-indices.ts (climate indices — AO/NAO/PNA).
# Must run on this Mac: NOAA CPC FTP (ftp.cpc.ncep.noaa.gov) is unreachable from
# edge functions.
#
# History: this wrapper was deleted in commit b81f979 ("Delete dead files") on
# 2026-03-22 while ~/Library/LaunchAgents/com.duckcountdown.daily-indices.plist
# kept pointing at it — every 7:00 AM run exited 127 and climate-index-daily
# data went stale. Restored + fixed 2026-07-02. Do not delete while the plist
# references it.
#
# Install (see docs/REACTIVATION-RUNBOOK.md):
#   cp scripts/com.duckcountdown.daily-indices.plist ~/Library/LaunchAgents/
#   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.duckcountdown.daily-indices.plist

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

# Load nvm (launchd does not inherit the shell environment)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

cd /Users/jameschellis/marsh-timer

# Get service role key from supabase CLI (JSON output; older CLI versions
# printed a table — the old grep/awk parse silently returns empty now)
SUPABASE_SERVICE_ROLE_KEY=$(npx supabase projects api-keys --project-ref rvhyotvklfowklzjahdd 2>/dev/null \
  | jq -r '.keys[] | select(.id=="service_role") | .api_key')

if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ] || [ "$SUPABASE_SERVICE_ROLE_KEY" = "null" ]; then
  # Fallback for table-format CLI output
  SUPABASE_SERVICE_ROLE_KEY=$(npx supabase projects api-keys --project-ref rvhyotvklfowklzjahdd 2>/dev/null \
    | grep service_role | awk '{print $NF}')
fi

if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ] || [ "$SUPABASE_SERVICE_ROLE_KEY" = "null" ]; then
  echo "$(date): Failed to get service role key" >> /tmp/duck-daily-indices.log
  exit 1
fi
export SUPABASE_SERVICE_ROLE_KEY

# DAYS=1 for the daily run; override with DAYS=N for catch-up after downtime
DAYS="${DAYS:-1}" npx tsx scripts/push-daily-indices.ts >> /tmp/duck-daily-indices.log 2>&1

echo "$(date): Daily indices push complete" >> /tmp/duck-daily-indices.log
