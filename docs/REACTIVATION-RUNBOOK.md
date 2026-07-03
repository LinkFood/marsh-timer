# Reactivation Runbook — 2026-07-02 Mining-Audit Fixes

Four data-integrity bugs were diagnosed and their fixes prepped on 2026-07-02
while the IVFFlat rebuild (`20260414100018_rebuild_ivfflat_for_7m.sql`) held a
write lock on `hunt_knowledge`. **Nothing below was executed.** Run these
steps in order, ONE AT A TIME (one backfill pipe at a time — Supabase Pro IO
budget), each after the previous completes.

## Root causes (short version)

| Bug | Root cause |
|-----|-----------|
| ghcn-daily missing SC–WY | Backfill run died after RI and was never resumed; `insertBatch` swallowed failures, counted failed batches as "embedded", and exited 0, so the orchestrator checkpoint marked the pipe `done`. (Earlier runs in `.orchestrator-v2.log` show two prior failure generations: positional-date 400s, then "no valid daily data" for every state.) |
| storm-event collapse post-2016 | Single-attempt download with a **2-minute abort** + silent skip-year-on-failure. Post-2016 NCEI detail files are the largest, so every year from 2017 on timed out / got throttled and was skipped. Line-split CSV parsing also chopped multi-line quoted narratives. The trickle of post-2016 rows (1.7k/3.2k/0.7k) came from live crons, not the backfill. |
| drought-weekly 2x + dup crons | `hunt_knowledge` has no unique constraint, so `Prefer: resolution=merge-duplicates` is a silent no-op — backfill-drought-monitor completed twice, doubling every row. Separately, renamed crons (`hunt-anomaly-detector-daily`, `hunt-correlation-engine-daily`, `hunt-du-map-weekly`) were never unscheduled, so old + new names both fire. **Note:** `hunt_migration_history` was probed live (13,330 rows) and has ZERO duplicate `(state_abbr, species, date)` keys — its PK is intact; the audit's 7152/5681 figure does not match live reality, no dedup needed there. |
| climate-index job dead | `scripts/run-daily-indices.sh` was deleted in commit `b81f979` (2026-03-22 dead-code sweep) while the launchd plist kept pointing at it — every 7:00 AM run exited 127 since. Second latent bug: the wrapper parsed `supabase projects api-keys` as a table, but the CLI now emits JSON. Wrapper restored + fixed; broken launchd job was booted out and stays uninstalled until Step 1. |

## Step 0 — Precondition: IVFFlat rebuild finished

Verify `hunt_knowledge` accepts reads again (a lock timeout means the rebuild
is still running — wait):

```bash
KEY=$(npx supabase projects api-keys --project-ref rvhyotvklfowklzjahdd 2>/dev/null | jq -r '.keys[] | select(.id=="service_role") | .api_key')
curl -s "https://rvhyotvklfowklzjahdd.supabase.co/rest/v1/hunt_knowledge?select=id&content_type=eq.climate-index-daily&effective_date=gte.2026-06-01&limit=1" \
  -H "Authorization: Bearer $KEY" -H "apikey: $KEY"
```

Expect a JSON array, not `{"code":"55P03",...}`.

## Step 1 — Climate-index restart (~2 min, ~370 entries)

Catch-up push (job dead since early April → 120-day window covers the gap),
then install the launchd job:

```bash
cd /Users/jameschellis/marsh-timer
export SUPABASE_SERVICE_ROLE_KEY=$(npx supabase projects api-keys --project-ref rvhyotvklfowklzjahdd 2>/dev/null | jq -r '.keys[] | select(.id=="service_role") | .api_key')
DAYS=120 npx tsx scripts/push-daily-indices.ts

# Install the daily 7:00 AM launchd job (plist is versioned in the repo)
cp scripts/com.duckcountdown.daily-indices.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.duckcountdown.daily-indices.plist

# Verify: fire once manually, then check the log
launchctl kickstart gui/$(id -u)/com.duckcountdown.daily-indices
tail -5 /tmp/duck-daily-indices.log   # expect "Daily indices push complete", not 127
```

Expected: 3 indices (AO/NAO/PNA) x ~120 days ≈ 360 `climate-index-daily`
entries, then ~3/day ongoing.

## Step 2 — GHCN-daily backfill, missing states SC–WY (~8–12 h, ~300k entries)

Script is now idempotent (diffs against existing `effective_date`s per
state/year before inserting — cannot duplicate A–RI data or partial years)
and exits non-zero on any swallowed failure.

