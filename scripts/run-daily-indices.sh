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

# Service role key. Was a bare `npx supabase projects api-keys` call, which needs a
# keychain prompt no launchd job can answer — it failed silently every morning from
# 2026-07-28. Now resolved from .env.local first, and a failure is announced.
# shellcheck source=lib/service-key.sh
. /Users/jameschellis/marsh-timer/scripts/lib/service-key.sh
_dcd_service_key_or_die "daily-indices" /tmp/duck-daily-indices.log || exit 1

# DAYS=1 for the daily run; override with DAYS=N for catch-up after downtime
DAYS="${DAYS:-1}" npx tsx scripts/push-daily-indices.ts >> /tmp/duck-daily-indices.log 2>&1

echo "$(date): Daily indices push complete" >> /tmp/duck-daily-indices.log
