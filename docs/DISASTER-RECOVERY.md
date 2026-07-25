# DISASTER RECOVERY — Duck Countdown

**Written 2026-07-25.** First DR document in the project's history. Two years of `docs/`
contained zero mentions of backup, restore, RPO, or PITR before this file — that absence
is itself the first finding.

Written because the anon key shipping in duckcountdown.com's public bundle was found to
hold `INSERT/UPDATE/DELETE/TRUNCATE` on 248 tables including `hunt_knowledge`. `TRUNCATE`
is not subject to RLS, so the entire ~10M-row archive was destroyable by anyone who opened
devtools. That hole is closed (commits `379095c`, `cec7c4a`, `029d0a5`, and the schema
default-ACL fix). This document answers the second question: **would we have survived it?**

Today the honest answer is *probably, with a bad day and collateral damage to two other
projects*. Below is exactly what exists, what is proven, and what is still belief.

---

## 1. What the coverage actually is

| Layer | Status |
|---|---|
| **PITR (point-in-time recovery)** | **OFF.** Declined against the ~$100/mo add-on. |
| **Supabase daily physical backups** | 7 daily whole-cluster physicals, ~08:40 UTC, 7-day rolling window. |
| **DCD board-stack logical dump** | `scripts/backup/dump-tables.ts` — 17 tables + the frame cache, verified against exact counts. **Built 2026-07-25.** |
| **Tested restore** | `scripts/backup/restore-drill.ts` — **passed 2026-07-25**, see §5. |
| **Off-cluster, off-Mac copy** | **NOT YET.** See §7 — this is the one condition still open, and it needs a human with credentials. |

### The RPO, stated precisely

The daily physical captures cluster state as of **~08:40 UTC**. `hunt-frame-daily`
(`supabase/migrations/20260711060000_schedule_frame_daily.sql`) writes the day's
`board_frames` row at **11:45 UTC** — *after* that morning's backup.

So the day's frame is never in the same day's backup. It first appears in the *next*
morning's 08:40 UTC physical.

- **Nominal RPO:** time elapsed since 08:40 UTC today.
- **Worst-case RPO:** ~24 hours — a wipe at 08:39 UTC loses everything written since
  08:40 UTC the previous day, including a full day's frame, morning lines, formation
  watch transitions, and court fires.
- **A wipe any time between 11:45 UTC and 08:40 UTC the next morning loses that day's
  frame row.** It is recomputable (§6), not lost forever, but it is not in the backup.

### The retention cliff

7 days. Corruption that is not noticed within 7 days is **permanent**. Nothing in the
stack currently detects silent corruption — the daily crons write, and nothing reads back
and compares. A wrong-but-plausible `board_frames` row would roll off the backup window
before anyone looked at that day again.

---

## 2. The standing risk: whole-cluster coupling

**Supabase backups are whole-cluster. There is no per-project, per-schema, or per-table
restore.**

Project `rvhyotvklfowklzjahdd` (named `jac-agent-os` in the Supabase dashboard) is shared
by three things:

- **Duck Countdown** — `hunt_*`, `board_*`, `era5_*`, `morning_lines`, `planting_climatology`, `formation_watches`
- **JAC Agent OS** — unprefixed tables
- **Lupa** — `lupa_*`

**Restoring DCD from a Supabase physical backup rolls JAC and Lupa back to the same
timestamp.** If someone truncates `hunt_knowledge` at 20:00 UTC and we restore to that
morning's 08:40 physical, Lupa loses ~11 hours of foundry work and JAC loses ~11 hours of
memory writes — neither of which had anything to do with the incident.

There is no single-project runbook. This is **not solvable inside the current timebox**
and is recorded here so it is not rediscovered under pressure at 3am. The mitigations that
exist today:

1. The logical dump in §3 restores DCD's board stack **without touching the cluster**, so
   most DCD-only incidents never need a physical restore at all.
2. If a physical restore is ever genuinely required, **tell the JAC and Lupa owners
   first** — it is their data too.

The real fix, when it is worth the money: split DCD onto its own Supabase project, or turn
PITR on so the blast radius is minutes instead of a day.

---

## 3. The logical dump — `scripts/backup/dump-tables.ts`

