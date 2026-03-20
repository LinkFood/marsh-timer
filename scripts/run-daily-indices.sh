#!/bin/bash
# Wrapper for launchd to run push-daily-indices.ts
# Initializes nvm, fetches service key, runs the script

set -euo pipefail

# Load nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

cd /Users/jameschellis/marsh-timer

# Get service role key from supabase CLI
export SUPABASE_SERVICE_ROLE_KEY=$(npx supabase projects api-keys --project-ref rvhyotvklfowklzjahdd 2>/dev/null | grep service_role | awk '{print $NF}')

if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "$(date): Failed to get service role key" >> /tmp/duck-daily-indices.log
  exit 1
fi

# Run the script (DAYS=1 for daily, only push today's values)
DAYS=1 npx tsx scripts/push-daily-indices.ts >> /tmp/duck-daily-indices.log 2>&1

echo "$(date): Daily indices push complete" >> /tmp/duck-daily-indices.log