```bash
cd /Users/jameschellis/marsh-timer
export SUPABASE_SERVICE_ROLE_KEY=$(npx supabase projects api-keys --project-ref rvhyotvklfowklzjahdd 2>/dev/null | jq -r '.keys[] | select(.id=="service_role") | .api_key')
export VOYAGE_API_KEY=<from vault>
ONLY_STATES=SC,SD,TN,TX,UT,VT,VA,WA,WV,WI,WY \
  npx tsx scripts/backfill-ghcn-daily.ts 2>&1 | tee /tmp/ghcn-resume.log
```

Full 1950–2025 sweep for the 11 states (the audit verified 2005–2024 is
empty; pre-2005 coverage is unknown — the per-year existing-date diff makes
the wide range free where data exists). ~11 states x ~76 yrs x ~365 days ≈
300k entries. Monitor Supabase IO every 20 min. If it exits 1, check the
FAILURES summary line and re-run the same command — it resumes from the diff.

## Step 3 — Storm-events backfill 2017→ (~10–14 h, ~300–400k entries), then dedup

```bash
cd /Users/jameschellis/marsh-timer
export SUPABASE_SERVICE_ROLE_KEY=...   # as above
export VOYAGE_API_KEY=...
START_YEAR=2017 npx tsx scripts/backfill-storm-events.ts 2>&1 | tee /tmp/storm-resume.log
```

Re-inserting the ~5k stray post-2016 rows that already exist WILL duplicate
them (no unique constraint) — that is expected and cleaned by the dedup pass:

```bash
DRY_RUN=true npx tsx scripts/dedup-storm-events.ts   # sanity-check counts first
npx tsx scripts/dedup-storm-events.ts                # live pass
```

If the script exits 1, the FAILURES line lists incomplete years — re-run with
`START_YEAR=<first failed year>`.

## Step 4 — Push prepped migrations (cron dedup + drought-weekly dedup, ~1 min)

Two committed, un-pushed migrations:

- `20260414100020_unschedule_stale_dup_crons.sql` — unschedules
  `hunt-anomaly-detector-daily`, `hunt-correlation-engine-daily`,
  `hunt-du-map-weekly` (idempotent DO-block guards).
- `20260414100021_dedup_drought_weekly.sql` — deletes the older copy per
  `(state_abbr, effective_date)` for `content_type='drought-weekly'`
  (~8.5k rows deleted; bounded via the compound content_type index).
  Deliberately does NOT add a unique index on hunt_knowledge — see the
  migration header for why.

```bash
cd /Users/jameschellis/marsh-timer
npx supabase migration list    # confirm 20260414100018/19 are recorded as applied;
                               # if 18 was run manually, first:
                               # npx supabase migration repair --status applied 20260414100018
npx supabase db push
```

(20 can be pushed any time after the rebuild — it doesn't touch
hunt_knowledge. 21 must wait for the rebuild lock to clear, which Step 0
already guarantees.)

## Post-run verification

```bash
# ghcn gap closed (repeat per state):
curl -s "https://rvhyotvklfowklzjahdd.supabase.co/rest/v1/hunt_knowledge?select=effective_date&content_type=eq.ghcn-daily&state_abbr=eq.SC&effective_date=gte.2015-01-01&effective_date=lte.2015-01-31&limit=5" -H "Authorization: Bearer $KEY" -H "apikey: $KEY"

# storm-events 2019 populated:
curl -s "https://rvhyotvklfowklzjahdd.supabase.co/rest/v1/hunt_knowledge?select=id&content_type=eq.storm-event&effective_date=gte.2019-06-01&effective_date=lte.2019-06-07&limit=5" -H "Authorization: Bearer $KEY" -H "apikey: $KEY"

# stale crons gone (via ops dashboard cron health, or cron.job query in SQL editor)
```

---

# Court v2 — honest matched-control grading (2026-07-02)

Separate workstream from the ingestion fixes above. The shipped self-grading
was tautological (outcome-signal-in-window, no base-rate comparison; always-on
daily feeds auto-confirmed). Court v2 grades every claim against matched
control windows and scores as lift. Full lift convention documented in
`supabase/functions/hunt-alert-grader/index.ts`; trigger/outcome vocabulary in
`supabase/functions/hunt-claim-court/index.ts`.

## Already live (deployed 2026-07-02, no new-table dependencies)