A PostgREST-paginated, count-verified, gzipped NDJSON dump. REST-only, per the project
law ("NEVER use psql or `db execute` — REST API only"). Read-only: `SELECT` and `HEAD`.

```bash
npx tsx scripts/backup/dump-tables.ts              # the dump
npx tsx scripts/backup/dump-tables.ts --dry-run    # counts only, no bytes written
npx tsx scripts/backup/dump-tables.ts --only=board_frames
npx tsx scripts/backup/dump-tables.ts --hunt-knowledge-plan
```

**Where it lands:** `$DCD_BACKUP_DIR`, default `~/dcd-backups/<ISO-timestamp>/`.
Deliberately **outside the repo** — a dump must never be a git accident or land inside a
Vercel build context. Keeps the last `$DCD_BACKUP_KEEP` (default 7) complete runs.

### What it covers — 17 tables

`board_frames`, `board_instruments`, `board_layout`, `board_strings`, `board_pool_luts`,
`board_rhymes`, `formation_watches`, `era5_state_pressure`, `era5_sampling_points`,
`morning_lines`, `planting_climatology`, `hunt_species`, `hunt_states`, `hunt_seasons`,
`hunt_zones`, `hunt_claims`, `hunt_claim_fires` — plus `scripts/frames/.frame-cache` as
`frame-cache.tar.gz` (§6).

`hunt_species` and `hunt_states` are 5 and 51 rows and look like trivia. They are FK
parents of `hunt_seasons`/`hunt_zones`, and the first restore drill **failed outright**
without them. A backup set is not a list of interesting tables — it is a **closed set
under foreign keys**.

### What it provably does NOT cover

- **`hunt_knowledge`** — the ~10.1M-row archive. See §4. This is the big one.
- **Everything else in the cluster** — JAC tables, `lupa_*`, and every `hunt_*` table
  outside the list above (storm events, GHCN daily, tide/buoy series, embeddings). The
  dump covers the **board stack**, not the archive.
- **Schema, RPCs, cron jobs, RLS policies, grants, vault secrets, edge functions.** The
  dump is rows only. Schema lives in `supabase/migrations/` (which is why the restore
  drill builds its target from those migrations — single source of truth), but
  **`cron.job` rows, `vault.secrets`, and the current grant/ACL state are captured
  nowhere.** After the 2026-07-25 ACL work that is a real gap: a restore would come back
  with whatever grants the migrations happen to specify, and the anon-write revocations
  are only durable because they are in migrations.
- **Point-in-time anything.** This is a nightly snapshot, not a log.

### The two traps it handles explicitly

1. **PostgREST silently caps every response at 1000 rows.** Every table is paginated with
   `Range` and then checked against a `Prefer: count=exact` count. A mismatch fails the
   run, refuses to sync, and exits non-zero. A dump that silently truncates is worse than
   no dump, because you believe in it.
2. **Offset pagination requires a total order.** Every table declares a key that is unique
   across the table, and the dump orders by it. Without that, Postgres may legally return
   the same row on two pages and no row on a third — and the count check would still pass.

### One honest limitation

Offset pagination against a **live, actively-written table** can skip rows if inserts land
*before* the current offset in sort order. `board_frames` is append-only by date and safe.
`era5_state_pressure` is currently being backfilled by another pipeline and its sort key
(`state_abbr, day, sampling_version`) is not append-ordered — its row count moved
9,131 → 13,514 during this session's runs. **For that table specifically, prefer a dump
taken when no backfill is running.** The count check catches deletions, not
insert-induced skew.

---

## 4. `hunt_knowledge` — the honest answer

Ruling condition 3 asks for `hunt_knowledge` in the dump. **It is not there, and REST
pagination cannot put it there.** Measured, not estimated:

| | |
|---|---|
| Rows | **10,103,644** (moving — the crons write continuously) |
| REST JSON bytes/row | **~7,200 B** (the 512-dim `embedding` column dominates) |
| Full dump over PostgREST | **~72 GB** across **~10,104 sequential 1000-row pages** |
| Without the `embedding` column | **~9 GB** |
| On-disk size in Postgres | ~68 GB |

**The disqualifying finding is not the size — it is that the deep pages do not complete
at all.** `--hunt-knowledge-plan` probes offsets 0, ~5.05M, and ~10.1M. The two deep
probes **fail with HTTP 500 (statement timeout)**: an `ORDER BY … OFFSET 5,000,000` on a
10M-row table exceeds the server's statement timeout. A dump that cannot fetch page 5,000
of 10,104 is not slow, it is **impossible**. Offset pagination is `O(n²)` over a full
table and this table is past the wall.

