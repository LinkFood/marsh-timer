#!/bin/bash
# launchd wrapper for the DCD board-stack backup (scripts/backup/dump-tables.ts).
#
# WHY THIS EXISTS (2026-08-01)
#   docs/DISASTER-RECOVERY.md §9 item 2: "An unscheduled backup script is a script,
#   not a backup." dump-tables.ts was written 2026-07-25 and never registered with
#   launchd. The result: ~/dcd-backups held exactly four run directories, all from
#   2026-07-25, and the newest of those is a PARTIAL --only run of 4 tables. The last
#   COMPLETE run — and the only copy of frame-cache.tar.gz, the sole reconstruction
#   path for the board stack — is 2026-07-25T02-00-52Z.
#
# TIMING — 09:00 local, deliberately.
#   The daily bake writes that day's board_frames row at 11:45 UTC. launchd
#   StartCalendarInterval is LOCAL time: 09:00 is 13:00 UTC under EDT and 14:00 UTC
#   under EST, so the dump lands after the bake year-round and every run contains
#   that day's frame. An earlier slot would miss it by hours (DISASTER-RECOVERY §7).
#
# Install:
#   cp scripts/backup/com.duckcountdown.daily-backup.plist ~/Library/LaunchAgents/
#   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.duckcountdown.daily-backup.plist
# Uninstall:
#   launchctl bootout gui/$(id -u)/com.duckcountdown.daily-backup

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

LOG=/tmp/dcd-daily-backup.log
cd /Users/jameschellis/marsh-timer

# shellcheck source=../lib/service-key.sh
. /Users/jameschellis/marsh-timer/scripts/lib/service-key.sh
_dcd_service_key_or_die "backup" "$LOG" || exit 1

# THE OFF-MACHINE PUSH IS STILL UNSET. DISASTER-RECOVERY.md §7 / §9 item 1 is the
# one open condition and it needs a human with credentials, once. Until
# DCD_BACKUP_SYNC_CMD is exported here, this dump exists on ONE Mac — a second copy,
# not a second failure domain. Recommended vendor: NOT AWS us-west-2, so a single
# regional event cannot take the Supabase cluster and the backup together.
#   export DCD_BACKUP_SYNC_CMD='rclone copy "$DCD_BACKUP_RUN_DIR" r2:dcd-backups/$(basename "$DCD_BACKUP_RUN_DIR")'
if [ -z "${DCD_BACKUP_SYNC_CMD:-}" ]; then
  echo "$(date): WARNING — DCD_BACKUP_SYNC_CMD unset; dump stays on this Mac only" >> "$LOG"
fi

echo "$(date): backup starting" >> "$LOG"
if npx tsx scripts/backup/dump-tables.ts >> "$LOG" 2>&1; then
  echo "$(date): backup complete" >> "$LOG"
  if [ -z "${DCD_BACKUP_SYNC_CMD:-}" ]; then
    osascript -e 'display notification "dump OK — but still on this Mac only (sync cmd unset)" with title "🦆 DCD backup"' >/dev/null 2>&1 || true
  fi
else
  echo "$(date): BACKUP FAILED" >> "$LOG"
  osascript -e 'display notification "backup FAILED — see /tmp/dcd-daily-backup.log" with title "🦆 DCD backup"' >/dev/null 2>&1 || true
  exit 1
fi
