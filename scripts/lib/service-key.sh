#!/bin/bash
# Resolve SUPABASE_SERVICE_ROLE_KEY for launchd-run jobs. Source this; do not exec it.
#
# WHY THIS EXISTS (2026-08-01)
#   Every local job derived the service key by shelling out to
#   `npx supabase projects api-keys`. That call reads the account access token from
#   the login keychain (service "Supabase CLI", created 2026-02-27). Under launchd
#   there is no session that can answer a keychain authorization prompt, so the CLI
#   falls back to "Access token not provided" and exits 1. Both DCD jobs died this
#   way from 2026-07-28 onward — daily-indices logged "Failed to get service role
#   key" five mornings running, daily-qa logged "no service key; aborting" five
#   times, and nothing surfaced it.
#
#   The CLI is therefore a single point of failure that cannot be repaired from a
#   background context. Resolution order below puts a plain local file FIRST so the
#   owner can fix every job at once by pasting one line, with the CLI kept only as a
#   last-resort fallback for interactive runs.
#
# ORDER
#   1. $SUPABASE_SERVICE_ROLE_KEY already in the environment
#   2. SUPABASE_SERVICE_ROLE_KEY= in /Users/jameschellis/marsh-timer/.env.local
#      (gitignored via `*.local`, untracked — verified 2026-08-01)
#   3. the Supabase CLI (interactive sessions only; fails under launchd)
#
# Sets SUPABASE_SERVICE_ROLE_KEY and returns 0, or returns 1 having set nothing.
# NEVER echoes the key.

_dcd_resolve_service_key() {
  local env_file="/Users/jameschellis/marsh-timer/.env.local"

  # 1. already in the environment
  if [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ] && [ "$SUPABASE_SERVICE_ROLE_KEY" != "null" ]; then
    export SUPABASE_SERVICE_ROLE_KEY
    return 0
  fi

  # 2. .env.local — the owner-serviceable path, works headless
  if [ -f "$env_file" ]; then
    local from_file
    from_file=$(grep -E '^SUPABASE_SERVICE_ROLE_KEY=' "$env_file" 2>/dev/null \
      | head -1 | cut -d= -f2- | tr -d '"'"'"'\r' | xargs || true)
    if [ -n "$from_file" ] && [ "$from_file" != "null" ]; then
      export SUPABASE_SERVICE_ROLE_KEY="$from_file"
      return 0
    fi
  fi

  # 3. Supabase CLI — OFF BY DEFAULT, opt in with DCD_ALLOW_CLI_KEY=1.
  #    It cannot work under launchd (no session to answer the keychain prompt) and it
  #    is not merely useless there: the attempt raises a GUI authorization dialog on
  #    whoever is at the machine. A scheduled job must never do that. Interactive
  #    callers who are logged in can opt back in explicitly.
  if [ "${DCD_ALLOW_CLI_KEY:-0}" = "1" ] && command -v npx >/dev/null 2>&1; then
    local out
    out=$(SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:-}" \
      npx --no-install supabase projects api-keys \
        --project-ref rvhyotvklfowklzjahdd --output json 2>/dev/null </dev/null || true)
    local key
    key=$(printf '%s' "$out" | jq -r '(.[]?, .keys[]?) | select(.id=="service_role") | .api_key' 2>/dev/null | head -1 || true)
    if [ -n "$key" ] && [ "$key" != "null" ]; then
      export SUPABASE_SERVICE_ROLE_KEY="$key"
      return 0
    fi
  fi

  return 1
}

# Loud failure. A backup or QA job that dies quietly is indistinguishable from one
# that never ran — that is exactly how 8 days were lost. Notify AND log.
_dcd_service_key_or_die() {
  local job="$1" logfile="$2"
  if _dcd_resolve_service_key; then
    return 0
  fi
  local msg="$job did NOT run: no Supabase service role key. Fix: add SUPABASE_SERVICE_ROLE_KEY= to marsh-timer/.env.local"
  echo "$(date): $msg" >> "$logfile"
  osascript -e "display notification \"no service key — job did not run\" with title \"🦆 DCD $job FAILED\"" >/dev/null 2>&1 || true
  return 1
}