(A keyset/cursor rewrite paginating on `id` would avoid the deep-offset cost. It would
still be ~72 GB over ~10,000 requests, and it would still be torn — see below — so it is
not worth building.)

And even if the pages completed: **the daily crons write to `hunt_knowledge` throughout a
run that long**, so a multi-hour REST crawl produces a *torn* snapshot — no consistent
point in time, and no way to tell which rows came from which hour. That is not a backup,
it is a smear.

*Sampling caveat: with both deep probes failing, the ~7,200 B/row figure is measured from
the head of the table only. It lands close to the ~68 GB on-disk size, so it is the right
order of magnitude, but treat ~72 GB as an estimate rather than a measurement.*

### What is actually viable: `pg_dump`

`pg_dump` takes one consistent snapshot in a single transaction. **This path is proven, not
assumed** — verified read-only on 2026-07-25:

```bash
# The password is in .env.local as SUPABASE_DB_PASSWORD. Never commit it, never echo it.
set -a; . .env.local; set +a
export PGPASSWORD="$SUPABASE_DB_PASSWORD"

/opt/homebrew/opt/postgresql@17/bin/pg_dump \
  -h aws-0-us-west-2.pooler.supabase.com -p 5432 \
  -U postgres.rvhyotvklfowklzjahdd -d postgres \
  --no-owner --no-acl -Fc -Z6 \
  -t public.hunt_knowledge -f hunt_knowledge.pgdump
```

**Three gotchas, each of which would cost an hour at 3am:**

1. **The direct host does not work from this machine.** `db.rvhyotvklfowklzjahdd.supabase.co`
   — the connection string the Supabase dashboard hands you — is **IPv6-only** (AAAA
   `2600:1f13:838:6e2f:…`, no A record). This Mac has no global IPv6 route, so it fails at
   DNS with a confusing `nodename nor servname provided` error. **Use the session pooler on
   port 5432**, which is IPv4 and supports `pg_dump`.
2. **The region prefix is `aws-0-us-west-2`.** `aws-1-us-west-2` resolves fine and then
   rejects with `FATAL: (ENOTFOUND) tenant/user postgres.rvhyotvklfowklzjahdd not found`.
   The username must be `postgres.<project-ref>`, not `postgres`.
3. **The server is PostgreSQL 17.6; `pg_dump` 16 refuses** with `aborting because of server
   version mismatch`. `postgresql@17` was installed on this machine on 2026-07-25 for
   exactly this reason. A fresh machine needs `brew install postgresql@17` first.

**Measured on 2026-07-25:** `pg_dump -Fc -Z6` of `board_frames` (27,964 rows) took
**10.7 s** and produced **4.1 MB**. `pg_restore` of that artifact into the local drill
cluster took **62 ms** and reproduced digest `f8d73fae…` — identical to live production.
**Do not extrapolate that to 68 GB**; a 4 MB table is dominated by connection setup and
tells you nothing reliable about a multi-hour job. The real duration of a `hunt_knowledge`
dump is **unmeasured** — it was deliberately not run here (Supabase Pro IO budget, and the
one-write-pipe doctrine means a heavy read should be scheduled, not fired mid-session).

### The interim answer

**The Supabase 7-day whole-cluster physicals DO cover `hunt_knowledge`.** The gap is not
"no copy" — it is **"no copy outside the cluster,"** plus the 7-day cliff and the
whole-cluster coupling in §2. If the cluster itself is lost or the account is compromised,
`hunt_knowledge` is gone and only §6 remains.

**The embedding column is re-derivable** from `content` via Voyage (THE EMBEDDING LAW), so
a ~9 GB embedding-free dump is a legitimate cheaper option — 8× smaller, and it keeps the
irreplaceable part (the text) while dropping the part a pipeline can rebuild. But
re-embedding 10.1M rows is real Voyage spend and days of pipeline at the ≤20-per-batch
limit. It is a fallback, not a plan.

**Recommendation:** a weekly (not nightly) `pg_dump` of `hunt_knowledge` to object storage,
scheduled off-peak in the claimed write lane. Nightly is the wrong cadence for 68 GB.