- `hunt-alert-grader` v2 — discriminating-domains primary grade
  (always-on exclusion set expanded to water/nws/weather/air_quality/
  space_weather/ocean/soil), legacy grade preserved as `grade_legacy`,
  N=10 matched-control windows + lift written into
  `hunt_alert_outcomes.outcome_signals_found.court` and the alert-grade
  knowledge entry metadata. hunt_knowledge write-backs are non-fatal
  (safe during index-rebuild write locks).
- `hunt-convergence-alerts` + `hunt-convergence-alerts-pm` — suppression now
  keys off discriminating accuracy (v2 grades with lift > 1), 40% bar kept,
  percentage units throughout, missing data defaults to NOT suppressed.

## Deferred (blocked on the hunt_knowledge write lock / migration push owner)

**Step C1 — push the docket migration** (after Step 0 above passes, alongside
or after Step 4):

- `20260702090000_claim_court.sql` — creates `hunt_claims` + `hunt_claim_fires`,
  schedules `hunt-claim-court-daily` (09:00 UTC, idempotent DO block), and
  seeds the first four claims: `drought-heat-amplification`,
  `bio-absence-leads-heat`, plus two KNOWN-PHYSICS BENCHMARKS
  (`tide-surge-coastal-flood`, `overcast-collapse-flood`) that act as positive
  controls — if the court cannot confirm known physics with lift > 1, the
  court is broken.

```bash
cd /Users/jameschellis/marsh-timer
npx supabase db push
```

**Step C2 — deploy the court function** (needs the tables from C1):

```bash
npx supabase functions deploy hunt-claim-court --no-verify-jwt
```

**Step C3 — verify** (next morning after the 09:00 UTC run, or fire it once
manually):

```bash
KEY=...   # as in Step 0
curl -s -X POST "https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-claim-court" \
  -H "Authorization: Bearer $KEY" -H "apikey: $KEY" -H "Content-Type: application/json" -d '{}'
# expect {"active_claims":4,...}; then check fires:
curl -s "https://rvhyotvklfowklzjahdd.supabase.co/rest/v1/hunt_claim_fires?select=*&limit=10" \
  -H "Authorization: Bearer $KEY" -H "apikey: $KEY"
```

Note: the cron is scheduled by the migration BEFORE the function is deployed
(C1 before C2). A cron firing into an undeployed function 404s harmlessly and
`hunt-claim-court` tolerates an empty docket — but do C2 immediately after C1
anyway.

## IVFFlat rebuild — options after the 2026-07-03 00:17 kill (DECISION NEEDED)

The in-transaction rebuild (lists=2645, 2GB maintenance_work_mem) ran 3h04m
without committing and was killed; rollback clean, old index (lists=1414)
still serving. The write-lock cost is the problem, not the rebuild itself.
Three ways forward, pick one:

**Option A — CREATE INDEX CONCURRENTLY via a long-lived script (recommended).**
No write lock; ingestion continues during the build. Cannot run inside a
migration transaction, so it needs a direct Postgres connection:
`scripts/rebuild-embedding-index-concurrent.ts` (to be written: postgres.js
client, statement_timeout=0, CREATE INDEX CONCURRENTLY hunt_knowledge_embedding_idx_v2
... lists=2645, then DROP old + RENAME in a fast follow-up statement, then
apply the parked migration's RPC-probes + pattern-worker parts).
NEEDS: the database password (Dashboard → Settings → Database), exported as
SUPABASE_DB_PASSWORD for the script run. Runtime likely 4-6h, nohup overnight.
Risk: a killed CONCURRENTLY build leaves an INVALID index to drop — cleanup is
one statement, documented in the script.

**Option B — temporary compute bump.** Upgrade the instance one tier in the
Supabase dashboard (more RAM + IO), re-run the parked migration (rename
.PENDING_CONCURRENT back to .sql, db push) in a deliberate window — likely
completes in well under an hour on bigger hardware — then downgrade. Costs a
few dollars, needs two dashboard clicks and a maintenance window (~15 min
restart on resize).

**Option C — scheduled blocking window.** Accept the write lock: re-run the
parked migration deliberately at the lowest-traffic hour with ingestion
expected to fail for however long it takes (3h+ observed; unbounded). Free
but proven painful. Not recommended.

Until one runs, vector search stays on the undersized index: the site chat's
semantic recall and the future "days like today" engine remain degraded (this
is the last blocker for both).