---

## 5. The restore drill — condition 2, and what it caught

`scripts/backup/restore-drill.ts` restores a dump into a **throwaway Postgres** (it refuses
any `DRILL_PG_URL` pointing at a `supabase.co` host) and proves the round trip.

```bash
initdb -D /tmp/pgdrill -U drill --auth=trust
mkdir -p /tmp/dcdpg   # socket dir must be SHORT — Postgres caps the path at 103 bytes
pg_ctl -D /tmp/pgdrill -o "-p 55432 -k /tmp/dcdpg -c listen_addresses=127.0.0.1" -l /tmp/pgdrill.log start
createdb -h 127.0.0.1 -p 55432 -U drill dcd_restore_drill

DRILL_PG_URL=postgres://drill@127.0.0.1:55432/dcd_restore_drill \
  npx tsx scripts/backup/restore-drill.ts
```

It builds its schema from **this repo's own `supabase/migrations/`**, so the drill cannot
drift from production schema without the migrations drifting first.

### Result — 2026-07-25, PASSED

```
✓ schema      17 tables from supabase/migrations/            0.1s
✓ load        107,587 rows                                  12.6s
✓ contiguity  board_frames 1950-01-01 → 2026-07-24
              27,964 rows / 27,964 calendar days, 0 missing
✓ fidelity    restored md5 f8d73faeaad79ff4f715e5cb592eb3c6
              live     md5 f8d73faeaad79ff4f715e5cb592eb3c6
✓ arrays      201 sampled board_pool_luts rows, 116,208 elements exact
✓ DRILL PASSED — 107,587 rows in 12.6s (25.2s incl. schema + verification)
```

**Measured timings, written down as the ruling requires:**

| Step | Wall clock |
|---|---|
| Dump, 17 tables + frame cache, 107,587 rows | **156.8 s** (`board_pool_luts` alone is 135 s / 86%) |
| Dump size | **28.2 MB gz** (209.8 MB raw) + 8.1 MB frame cache |
| Restore, schema + all 17 tables | **12.6 s** |
| Restore incl. verification against live | **25.2 s** |
| `pg_dump`/`pg_restore` of `board_frames` alone | 10.7 s out / 0.06 s in |

The fidelity check is **not a sample**: it is a canonical per-row digest over all 27,964
`board_frames` rows — every field including the packed `dots` bytea — computed in SQL from
the restored table and in JS from **live production**, and compared.

### The drill earned its keep immediately — three real bugs

1. **FK closure hole.** The first run died on `relation "hunt_species" does not exist`.
   `hunt_seasons` and `hunt_zones` reference `hunt_species` and `hunt_states`, neither of
   which was in the backup set. **The countdown's season data was unrestorable.** Both
   added.
2. **Silent bytea corruption — the important one.** Row counts matched. Contiguity was
   perfect: 27,964 / 27,964, zero gaps. And **all 27,964 frames were corrupt.** PostgREST
   returns `bytea` as the string `\xd826f7…`, and a text parameter cast with `::bytea` does
   *not* run `bytea_in` on it — it stores the raw ASCII of the literal, double-encoding
   every blob to exactly 2× length. Fixed by `decode($n,'hex')`. **Only the byte-level
   comparison against production found this.** Counts and contiguity — the two checks the
   ruling explicitly named — both passed on 100% corrupt data.
3. **DDL parser shear.** The migrations document jsonb shapes in inline comments
   (`-- [{inst_id, metric, direction, offset}]`), whose commas sit at paren-depth 0.
   Splitting columns before stripping comments shredded the comment into phantom columns
   and shifted every value one slot right. Caught as a `NOT NULL` violation on
   `board_layout` — **a nullable column would have restored quietly wrong.**

Bug 2 is the whole argument for condition 2 in one line: *an untested backup is a belief,
and the obvious tests are not sufficient to convert it into knowledge.*

### What remains UNTESTED — stated plainly

- **The Supabase physical restore has never been performed.** Not once. We do not know its
  duration, whether the 7 daily backups are actually valid, or what the restore UI does to
  a shared cluster. This is the single largest remaining unknown, and it cannot be tested
  without creating a Supabase project — which this agent cannot do. **It is untested
  belief.**
- **`hunt_knowledge` has never been dumped or restored** at any scale. §4 is a measured
  plan, not a proven path. The 68 GB `pg_dump` duration is unknown.
- **The restore target was local Postgres 16, not Supabase.** Extensions
  (`vector`, `pg_cron`, `pgsodium`), RLS policies, grants, and RPCs were **not** part of
  the drill. Only table DDL and row data.
- **Restore INTO production was never attempted** — correctly, but it means the
  write-side of a real recovery is unexercised.
- **No cron, vault, or edge-function state is captured or tested** (§3).
- Rows-only fidelity was proven for `board_frames` (full table) and `board_pool_luts`
  (201-row sample). The other 15 tables are verified by **row count only**.

---

## 6. The reconstruction path (if the archive is gone)

If `hunt_knowledge` is lost beyond the 7-day window, the board stack is still rebuildable —
this was the *only* path that existed before 2026-07-25:

1. **`scripts/frames/.frame-cache`** — 74 files, 35 MB on disk, per-instrument full-history
   series (GHCN state series, tide gauges, buoys, CPC AO). `backfill-frames.ts` reads it
   instead of the database, so a rebuild re-reads nothing.
2. **`scripts/frames/backfill-frames.ts`** — recomputes all 27,964 frames from those series
   against `registry.ts`.
3. **`scripts/frames/bake-luts.ts`** — rebakes `board_pool_luts`.

**The hole the ruling named:** `.frame-cache` is `.gitignore:49`, `git ls-files` returns 0,
it lives on one Mac, and its upstream is `hunt_knowledge` **in the same cluster**. A cache
that only survives what it is meant to survive by accident is not a backup.

**Fixed as of 2026-07-25:** the dump now captures it as `frame-cache.tar.gz` (8.1 MB
compressed) with a sha256 in the manifest, so it travels to object storage with everything
else.

### Should `.frame-cache` stop being gitignored? — recommendation: **no, keep it ignored.**

Putting 35 MB of regenerable binary into git bloats every clone forever and can never be
removed without a history rewrite. The backup artifact is the better home: it is versioned,
checksummed, outside the repo, and headed off-machine. **But that is only true once §7 is
done.** Until the dump is actually leaving this Mac, `.frame-cache` still exists in exactly
one place — so if §7 is going to sit unfinished for more than a few days, commit the
tarball to the repo as a stopgap and delete it once object storage is live. A tracked 8 MB
tarball is ugly; losing the only reconstruction path is worse.

---

## 7. Pointing this at object storage — THE OPEN CONDITION

**Ruling condition 1 is not yet satisfied.** The dump currently lands in `~/dcd-backups`,
which is outside the cluster (good) but still **one Mac** (not good). That is a second
copy, not a second failure domain. A stolen laptop or a dead SSD takes it.

The script will not — and cannot — create a cloud account or enter credentials. **This
needs a human, once.** Everything else is wired.

Set `DCD_BACKUP_SYNC_CMD` to any command that pushes the run directory. It runs **only
after every table has verified**, and receives `$DCD_BACKUP_RUN_DIR` and
`$DCD_BACKUP_ROOT` in its environment. Pick one:

```bash
# Cloudflare R2 / Backblaze B2 / S3 — via rclone (recommended: different vendor than Supabase's AWS)
export DCD_BACKUP_SYNC_CMD='rclone copy "$DCD_BACKUP_RUN_DIR" r2:dcd-backups/$(basename "$DCD_BACKUP_RUN_DIR")'

# AWS S3 — via the aws CLI
export DCD_BACKUP_SYNC_CMD='aws s3 sync "$DCD_BACKUP_RUN_DIR" s3://dcd-backups/$(basename "$DCD_BACKUP_RUN_DIR")'

# Bare minimum, zero signup: an external disk or a second machine
export DCD_BACKUP_SYNC_CMD='rsync -a "$DCD_BACKUP_RUN_DIR" /Volumes/Backup/dcd-backups/'
```

**Choose a vendor that is not AWS us-west-2**, so a regional AWS event cannot take the
cluster and the backup together.

### Then schedule it

`launchd` is the right tool on this Mac — there is precedent in
`scripts/com.duckcountdown.daily-indices.plist`. Schedule it **after 11:45 UTC**, so each
night's dump contains that day's frame rather than missing it by four hours.

### Set-and-forget checklist

- [ ] Create an object-storage bucket (R2 / B2 / S3), private, versioning on
- [ ] Configure `rclone`/`aws` credentials locally — **never in the repo, never in git**
- [ ] Export `DCD_BACKUP_SYNC_CMD` in the launchd plist environment
- [ ] Run `npx tsx scripts/backup/dump-tables.ts` once by hand; confirm objects land
- [ ] Schedule nightly after 11:45 UTC
- [ ] Add bucket-side lifecycle retention (≥30 days — longer than Supabase's 7-day cliff)
- [ ] Re-run the §5 drill against a **downloaded-from-object-storage** copy, not a local one
- [ ] Schedule the weekly `hunt_knowledge` `pg_dump` (§4)

---

## 8. Runbook — "the archive just got wiped"

1. **Stop the writers first.** Unschedule the DCD crons before restoring anything, or the
   daily jobs will write into a half-restored table:
   `SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname LIKE 'hunt-%';`
2. **Scope the damage.** Which tables? Exact counts vs. the newest `manifest.json` in
   `~/dcd-backups/*/`. Note the wall-clock time — it decides which backup you want.
3. **If it is board-stack only** (`board_*`, `morning_lines`, `formation_watches`,
   `hunt_seasons`, court tables) → **use the logical dump.** ~13 seconds of restore, no
   cluster involvement, **no impact on JAC or Lupa.** This is the good case and covers most
   plausible incidents. Restore per §5 into a scratch DB first, verify, then write to
   production through the service role.
4. **If `hunt_knowledge` is hit** → the logical dump does not have it (§4).
   - **Notify the JAC and Lupa owners before doing anything.** A physical restore is their
     rollback too (§2).
   - Restore the cluster from the most recent daily physical predating the damage
     (Supabase dashboard → Database → Backups). Everything cluster-wide rolls back to
     ~08:40 UTC of that day.
   - Expect to lose that day's frame if the wipe was after 11:45 UTC (§1). Recompute it
     with `hunt-frame-daily` or `backfill-frames.ts`.
5. **If the cluster itself is gone** → §6 reconstruction from `frame-cache.tar.gz` in the
   newest backup run, plus `backfill-frames.ts` and `bake-luts.ts`. This rebuilds the
   board, **not the archive**. The archive would have to be re-ingested from source APIs.
6. **Re-verify before re-enabling crons.** Run the §5 drill's contiguity and fidelity
   checks against the restored production tables. Then re-schedule the crons.
7. **Write down what happened and what it cost**, in this file.

---

## 9. Open items, in priority order

| # | Item | Owner | Why it matters |
|---|---|---|---|
| 1 | **Point `DCD_BACKUP_SYNC_CMD` at object storage** (§7) | human, needs credentials | Ruling condition 1. Until this is done the dump is on one Mac and the ruling is unsatisfied. |
| 2 | **Schedule the nightly dump** after 11:45 UTC | — | An unscheduled backup script is a script, not a backup. |
| 3 | **Weekly `hunt_knowledge` `pg_dump`** to object storage (§4) | — | The archive is the irreplaceable asset and has no off-cluster copy. |
| 4 | **Capture cron + grant + vault state** (§3) | — | Post-ACL-incident, restoring rows without grants restores the vulnerability. |
| 5 | **Perform one Supabase physical restore drill** | needs a scratch project | The largest untested belief in the stack (§5). |
| 6 | **Reconsider PITR**, or split DCD onto its own project | James | Collapses both the 24 h RPO and the whole-cluster coupling. ~$100/mo. |
| 7 | **Add a read-back integrity check** to the daily crons | — | Nothing detects silent corruption inside the 7-day window (§1). |

---

## 10. Provenance

Everything in this document was measured on **2026-07-25** against project
`rvhyotvklfowklzjahdd`, read-only. Dump of record:
`~/dcd-backups/2026-07-25T02-00-52Z/` — 17 tables, 107,587 rows, 28.2 MB gz, 156.8 s;
`frame-cache.tar.gz` sha256 `7a148c8047946ddc476f201b3ef852cc6f4652e026744b546a160d787e170e6c`.
Restore drill target: local PostgreSQL 16.10 on port 55432, a throwaway cluster.
Production server: PostgreSQL 17.6. No production writes were made.
