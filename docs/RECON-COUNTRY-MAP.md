# RECON — COUNTRY MAP
### Read-only reconnaissance for DCD-RECON-v2 Part 2 · executed 2026-07-24

**Method.** Twelve agents, read-only. Eight ran one lettered block each (A–H) against the live repo and the live database; three ran afterward as adversarial verifiers whose instructions were to *refute* the most load-bearing claims — the two bug diagnoses and the Court-reuse verdict. A twelfth ran a separate inventory of dormant hunting machinery (summarized in block I). No code was written, no migrations run, no functions deployed. Database access was SELECT-only over PostgREST.

**How to read it.** Every claim is meant to carry a file:line citation or pasted query output. Where a question could not be settled, the answer says **UNVERIFIED** and names what would settle it. Verifier verdicts are inlined directly beneath the claims they tested — read those before acting on A1, A2, or E4.

---

## A. THE TWO LIVE BUGS

### A1. `/atlas` dossier hangs on "descending into <state>…"

**What the code does.** `AtlasPage.selectState()` (`src/pages/AtlasPage.tsx:372-406`) sets `loading=true` at :377, then `await Promise.all([hunt-atlas-spot, hunt-atlas-solunar])` at :390-393, and clears `loading` only in `finally` at :403-405. The panel renders `descending into {state}…` for the whole of that window (`AtlasPage.tsx:658-662`). The fetch helper is `getJson` (`AtlasPage.tsx:40-43`): **no `AbortController`, no timeout, no `res.ok` check.** So the panel's stuck state is exactly "the slower of two fetches has not settled," with no ceiling, no error path for a stalled socket, and no retry.

**Direct reproduction (curl + in-page fetch, same args the page sends).** Every invocation returned HTTP 200 — I could **not** reproduce a permanent hang.

| call | result |
|---|---|
| `hunt-atlas-spot?state=MD` ×6 | 200 in 14.83s, 5.65s, 6.96s, 7.08s, 2.55s, 1.98s |
| `hunt-atlas-spot?state=TX` ×5 | 200 in 7.64s, **28.43s**, 14.73s, 5.29s, 5.07s |
| `?state=CA/AK/DE` | 200 in 6.25s / 5.73s / 7.10s |
| `hunt-atlas-solunar?lat=31.4757&lng=-99.3312` | 200 in 0.24s |
| CORS preflight, both `duckcountdown.com` and `www.` origins | 204, correct `allow-origin` (allowlist `supabase/functions/_shared/cors.ts:1-5` covers both) |

Browser repro on the live site (`www.duckcountdown.com/atlas?state=TX`): `hunt-atlas-spot?state=TX` showed `statusCode: pending` on first network read and `200` later; the dossier then rendered in full (headline, DAYS THAT READ LIKE TODAY, NOW, SOLUNAR, the 5-of-5 lineup, the 13-of-75 control line). Console had zero app exceptions — only three repeats of the Chrome-extension `"listener indicated an asynchronous response…"` noise. Deployed code is current: live chunk `AtlasPage-XCVUWBEb.js` de-minifies to the same `selectState`, and `hunt-atlas-spot` is deployed v26 / `updated_at=1784275287928` (≈2026-07-17), matching HEAD (`9d4ecbf`, 2026-07-17).

**Where the seconds go.** Not the archive reads — I timed each one directly against PostgREST with the function's own predicates: the 1,078-date `.in()` GHCN pull (`hunt-atlas-spot/index.ts:809-839`) is 0.50–0.98s; the tide pull (`:590-600`) 0.57s; all four `that_day` queries (`:372-415`) 0.17–0.20s. The cost is `search_hunt_knowledge_v3` (`:1454`): **3.84s cold, 0.97s warm**, against a `SEMANTIC_BUDGET_MS = 4000` race (`:1452-1462`). Cold it sits on the knife edge of its own budget, and the losing `runSearch()` promise is never cancelled — it keeps running in Postgres after the race resolves. The rest is isolate cold-start plus the serial paginated loops.

**Verdict.** UNVERIFIED — I cannot confirm an *indefinite* hang; 20/20 invocations completed (1.98s–28.43s). What is verified: a 2–28s wait with a UI that is indistinguishable from dead, plus a code path where any genuinely stalled response (isolate reaped mid-stream, dropped socket) leaves `loading=true` **forever** with no error state. To separate the two, instrument the live page: log `performance.now()` around the `Promise.all` and record whether the request ever settles.

**Smallest fix (described, not applied).** In `getJson` (`AtlasPage.tsx:40-43`), take an `AbortSignal`, pass `AbortSignal.timeout(20000)`, and throw on `!res.ok`. In `selectState`, replace `Promise.all` with two independently-awaited promises so solunar (0.2s) paints immediately and the spot block fills in behind it, and add a request token (`const myReq = ++reqRef.current`) checked before every `setDossier`/`setLoading` so a slow earlier state can't overwrite a newer one. Server-side, drop `SEMANTIC_BUDGET_MS` to ~2500 so the cold vector search fails to `unavailable` instead of dominating the response.

### A2. Daily headline stuck on a few states; consecutive days reuse the same rhyme

Two independent selectors, both degenerate. Neither is caching, and the frame is *not* static (with one edge-case exception).

**Subject state — `porchLine()`, `src/lib/board/frameStore.ts:524-578`.** The winner is `deep[0]` after `.sort((a,b) => (b.pct ?? 0) - (a.pct ?? 0))` (:533-535), or `corroborated[0]` (:542, :554-558) when live alerts exist. `pct` comes from an 8-bit byte: `pctOf = b/254` (`:265`), so it **saturates at exactly 1.0000**. I decoded `board_frames.dots` for 2026-07-01…07-24 against the 72 active `board_instruments` (ordered by `slot_offset`, matching `fetchInstruments` at `:81-90`) and reproduced the winner exactly:

| day | #deep(≥0.85) | #tied at 1.0000 | winner (slot) | other states tied at 1.0000 |
|---|---|---|---|---|
| 07-02 | 32 | 6 | **Delaware** (22) | MA, MD, ME, RI |
| 07-03 | 30 | 5 | **Delaware** (22) | MA, MD, NC, VA |
| 07-04 | 24 | 4 | **Delaware** (22) | MD, NC, VA |
| 07-12→07-15 | 19–25 | 3 | **Alaska** (8) | CA, TX / LA, UT |
| 07-16, 07-19→07-22 | 17–27 | 1–2 | **California** (16) | NY |
| 07-17, 07-18 | 21, 19 | 3 | **Arizona** (14) | CA, FL, VT |
| 07-23, 07-24 | 29 | 3 | **Alaska** (8) | NY, TX |

24-day winner tally: **California 11, Alaska 6, Delaware 3, Arizona 2, Oregon 1, Florida 1** — the brief's observation, exactly. The cause is a **tied argmax broken by array order**: JS `sort` is stable, `slot_offset` is assigned alphabetically by state, so among states pinned at byte 254 the alphabetically-earliest always wins (AK=8, AZ=14, CA=16, DE=22). `EXTREME_DEPTH = 249/254 = 0.9803` (`:252`) is met by 2–15 states/day, so the corroborated branch inherits the same tie. Past days in THE DAYS BEFORE get `live = undefined` (`src/pages/TodayPage.tsx:286-290`), so they always land in the `deep[0]` branch.

**Rhyme — `hunt-board-rhyme`, argmax over a flat score field.** `board_rhymes` rank-1 for 2026-07-01…07-24 (24 rows, all distinct days) shows Jul 15 & 16 → `1990-03-16`, Jul 18 & 19 → `2021-09-30`. **Not cached**, decisively:

- Jul 15 `cos=0.562949 score=0.558029`; Jul 16 `cos=0.559467 score=0.556639` — different values, same winner.
- Jul 18 `computed_at=2026-07-18T18:43:36Z`, `score=0.487291`; Jul 19 `computed_at=2026-07-19T12:10:07Z`, `score=0.482254` — **separate cron runs**, and their ranks 2–5 are completely disjoint sets (07-18: 1977-05-14, 2021-10-01, 1975-07-29, 1988-06-01; 07-19: 1986-07-13, 1983-08-11, 1954-06-15, 2016-06-11). Independent recomputation converging on the same head.

**The frame does vary** — I recomputed `hunt-board-rhyme`'s own metric (`index.ts:104-134`, γ=1.5) between consecutive July frames: cos ranges 0.5654–0.9604 (07-15↔07-16 = 0.8183; 07-18↔07-19 = 0.7457). The one exception is **07-23↔07-24: cos = 1.0000, magAgree 0.9982** — 07-24 carries `day0_source='live-yesterday'` and is a byte-for-byte reissue of 07-23's shape.

**So: degenerate, not cached, not static.** On 2026-07-15 rank-1 score 0.558029 vs rank-5 0.536495 — a **3.9% spread across the entire top 5** over a 27,953-day candidate pool; on 07-16 the top-5 set *and order* are identical to 07-15 despite the frame moving 0.18 in cosine. The score surface is flat enough that a real day-over-day frame change doesn't reorder it. Two aggravators: `magAgree` reorders against `cos` (07-18 rank-3 `2021-10-01` has cos 0.609975 > rank-1's 0.583373), and the candidate pool contains adjacent days of the same system (`2021-09-30` and `2021-10-01` both in one top-5), so a single strong attractor system re-wins.

**What would separate causes if you doubt this:** compare `board_rhymes.score` rank-1 minus rank-2 against the day-over-day frame cosine. Here the gap is ~0.002–0.02 while the frame moves 0.15–0.25 — that is argmax degeneracy, not caching (which would show byte-identical scores) and not a frozen frame (which 07-01…07-22 rules out).

---

> ### ⚖︎ ADVERSARIAL VERIFY — A1 · the /atlas dossier hang
> *An independent agent instructed to refute the finding above, re-deriving it from the files and queries itself.*

> VERDICT: PARTIALLY CONFIRMED (diagnosis right in shape, mechanism partly wrong, one fix wrong)
> 
> **Independently reproduced.** Every cited line is exact: `getJson` `AtlasPage.tsx:40-43` (no AbortController, no timeout, no `res.ok`), `selectState` :372-406, `Promise.all` :390-393, `finally`/`setLoading(false)` :403-405, banner :658-662, `SEMANTIC_BUDGET_MS=4000` race `hunt-atlas-spot/index.ts:1452-1462`. Deploy is v26 / `updated_at=1784275287928`. 23 live invocations of my own — serial with the browser's anon key + `origin: www.duckcountdown.com`, plus an 8-way parallel burst — returned **HTTP 200, 1.70s–11.41s, zero hangs**. Solunar 0.20s; storms 1.1–4.4s and is fired un-awaited (:386-388), so it cannot gate the panel.
> 
> **Could NOT reproduce / refuted.**
> 1. **"no error path" is false.** `AtlasPage.tsx:673-677` renders "Couldn't read {state} right now." Any rejection clears `loading`. Only a socket that never settles hangs — narrower than reported.
> 2. **Cost attribution is wrong.** The budget already caps the vector search: `?state=AK` and `?state=HI` returned `past.semantic_rhyme.unavailable=true` (budget fired) yet totalled 5.27s/5.52s — so semantic ≤4s and everything else ≈1.3s. But AK also took **11.41s** with that same 4s cap in force, meaning >7s of the variance is *not* `search_hunt_knowledge_v3`. The report never accounts for it.
> 3. **Fix #3 is wrong.** Dropping `SEMANTIC_BUDGET_MS` to 2500 cannot affect a hang — the response is already hard-bounded — and would silently kill the semantic rhyme on states that currently succeed (TX `n_searched=106,522`, ND 25,921). It trades a working feature for ~1.5s.
> 
> **Missed.** The absent `res.ok` check produces a *malformed dossier*, not a hang: `?state=ZZ` → HTTP 400 `{"error":"Unknown state 'ZZ'."}`; `getJson` parses it happily, and every field in `/Users/jameschellis/marsh-timer/src/lib/atlas/spotDossierAdapter.ts` response interfaces is optional, so `toSpotData` returns an all-null `SpotData` and the card renders empty — bypassing the :673 error branch entirely. Same for any 5xx with a JSON body (BOOT_ERROR / WORKER_LIMIT).
> 
> Fixes #1 (`AbortSignal.timeout` + throw on `!res.ok`) and #2 (split `Promise.all`, request token) are correct and each alone converts the theoretical hang into the existing error card.

---

---

> ### ⚖︎ ADVERSARIAL VERIFY — A2 · the stuck headline and repeated rhyme
> *An independent agent instructed to refute the finding above, re-deriving it from the files and queries itself.*

> VERDICT: PARTIALLY CONFIRMED
> 
> **Reproduced independently** (72 active instruments, 24 frames 07-01..07-24, decoded `dots` bytea myself, re-implemented `resolveDay`/`porchLine` deep-branch):
> - Winner tally **exactly**: California 11, Alaska 6, Delaware 3, Arizona 2, Oregon 1, Florida 1.
> - Tie-break mechanism confirmed: `ghcn-ak`=8, `az`=14, `ca`=16, `de`=22 — `slot_offset` is alphabetical, `sort` is stable, and in every tied day the winner is the minimum slot_offset.
> - Frame is not static: day-over-day cos 0.5654–0.9604; 07-15→16 = 0.8183, 07-18→19 = 0.7457; **07-23→24 cos = 1.0000, mag 0.9982, byte-identical=false but `day0_source='live-yesterday'`** — reproduced.
> - `board_rhymes` rank-1 repeats confirmed (07-15/16 → 1990-03-16; 07-18/19 → 2021-09-30), ranks 2–5 disjoint on 07-18 vs 07-19, top-5 order identical on 07-15/16.
> 
> **Could NOT reproduce / report is wrong:**
> 1. **"Separate cron runs" for 07-15/07-16 is false.** All of 07-01..07-16 share `computed_at = 2026-07-17T03:07:07.592Z` — one backfill batch. Only the 07-18/07-19 pair has genuinely separate runs. The not-cached argument survives (differing scores), but its stated evidence for the headline example is wrong.
> 2. **"Saturates at exactly 1.0000" is too narrow.** 07-05..07-08 have **zero** slots at 1.0 yet California still wins (0.9961, byte 253) with Utah/New York tied at the same byte. The real cause is 254-level quantization ties generally, not ceiling saturation.
> 3. Report's 07-02 tied list omits Virginia (6 tied, 4 listed); its table silently drops 07-01 and 07-05..07-11, which carry the Oregon/Florida winners.
> 
> **Missed competing explanations:**
> - The tally is the **past-day path only** (`live=undefined`). The live headline hits `corroborated[0]` or the `formingAll` branch first — the report asserts the corroborated branch "inherits the same tie" with **no evidence**, and never tested it. The headline symptom is therefore only indirectly evidenced.
> - **Unreported coverage regression:** instruments-with-data drops 55→50 and overlap 110→100 at 07-17. A shrinking pool independently concentrates winners.
> 
> **Fix:** report proposes none for A2. Diagnosis alone is insufficient — needs a non-slot-order tie-break (seeded via existing `daySeed`, or sub-byte raw values) plus a check that the corroborated branch doesn't reintroduce it.

---

## B. IS THE MACHINE STILL RUNNING

**Verdict: the machine is running.** The board bakes daily on schedule, the rhyme bakes 25 min later, the backfill is perfectly contiguous, and 37 of 60 registered crons are green. What's dead is dead on purpose (the 07-17 synthesis kill), plus four genuine silent failures.

### B1. board_frames currency and hunt-frame-daily

**The prior "no hunt_cron_log rows under hunt-frame-daily" finding is WRONG.** There are 64 rows in the last 30 days under the exact name `hunt-frame-daily` (62 success, 2 error). The earlier check most likely queried before the cron existed (it was only registered 2026-07-11, `supabase/migrations/20260711060000_schedule_frame_daily.sql:19-20`, `'45 11 * * *'`) or hit the `hunt_knowledge` timeout pattern.

- Most recent `board_frames` day: **2026-07-24**, `updated_at` `2026-07-24T11:45:46.723956+00:00`, `day0_source":"live-yesterday"`.
- Column is `day` (date), **not** `frame_date` — `board_frames.frame_date does not exist` (42703).

Last 14 firings (function_name=`hunt-frame-daily`, all `success`):

| fired (UTC) | ms | days baked |
|---|---|---|
| 2026-07-24T11:45:46 | 44605 | 07-23, 07-24 |
| 2026-07-23T11:45:43 | 40695 | 07-22, 07-23 |
| 2026-07-22T11:45:42 | 40773 | 07-21, 07-22 |
| 2026-07-21T11:45:04 | 2637 | 07-20, 07-21 |
| 2026-07-20T11:45:05 | 3455 | 07-19, 07-20 |
| 2026-07-19T11:45:05 | 2650 | 07-18, 07-19 |
| **2026-07-18T14:04:00** | 4502 | 07-17, 07-18 |
| 2026-07-17T11:45:04 | 2381 | 07-16, 07-17 |
| 2026-07-17T03:06:46 …03:06:34 (7 rows) | ~1.5s ea | backfill of 06-30→07-12 |

Two observations the brief should absorb: (a) the 07-18 miss is real — it fired at **14:04**, not 11:45, confirming the by-hand rescue; every firing since has been on the minute. (b) Runtime jumped 10× on 07-22 (2.6s → 40.8s) and again to 44.6s on 07-24. Every run reports the same `slots:144, lutRows:178`, so the work volume is constant — something got slower, not bigger. Worth watching; at this growth rate it approaches edge-function timeout territory. UNVERIFIED cause — would need the function's internal timing logs or a manual invoke with instrumentation.

### B2. The full cron fleet

Three methods, and they disagree — say which gave what:

1. **`rpc/get_cron_job_status`** (exists over REST, returns live `cron.job` rows) — **60 registered jobs**, all DCD (`hunt-%` plus `vacuum-hunt-knowledge-oneshot`; it appears to filter on `%hunt%`, so no JAC `ct_` jobs leak). This is the authoritative live registry. Its `last_successful_run` column is **null for all 60** — the join to `cron.job_run_details` returns nothing, so the RPC cannot answer "last success."
2. **`hunt_cron_log`** — 11,956 rows in the last 30 days across **59 distinct function_names**. This is the only working source of last-success.
3. **`supabase/migrations/*.sql`** grep — 100 distinct `cron.schedule` names, i.e. **40 historical names no longer registered** (killed or renamed). Do not treat the migration grep as the fleet.
4. `rpc/get_cron_status` **times out** (57014).

Named crons the brief asked about:

| job | schedule | source | last success |
|---|---|---|---|
| `hunt-frame-daily` | `45 11 * * *` | 20260711060000:19 | 2026-07-24T11:45:46 ✅ |
| `hunt-board-rhyme` | `10 12 * * *` | 20260712232251:49 | 2026-07-24T12:10:23 ✅ (`frames:27964`, rank1 rhyme 1993-08-0x, score 0.772) |
| `hunt-air-quality` | `15 6 * * *` | 20260390:39 | 2026-07-24T06:15:23 ✅ (`air_quality_embedded:50`) |

**Correction to Part 1:** this is not an AirNow bake. `supabase/functions/hunt-air-quality/index.ts:100` calls `air-quality-api.open-meteo.com/v1/air-quality`, tagged `source:"open-meteo-air-quality"` (line 149). 50 rows/day = one per state, so it is state-level with no monitor coordinates.

Green in the last 48h (last success, UTC): `hunt-weather-realtime` 07-24T23:00 (2927 runs/30d), `hunt-nws-monitor` 07-24T23:00 (737), `hunt-query-signal` 07-24T23:00, `hunt-power-outage` 07-24T21:03, `hunt-formation-watch` 07-24T19:00, `hunt-ocean-buoy` 07-24T18:45, `hunt-space-weather` 07-24T18:15, `hunt-alert-grader` 07-24T17:00, `hunt-morning-grader` 07-24T13:00, `hunt-search-trends` 07-24T12:00, `hunt-birdcast` 07-24T10:08, `hunt-gbif` 07-24T09:45, `hunt-anomaly-detector` 07-24T09:31, `hunt-claim-court` 07-24T09:00, `hunt-wildfire-perimeters` 07-24T08:30, `hunt-snotel` 07-24T08:01, `hunt-migration-monitor` 07-24T07:20, `hunt-pattern-link-worker` 07-24T07:20, `hunt-snow-cover` 07-24T07:02, `hunt-bio-correlator` 07-24T06:45, `hunt-nasa-power` 07-24T06:33, `hunt-weather-watchdog` 07-24T06:08, `hunt-river-discharge` 07-24T05:00, `hunt-soil-monitor` 07-23T05:30, `hunt-multi-species` 07-23T11:00.

Stale but **on cadence** (weekly/monthly, not broken): `hunt-alert-calibration` Sun 07-19, `hunt-absence-detector` Sun 07-19, `hunt-solunar-precompute` Sun 07-19, `hunt-climate-indices` Mon 07-20, `hunt-drought-monitor` Tue 07-21 (drives `hunt-drought-batch1..5`), `hunt-disaster-watch` Wed 07-22, `hunt-inaturalist` Wed 07-22, `hunt-historical-news` Sat 07-18, `hunt-usfws-survey` monthly 07-01.

Registered-but-dark, i.e. the 15 names in `cron.job` that never appear in `hunt_cron_log` — these are batch-fanout jobs whose worker logs under a different name (`hunt-drought-batch1..5`→`hunt-drought-monitor`, `hunt-migration-batch1..5`→`hunt-migration-monitor`, `hunt-birdcast-b1..b5`→`hunt-birdcast`, `hunt-nasa-power-batch1..2`, `hunt-weather-watchdog-b1..b5`, `hunt-alert-grader-afternoon`). Not failures.

The ~20 functions last seen 07-01→07-16 (`hunt-narrator`, `hunt-arc-narrator`, `hunt-daily-digest`, `hunt-forecast-tracker`, `hunt-correlation-engine`, `hunt-synthesis-reviewer`, `hunt-scout-report`, `hunt-du-map`, `hunt-du-alerts`, `hunt-web-curator`, `hunt-movebank`, plus the 07-05/07-11 convergence kill: `hunt-convergence-scan`/`-engine`/`-alerts`/`-report-card`, `hunt-brain-synthesizer`, `hunt-migration-report-card`, `hunt-wikidata-ingest`, `hunt-nrhp-ingest`) are **intentionally unscheduled** by `supabase/migrations/20260717080000_kill_dead_synthesis_crons.sql:26-36`. Confirmed absent from the live 60.

### B3. Backfill contiguity — perfectly contiguous, no gaps

Pulled all 27,964 `day` values via 28 paginated REST calls (1000/page) and diffed against a generated date range:

```
first 1950-01-01  last 2026-07-24  n 27964
span days 27964   missing 0        duplicates 0 (27964 rows, 27964 distinct)
MISSING RANGES: 0
```

Date-span arithmetic matches the row count exactly. Note the count is **27,964, not 27,951** — the brief's figure was 13 days stale (it grows +1/day from the daily bake; `hunt-board-rhyme` summaries confirm the walk: `frames:27954` on 07-14 → `27964` on 07-24).

### B4. Sizes, and what is actually broken

On-disk size is **UNVERIFIED** — no `pg_total_relation_size` RPC is exposed over PostgREST, and psql / `db execute` are barred. To get it you'd need a read-only SQL RPC added, or the Supabase dashboard's Database → Tables size column. What I can give is measured JSON payload bytes (a floor, excludes TOAST compression, indexes, and row overhead):

| table | rows | measured JSON bytes | per-row | RLS |
|---|---|---|---|---|
| `board_frames` | **27,964** | 22,577 B / 50 recent rows | ~451 B | **off** |
| `board_instruments` | **72** | 34,686 B (all) | ~482 B | **off** |
| `board_layout` | **2** | 23,133 B (all) | ~11.6 KB | **off** |
| `board_strings` | **0** | — | — | **off** |
| `board_rhymes` | **220** | ~571 B/row | ~571 B | on |
| `formation_watches` | **90** (10 forming, 80 faded) | ~908 B/row | ~908 B | UNVERIFIED (not in the RLS RPC output I sampled) |
| `board_pool_luts` (bonus) | **64,782** | — | — | off |

So the entire board stack is **~13 MB of JSON at most** — trivially small. Frame payload size is flat across eras (22,577 B for the 50 newest vs 22,648 B for the 50 oldest vs 22,698 B for 1990), so the 40s bake time is not a payload-growth story.

Two things to flag from this table: **`board_strings` is empty (0 rows)** while `board_frames` carries a `strings` column inline — the separate table is vestigial. And `board_rhymes` only runs **2021-02-15 → 2026-07-24** (220 rows), not the full 27,964-day span, so the rhyme layer covers ~0.8% of the archive.

**Crons that have NOT succeeded in the last 48h and are genuinely broken (not weekly-cadence, not intentionally killed):**

| job | schedule | problem |
|---|---|---|
| `hunt-crop-progress-weekly` | `0 14 * * 5` | Fires correctly (07-24T14:00, a Friday) but status is **`partial` on all 4 runs in 30 days — zero successes ever recorded in the window.** |
| `hunt-birdweather-daily` | `30 5 * * *` | Fires daily (last 07-24T05:30) but **`partial` 21× / `success` 10×; last true success 2026-07-03.** Three weeks of degraded ingest, silent. |
| `hunt-phenology-weekly` | `0 9 * * 3` | Registered in `cron.job`, but **the only `hunt-phenology` row in `hunt_cron_log` ever is 2026-03-20T03:24, status `partial`.** Four months dark and unnoticed. |
| `hunt-ops-cache-refresh` | `17 * * * *` | Zero log rows — but it calls `rpc/hunt_ops_refresh_cache` in-database, not an edge function, so absence from `hunt_cron_log` is expected. **UNVERIFIED whether it is running**; would need the cache table's `updated_at`. |
| `vacuum-hunt-knowledge-oneshot` | — | A oneshot left registered in `cron.job` after completing. Housekeeping, not a failure. |

Also mildly degraded: `hunt-soil-monitor` (partial 6 / success 24, last success 07-23T05:30 — one day behind), `hunt-space-weather` (9 errors/125), `hunt-power-outage` (12 errors + 1 partial / 183), `hunt-pattern-link-worker` (35 partial / 579).

The single actionable freshness signal for the header widget Part 1 §4 wants: `board_frames.updated_at` for `day = today` — it was `2026-07-24T11:45:46Z` at read time, and it is written by the same transaction as the bake, so no extra query is needed.

## C. THE RENDERER

### C1. Is it the same component?

**No — same *renderer module*, two hand-rolled call sites.** There is no shared `<Board>` component. Two page components each declare their own `<canvas className="block w-full touch-none select-none">`:

| | file:line | what it plays |
|---|---|---|
| `/` | `src/pages/TodayPage.tsx:573-578` | one-day film compiled from DB rows, drawn at fixed `t=0` in a ~30 fps breathe loop (`TodayPage.tsx:359-379`) |
| `/board/:story` | `src/pages/BoardPage.tsx:357-362` | multi-day baked JSON film (`/board/uri-2021.json`) with autoplay + scrubber |

Both import the engine `src/lib/boardPlayer.ts` (641 lines) — `drawFrame`, `fitCanvas`, `hitTest`, `compileFilm`. The ~30-line pointer-tap handler is **copy-pasted**: `BoardPage.tsx:256-284` vs `TodayPage.tsx:391-422` (identical 10px drag guard, identical card flip math). Extracting one `<BoardCanvas>` is a ~60-line dedupe, not a rewrite.

### C2. Projection code and geometry

**Projection math** — `scripts/board/projection.ts` (64 lines, **build-time only, never bundled**). Hand-rolled Albers conic equal-area, no d3 (`d3-geo` is not in `node_modules`; only `d3-color/ease/format/interpolate/path/scale/shape/time*` are). Parallels 29.5/45.5, origin −96/37.5, deterministic CONUS-bbox fit into 975×610 with `padX 34 / padTop 70 / padBot 40`, `PROJ_VERSION = 1`. A byte-identical inline duplicate sits at `scripts/board/bake-uri.ts:144-181`. Output is persisted to `board_instruments.albers_x/albers_y`; the client only rescales linearly (`boardPlayer.ts:332-349`).

**This projector has no AK/HI insets.** Verified by running it: `project(61.22,−149.90)` (Anchorage) → `(13.4, −196.4)`; `project(21.31,−157.86)` (Honolulu) → `(−450.4, 291.7)`. Matches live DB: `ghcn-ak` = `(-1.5,-248.5)`, `ghcn-hi` = `(-447.9,298.1)` — both drawn off-canvas.

**Geometry — three real copies, all shipped:**

| file | bytes | format | contents |
|---|---|---|---|
| `src/data/atlas/usStates.geojson.ts` | 60,884 | GeoJSON FeatureCollection, lon/lat | 51 features (50 + DC). Ships in the bundle via `stateBBoxes.ts:10` → `AtlasPage.tsx:7`, `BornPage.tsx:4` — but **only to build a 51-entry name lookup** (`stateBBoxes.ts:15-17`). 60 KB shipped for a string map. |
| `src/data/board/conusBorders.ts` | 27,741 | flat `[x0,y0,x1,…]` coord arrays, projection space | 102 rings / 3,418 pts. **Includes interior state borders, and AK + HI in conventional insets** (bbox x −64…957, y 14…604). Consumers: `boardPlayer.ts:18` (`drawGround`, :351-365), `TodayPage.tsx:5` (`SkeletonGround`, :146-151). |
| `src/data/atlas/stateShapesAlbers.ts` | 27,308 | same, keyed by USPS abbr | 51 states / 3,306 pts, AK + HI insets. Consumer: `AtlasPage.tsx:4` → SVG `d` strings built at module load (`AtlasPage.tsx:57-79`). |

So **`/atlas` is a second independent copy**, generated from the same GeoJSON. Its header claims ≤1.6 px agreement with `conusBorders`; my per-state bbox comparison is consistent with that. Also present, not real geometry: `EventMap.tsx:24-36` (tile grid), `InlineStateMap.tsx:6-19` (normalized fake centroids), `stateCentroids.ts` (lon/lat centroids).

**Registration defect — this is the finding of the block.** Both baked geometries were generated with `d3.geoAlbersUsa().scale(1300).translate([487.5,305])` (header, `conusBorders.ts:6-8`); the dots were baked with `projection.ts`'s different fit. They do not register. I bbox-tested all 50 live `state-temp` dots against their own state's rings: **31 of 50 dots fall outside their own state's bounding box.**

```
ME dot(800.2,165.2)  outside ME bbox[891-957, 45-150]
WA dot(192.6,124.6)  outside WA bbox[ 64-184, 14-102]
CA dot(165.3,316.7)  outside CA bbox[ 19-163,160-407]
MA dot(785.9,212.7)  outside MA bbox[871-930,155-186]
```
Systematic: East-coast dots sit ~90-110 px west of their states, West-coast ~10-30 px east. Any layer drawn from `albers_x/y` will not sit on any layer drawn from the ring files until one side is re-baked.

### C3. Key signatures

```ts
// src/lib/boardPlayer.ts
export function compileFilm(film: BoardFilm): BoardModel                          // :175
export function fitCanvas(c: HTMLCanvasElement, cssW: number,
                          proj: {width:number;height:number}): FitTransform       // :332
export function drawFrame(ctx: CanvasRenderingContext2D, model: BoardModel,
                          t: number, nowMs: number): void                         // :568
export function hitTest(model: BoardModel, projX: number, projY: number,
                        t: number): BoardHit | null                               // :609
export interface BoardFilm { story; title; subtitle; window:[string,string];
  projection:{width;height}; dots: BoardDot[]; strings: BoardString[];
  blooms: BoardBloom[]; beats: BoardBeat[] }                                      // :64-74
export interface BoardDot { id; label; sublabel?; kind; side?; alert?;
  forming?; x: number; y: number; series: Record<string, {v,pct}> }               // :26-46

// src/lib/board/frameStore.ts
export function buildDayFilm(day, resolved: ResolvedInstrument[],
   alerts?: Map<string,StateAlert>, forming?: Map<string,string[]>): BoardFilm     // :299
export function compileDayFilm(...same...)                                        // :336
```

**Neither, strictly: it is film-driven.** `BoardFilm` carries its own date axis; `/board` loads a baked JSON film, `/` synthesizes a one-day film per selected date (`TodayPage.tsx:310-337`) with `strings: []`, `blooms: []`, `beats: []` (`frameStore.ts:331-334`) — **the front-door board draws no strings at all today.** It accepts only pre-projected `x,y` in projection units; it never sees lat/lon.

### C4. Arbitrary layers?

**Hard-wired.** `drawFrame` (`:568-600`) is a fixed 4-stage pipeline: `drawGround` → strings → blooms → dots. There is no layer array, no z-order registry, no per-feature style hook. The primitive vocabulary is exactly: `fillRect`, polyline `stroke` (borders), `quadraticCurveTo` (strings), `arc` + `createRadialGradient` (dots/blooms), `setLineDash` for the forming ring, `fillText` for labels above 0.75 pct.

Nothing exists for filled fields, polygon fill, hatch, `createPattern`, `clip`, rotated glyphs, or `ctx.save/restore` (grep: zero occurrences of `save()`/`rotate()`/`createPattern` in `boardPlayer.ts`).

Quantified: drawing code is ~235 of 641 lines — `drawGround` 15 (`:351-365`), `drawString` 54 (`:367-420`), `drawDot` 89 (`:432-520`), `drawBloom` 44 (`:522-565`), `drawFrame` 33 (`:568-600`). **Blunt read: keep, don't rewrite.** The ~340 lines of compile/densify/sample machinery (`:110-280`) and `fitCanvas` are lane-agnostic and worth keeping verbatim. The five `draw*` functions become one of N layer renderers behind a new `Layer[]` contract. A front glyph (rotated triangles/half-circles along a polyline) is genuinely new — ~80-120 lines of tangent math with `save/rotate/restore`, plus per-vertex spacing. Filled fields need either a per-cell `fillRect` grid or an `ImageData` blit, neither of which exists. Realistic: ~150 lines refactored, ~400-600 lines net new, `BoardFilm` superseded by a layer union type.

### C5. Hit-testing

**Correction to Part 1:** hit-testing *does* exist — `boardPlayer.ts:609-637`, O(n) nearest-dot within 24 projection units, else nearest string midpoint within 18. Both pages wire it on `pointerup` with a 10px drag guard. What is missing is **hover** (`onPointerMove` appears on `BoardPage.tsx:444` only for the scrubber; the canvas has none) and any notion of *area* features.

**Recommend: extend the existing canvas-coordinate hit-test math. Do not add an SVG overlay, do not add an offscreen colour-key canvas.**

Why, against this renderer specifically: the CSS→projection transform is already a single linear map both call sites compute identically (`TodayPage.tsx:401-406`), so a hover handler is ~15 lines. `/atlas` already proves the polygon case in this exact coordinate space — `AtlasPage.tsx:100-114` (`hitState`) runs point-in-polygon over the same 3,306-point ring set with a `near` tolerance fallback, at interactive rates, and it is the same rings the map would draw. That code is directly liftable; there is nothing to invent.

Colour-key is wrong here because the board *breathes* (`drawDot` glow radius is a function of `nowMs`, `:449-456`), so the key canvas would need re-rendering every frame or would drift from what's on screen. SVG overlay is wrong because it means shipping the ring geometry a second time into the DOM and re-solving z-order/pointer-events; `/atlas` already found `pointerEvents="none"` + manual `hitAt` faster than letting SVG do the hit-testing (`AtlasPage.tsx:568`). The only real cost of canvas math is that polygon layers need a spatial index once feature count exceeds a few hundred — a bbox pre-filter (already computed at `AtlasPage.tsx:57-79`) covers that.

### C6. Which lanes carry plottable lat/lon

Verified against actual columns/metadata, not assumption. Note there are **no dedicated tables** for fire, AQI, quakes, tides, discharge, or drought — the exposed DCD tables are only `board_*`, `formation_watches`, and `hunt_*` (no `hunt_wildfire_*`, `hunt_air_quality`, `hunt_earthquakes`). Those lanes live in `hunt_knowledge` as `content_type` rows whose only geography is `state_abbr` + a free-form `metadata` jsonb (`hunt_knowledge` columns: `content, content_type, created_at, effective_date, embedding, id, metadata, signal_weight, species, state_abbr, tags, title`).

| lane | where | point geometry? | evidence |
|---|---|---|---|
| NOAA tide gauges | `board_instruments` `kind=tide` | **YES, 11 gauges** | `tide-8461490 lat 41.3717 lng -72.0956`; `lat`,`lng` columns exist on `board_instruments` |
| Ocean buoys | `board_instruments` `kind=buoy` | **YES, 6** | `buoy-42001 lat 25.9 lng -89.7` |
| GHCN "stations" | `board_instruments` `kind=state-temp` (50) | **NO — state centroids** | `ghcn-al lat 32.807 lng -86.791`, `source_key {"state_abbr":"AL"}`. Underlying `hunt_knowledge` rows are state aggregates: `"Daily Weather TX 2021-02-15"`, metadata `{avg_high_f, max_temp_f, station_count: 432}` — **no station id, no coords**. Part 1's "GHCN daily (station-level)" is not what is stored. |
| Climate needles (AO/NAO/PDO/ENSO/PNA) | `board_instruments` `kind=needle`, 5 | no geography by design | `lat`/`lng` null, fixed `y=28` |
| USGS river discharge | `hunt_knowledge` `river-discharge` | **YES** | metadata keys `[discharge_m3s, flood_status, forecast_day, latitude, longitude, max_m3s, mean_m3s, median_m3s, min_m3s, source]` |
| NCEI storm events | `hunt_knowledge` `storm-event` | **fields exist, sampled null** | `{"lat":null,"lng":null,"county":"HARDIN",...}` — county name is the usable geography. UNVERIFIED what fraction have non-null lat/lng; needs a bounded count over `content_type=storm-event` with `metadata->>lat is not null`, which timed out at 57014 on every unbounded probe I tried. |
| AirNow AQI | `hunt_knowledge` `air-quality` | **NO** | metadata `[avg_co, avg_no2, avg_ozone, avg_pm25, avg_so2, max_aqi, severity, source]` — state-level only, no monitor id or coords |
| Wildfire perimeters | `hunt_knowledge` `wildfire-perimeter` | **NO — not even a point** | `{"acres":113045.6,"irwin_id":"{1B0219EE-…}","incident_name":"Crosswhite","severity":"mega fire","percent_contained":0}` + `state_abbr:"OR"`. No polygon, no centroid. IRWIN id is the join key to re-fetch geometry. |
| NWS alerts | `hunt_knowledge` `nws-alert` | **NO** | metadata `[alert_id, expires, onset, severity]` + `state_abbr`. Confirms Part 1's "today they are only a ring around a dot". |
| ASOS realtime | `hunt_knowledge` `weather-realtime` | **station id only** | `"MS front-passage KGPT 2026-07-18"`, metadata `{station:"KGPT", component_events:"temp-drop+wind-shift"}`. The fetcher *has* coords and throws them away — `hunt-weather-realtime/index.ts:360-362` uses `m.lat/m.lon` only to call `latLonToState()`, then writes neither. |
| Space weather | `hunt_knowledge` `space-weather` | global, no geography | `state_abbr: null` |
| Quakes / drought / eBird | — | **UNVERIFIED** | `earthquake-event`, `earthquake-historical`, `drought-index`, `drought-weekly`, `ebird-hotspot`, `tide-gauge`, `usgs-water` returned zero rows on every date I could bound, and unbounded probes hit 57014. To verify I'd need either a bounded `effective_date` equality on a date those crons actually wrote, or a `content_type` max-date RPC. |

**Dead code found in passing:** `frameStore.ts:665-712` `drawRibbon` — a second, independent canvas drawing path (west→east heat ribbon), exported, **zero importers**.

## D. THE LANES

### D1. Every data lane

Method notes: exact counts came from `run_invariant_query` (`SELECT`-only RPC, service-role); rows marked **~** are PostgREST `count=estimated` planner numbers because the exact count exceeded the 15 s statement timeout. "Last refresh" is `max(created_at)` per `function_name` in `hunt_cron_log` (cols: `id, function_name, status, summary, error_message, duration_ms, created_at`). Cadence is from `cron.job` (61 active jobs).

**Only 5 lanes have dedicated tables.** Everything else lives in `hunt_knowledge` partitioned by `content_type` — **105 distinct content_types** (loose index-scan over `idx_hunt_knowledge_type`), 10,041,848 rows / 68 GB.

| Lane | Where | Rows | Earliest | Latest | Geo resolution | lat/lon | Cadence | Last success |
|---|---|---|---|---|---|---|---|---|
| GHCN daily | `hk` `ghcn-daily` | ~1,467,239 | 1950-01-01 | **2025-12-31** | **state aggregate** (50 rows/day, `station_count` only) | **no** | none (backfill) | dead — 0 rows in 2026 |
| Weather realtime | `hk` `weather-realtime` | ~389,357 | — | 2026-07-24 | ASOS station (`station:KSHV`) | no (station id only) | `*/15 * * * *` | 2026-07-24 23:15 |
| Weather history | `hunt_weather_history` | 51,420 | 2020-09-01 | 2026-07-23 | state | no | watchdog b1–b5 06:00–06:08 | 2026-07-24 06:08 |
| NOAA tides (daily gauge) | `hk` `tide-gauge` | 910,350 | **1899-01-01** | 2026-06-30 | **9 stations** | **yes** | none (backfill) | — |
| NOAA tides (weekly) | `hk` `noaa-tide` | ~81,775 | 2020-12-29 | 2026-03-31 | **199 stations** | **yes** | none | — |
| USGS discharge/stage | `hk` `usgs-water` | 514,710 | 2021-01-31 | 2026-03-31 | **4,206 sites, 44 states**, monthly rollup | **yes** | none | — |
| USGS historical | `hk` `usgs-water-historical` | ~916,688 | 1990-01-31 | 2020-12-31 | 3,881 sites | yes | none | — |
| River discharge (Open-Meteo GloFAS) | `hk` `river-discharge` | 168,306 | 2021-01-01 | 2026-07-24 | **49 state centroids** | yes (centroid) | `0 5 * * *` | 2026-07-24 05:00 |
| NCEI storm events | `hk` `storm-event` | 3,548,392 | 1950-01-03 | **2026-03-31** | mixed point/county | ~60% | none | — |
| Quakes | `hk` `earthquake-event` 143,547 / `-historical` 49,680 / `-v2` 13,821 | | 1900-04-30 | 2026-06-30 | point | **yes** | none | — |
| eBird migration | `hk` `migration-daily` 5,908 + `hunt_migration_history` 14,430 | | 2020-09-01 | 2026-07-24 | state (hotspot names in text) | no | batch1–5 07:00–07:20 | 2026-07-24 07:20 |
| BirdCast | `hunt_birdcast` 4,920 + `hk` `birdcast-daily` 5,280 / `birdcast-historical` 86,913 | | 2025-11-15 hist. end | 2026-06-15 | **state** | no | b1–b5 10:00–10:08 | 2026-07-24 10:08 (writes 0 off-season) |
| USDM drought | `hk` `drought-weekly` | 9,160 | 2022-12-27 | 2026-07-14 | **state % area** | no | `0 7 * * 2` ×5 | 2026-07-21 07:13 |
| Soil | `hk` `soil-conditions` | 193,560 | 2021-01-01 | 2026-07-24 | state centroid | yes | `30 5 * * *` | 2026-07-23 05:30 |
| Crop progress | `hk` `crop-progress` 17,824 / `-weekly` 9,114 / `crop-data` ~10,769 | | 2022-08-21 | 2026-07-19 | state × commodity | no | `0 14 * * 5` | 2026-03-27 (weekly writer 2026-07-24) |
| AQI | `hk` `air-quality` | 130,647 | 2022-08-04 | 2026-07-24 | **50 state centroids, Open-Meteo — not AirNow** | centroid only | `15 6 * * *` | 2026-07-24 06:15 |
| Wildfire perimeters | `hk` `wildfire-perimeter` | 30,504 | 2021-01-01 | 2026-07-24 | state + name | **no** | `30 8 * * *` | 2026-07-24 08:30 |
| Fire activity (NIFC) | `hk` `fire-activity` | 23,177 | 2019-08-21 | 2026-03-21 | county name | no | none | — |
| Space weather | `hk` `space-weather` 119 / `geomagnetic-kp` 29,947 | | 1932-01-02 | 2026-07-24 | global | n/a | `15 0,6,12,18 * * *` | 2026-07-24 18:15 |
| Wikidata / OTD | `hk` `onthisday-event` 19,665 / `wikidata-event` 244 / `nrhp-place` 243 / `historical-newspaper` 8,372 | | 0004-06-26 | 2026-06-24 | **12,296/19,665 OTD rows carry `metadata.coordinates`** | partial | none since 2026-07-05 | 2026-07-05 07:16 |
| CPC AO/NAO/PNA daily | `hk` `climate-index-daily` | 84,214 (AO 28,074) | 1950-01-01 | 2026-06-30 | hemispheric | n/a | `0 11 * * 1` | 2026-07-20 11:02 |
| NWS alerts | **`hunt_nws_alerts`** 278 live + `hk` `nws-alert` 10,303 | | 2026-03-08 | 2026-07-27 | state + UGC (+27% polygon) | see D2 | `0 * * * *` | 2026-07-24 23:00 |
| Ocean buoys | `hk` `ocean-buoy` 71,452 / `-historical` ~626,942 | | 2020-12-31 | 2026-07-24 | 19 stations | station id | `45 0,6,12,18 * * *` | 2026-07-24 18:45 |
| Power outage | `hk` `power-outage` | 27,354 | 2026-03-29 | 2026-07-24 | county | no | `0 */3 * * *` | 2026-07-24 21:03 |
| Snow / SNOTEL / ice | `hk` `snow-cover-monthly` 9,374 / `snotel-daily` 292 / `glerl-ice-cover` 8,064 | | 2008-12-09 | 2026-07-23 | state / basin | no | daily 07:00, 08:00 | 2026-07-24 08:01 |

**The headline finding: five "believed held" lanes are frozen archives, not live feeds.** GHCN daily stops 2025-12-31; storm-event, noaa-tide and usgs-water all stop **2026-03-31**; usgs-water-historical stops 2020-12-31; tide-gauge stops 2026-06-30. None has a cron. Any card that says "as of today" over those lanes is lying.

Dormant lanes that stopped 2026-03-28: `pressure-tendency`, `solar-radiation`, `cloud-visibility`, `humidity-profile`, `evapotranspiration` (261 rows each in 2026).

The board itself reads only 4 lanes: `board_instruments` (71 rows) = 50 `ghcn-daily` state temps + 5 climate needles + 6 `ocean-buoy-historical` buoys + 11 `tide-gauge` tides. No air, fire, drought, water-discharge or bird instrument exists.

### D2. NWS alerts — polygon geometry

Table `hunt_nws_alerts` (920 kB, 278 live rows). Columns: `id uuid, alert_id text, event_type text, severity text, headline text, description text, states text[], areas text, onset timestamptz, expires timestamptz, geometry jsonb, raw_ugc text[], created_at timestamptz`.

**We already store the polygon.** `supabase/functions/hunt-nws-monitor/index.ts:157` writes `geometry: f.geometry` straight from the GeoJSON feature, and `:158` writes `raw_ugc: ugcCodes`. Nothing is discarded at fetch time.

But the coverage is partial, and the split is by event family:

| | rows | geometry |
|---|---|---|
| Polygon | 75 | Flash Flood Warning 40/40, Severe Thunderstorm Warning 19/19, Flood Warning 14/14, Tornado Warning 2/2 |
| NULL | 203 | Heat Advisory 0/89, Red Flag Warning 0/35, Extreme Heat Watch 0/26, Extreme Heat Warning 0/22, Flood Watch 0/20, Fire Weather Watch 0/6, Severe T-storm Watch 0/2, Wind Advisory 0/2, Tornado Watch 0/1 |

That is NWS behaviour, not a bug: storm-based **warnings** carry a polygon, zone-based **watches/advisories** carry only UGC zone codes. Every row has UGC — 278/278 populated, avg 7.2 zones/alert, 1,458 distinct UGC codes in the current 278.

**Two more constraints.** (a) The monitor **deletes expired rows** (`:112`, `:185`), so this is a trigger source with no history — the historical lane is `hunt_knowledge.nws-alert`, whose metadata keys are only `{alert_id, expires, onset, severity}`: **no geometry in the archive at all**. (b) Only 13 distinct `event_type` values are ingested (the three `EVENT_BATCHES` at `:20-26`) — no winter, marine or dense-fog family.

**Cost to draw all of them:** the polygon third is free today — one policy, `roles={public}`, `cmd=ALL`, `USING(true)` on `hunt_nws_alerts`, so anon can already `select geometry` (the client deliberately doesn't: `src/lib/board/frameStore.ts:159-162` selects only `states,event_type,severity`). The zone two-thirds needs a UGC→polygon dictionary; there is **no UGC/zone resolution code anywhere in the repo** (only `extractStates`, which slices the first two chars). Honest scope: one-time ingest of the ~3,600 NWS public forecast zones + ~3,200 counties from `api.weather.gov/zones` GeoJSON into a static table keyed by UGC, then a join. That's a new table and a new one-shot script — no per-alert fetch cost afterward, since zone boundaries change a few times a year.

### D3. Wildfire perimeters

**Points? No — neither.** No geometry and no coordinates at all. `supabase/functions/hunt-wildfire-perimeters/index.ts:55` sets `returnGeometry: "false"`, and `scripts/backfill-wildfire-perimeters.ts:145` does the same for the historical lane. Source is WFIGS Interagency Perimeters **Current** (ArcGIS, `:16`), wildfires only (`attr_IncidentTypeCategory = 'WF'`), top 100 by acres.

Stored metadata: `{acres, percent_contained, irwin_id, incident_name, fire_cause, discovery_date, containment_date, snapshot_date, severity}` plus `state_abbr`. One snapshot row per fire per day. Currency is good — 104 distinct fires across 16 states on 2026-07-23/24, cron `30 8 * * *`, last success 2026-07-24 08:30. Span 2021-01-01 → 2026-07-24, 30,504 rows.

The only way to place a fire on a map today is by state. Re-adding `returnGeometry: true` (or at least the centroid) is a one-line change in the fetch — but it is a **write** and out of scope for this pass.

### D4. USDM drought

**State-level area percentages. Not county, not grid, not polygon — not drawable as a shaded region.** `supabase/functions/hunt-drought-monitor/index.ts:102` calls `usdmdataservices.unl.edu/api/StateStatistics/GetDroughtSeverityStatisticsByAreaPercent?aoi={stateFIPS}`. Each row is one state-week: `{d0_pct, d1_pct, d2_pct, d3_pct, d4_pct, none_pct, week_change:{...}, classification, source:'usdm'}`. 100 rows/week = 50 states × 2 weeks. Span 2022-12-27 → 2026-07-14. Cron `0 7 * * 2` in five batches.

To hatch drought as a region you would need the USDM shapefile/WMS product, which is a different endpoint from the one wired in. Nothing in the repo touches it.

### D5. NCEI storm events

3,548,392 rows, 1950-01-03 → 2026-03-31. Event types (2019 sample, 50 distinct): Thunderstorm Wind 19,373, Hail 9,346, Flood 5,218, Flash Flood 4,258, Winter Storm 3,909, Winter Weather 3,808, High Wind 3,787, Heavy Snow 3,177, Marine T-storm Wind 2,502, Tornado 1,788, Strong Wind 1,590, Heavy Rain 1,441, Heat 1,408, Extreme Cold/Wind Chill 1,294, Excessive Heat 1,120, Drought 1,090, Blizzard 879, Frost/Freeze 654, Dense Fog 652 … down to Sleet 1. Full NCEI vocabulary is present.

**Location is mixed.** Over 2015–2020 (359,751 rows):

| granularity | lat/lon | rows |
|---|---|---|
| `point` | yes | 194,740 (54%) |
| `county` | no | 106,776 (30%) |
| absent (v1 rows) | yes | 42,289 |
| absent (v1 rows) | no | 15,946 |

So ~66% of rows plot as a point; the remainder carry `{county, cz_fips, cz_type}` and `state_name` only, and would need a FIPS→county-polygon dictionary — which, as in D2, does not exist in this repo. Every v2 row also carries `provenance_url`, `source_event_id`, `episode_id`, `deaths/injuries/damage_*`, and `event_time_utc`/`end_time_utc`.

### D6. AirNow AQI

**Neither AirNow nor monitor-level.** It is Open-Meteo's air-quality API sampled at **one state centroid per state** — `supabase/functions/hunt-air-quality/index.ts:4` imports `STATE_CENTROIDS`, `:99-100` builds the URL from `lat/lng`. Rows are one per state per day: `{max_aqi, avg_pm25, avg_ozone, avg_no2, avg_so2, avg_co, severity, source:'open-meteo-air-quality'}`. 50 distinct states in July 2026, 130,647 rows, 2022-08-04 → 2026-07-24, cron `15 6 * * *`, last success 2026-07-24 06:15.

There are no monitor coordinates and no sub-state variation, so a smoke plume can only ever be drawn as a whole-state fill. The registered B1 AQI-ramp lead is computed on exactly this state-centroid series.

### D7. USGS discharge + NOAA tides

**Site counts and coordinates**

| | sites | coords | note |
|---|---|---|---|
| `usgs-water` | **4,206** across 44 states (2026 Q1) | `metadata.lat/lng` per site | monthly rollup rows: `gauge_avg_ft/max/min`, `trend`, `site_no`, `site_name` |
| `usgs-water-historical` | 3,881 (2020 sample) | yes | 1990-01-31 → 2020-12-31 |
| `noaa-tide` | **199 named stations** | yes | weekly: `avg_tidal_range_ft`, `best_morning_low_time` |
| `tide-gauge` | **9 stations** (Annapolis, Baltimore, Bay Waveland, Dauphin Island, Grand Isle, Kings Point, New London, Sandy Hook, The Battery) | yes | daily since 1899, with `residual_mean/max/min_ft` = observed − predicted, `provenance_url`, `hours_reporting` |
| `river-discharge` | 49 state centroids | yes | daily, live |

**What "running low" means — three different things, and only one of them is a percentile of record.**

1. **The board's tide instruments — a real day-of-year percentile.** `scripts/board/tailDepth.ts` is the machinery: `doyOffset()` (`:24-36`, with Dec/Jan wrap) builds a same-day-of-year ±N pool across all recorded years; `lowRank`/`highRank` (`:41-55`) return one-sided rank; `FULL_SWELL_MIN_YEARS = 10` (`:22`) with a `LOW_CONFIDENCE_CAP = 0.6` clamp for pools of 1–9 years and `pct: null` for 0. This is the pre-baked pool in `board_pool_luts` (62,489 rows / 171 MB, columns `instrument_id, metric, doy, layout_version, n, vals, years, below`). **It runs on the 11 tide gauges only — never on the 4,206 USGS sites.**
2. **`usgs-water.trend`** — `scripts/backfill-usgs-water.ts:186-197`: split the month's readings in half, compare means, ±5% of the month's own average → `rising`/`falling`/`stable`. Purely within-month. No baseline, no record.
3. **`river-discharge.flood_status`** — `supabase/functions/hunt-river-discharge/index.ts:29-36`: `ratio = current / median` → `>2` flood, `>1.5` elevated, `<0.7` low flow, `<0.5` drought. The `median` is `river_discharge_median` fetched in the **same** Open-Meteo call as `river_discharge` (`:86`, `forecast_days=1`). **INFERRED —** on Open-Meteo's flood API those fields are ensemble statistics of the same forecast run, which would make this a spread check rather than a climatological baseline. I could not verify that from the repo; verifying needs the Open-Meteo flood-API field documentation.

### D8. Birds

**Resolution:** state, everywhere. BirdCast is scraped per state from `dashboard.birdcast.org/region/US-{abbr}` (`supabase/functions/hunt-birdcast/index.ts:266`) — `cumulative_birds`, `peak_num_aloft`, `avg_direction`, `avg_speed`, `mean_height`. eBird `migration-daily` is a state row with `sightings/waterbird/songbird/…` counts and named hotspots in the text, no coordinates. The only bird lane with coordinates is `ebird-hotspot` (10,000 rows, `metadata.lat/lng`, ranked hotspots) — but it was written once, 2026-03-15 → 2026-03-22, and never again.

**Cadence:** `hunt-birdcast-b1..b5` at 10:00–10:08 daily, `hunt-migration-batch1..5` at 07:00–07:20 daily. Both green (2026-07-24). But BirdCast's upstream **only runs Mar 1–Jun 15 and Aug 1–Nov 15** (`hunt-birdcast/index.ts:227`) — `birdcast-daily` has zero rows after 2026-06-15 and the cron logs success while writing nothing. `hunt_birdcast` spans 2026-03-08 → 2026-06-15 only; the deep history is `birdcast-historical` (86,913 rows, ends 2025-11-15).

**Rendered anywhere today: barely, and never on a map.** Grepping `src/` for `birdcast|migration-daily|murmuration|ebird` returns exactly two files: `src/hooks/useDayArchive.ts:70`, which lists `['migration-spike-extreme','migration-spike-significant','migration-daily','birdweather-acoustic','inaturalist-daily','bio-absence-signal','bio-environmental-correlation']` under a "Life" probe group, and `src/lib/humanize.ts:151`, which turns a `migration-daily` row into `"1,002 bird sightings — 12% above baseline"`. That hook is consumed only by `src/pages/DatePage.tsx:103`. So birds appear as **plain text rows on `/date/:date`** and nowhere else — not on the board, not on the atlas, not on `/`. `birdcast-daily` itself is not in the probe list, so BirdCast is not surfaced at all.

## E. THE FREQUENCY DICTIONARY

### E1. Where the day-of-year pool percentile code lives

Three copies of one algorithm, all byte-identical by design:

| Role | File | Signature |
|---|---|---|
| Canonical kernel | `scripts/board/tailDepth.ts:71` | `tailDepth(value: number, pool: number[], direction: "low"\|"high"\|"two-sided", years: number): TailResult` |
| Pool slicer | `scripts/board/tailDepth.ts:108` | `poolForDay(series: Map<string,number>, day: string, nDays: number): { pool: number[]; years: number }` |
| doy distance | `scripts/board/tailDepth.ts:25` | `doyOffset(aIso: string, bIso: string): number` (Dec/Jan wrap-aware) |
| Bake-time LUT builder | `scripts/frames/bake-luts.ts:96` | `buildLut(series: Map<string,number>, nDays: number, mmdd: string): { vals; below; n; years }` |
| Live lookup | `supabase/functions/hunt-frame-daily/index.ts:45,52` | `belowOf(lut, v)` / `byteFromLut(lut, v, side)` |

The pool is materialized in `board_pool_luts` (migration `supabase/migrations/20260711090000_board_pool_luts.sql:36`), PK `(layout_version, instrument_id, metric, doy)`. **Measured: 64,455 rows** (two layout versions × 89 (instrument,metric) jobs × 366 doy = 32,574 each). Sample: `ghcn-ia / avg_high_f / doy 201 → n=1512, years=72`.

### E2. Can it generalize to feature_type × geography × doy-window → {count, years[], last_occurrence}

**Partly — the kernel generalizes; the output shape does not, and the "feature_type" axis is thinner than the pivot assumes.**

Evidence for generalization: `tailDepth()` and `poolForDay()` are pure and instrument-agnostic — they take a `Map<iso, number>` and an integer window. Nothing in `tailDepth.ts` references an instrument. Instrument coupling lives one level up, in `scripts/frames/registry.ts:14-29` (`MetricDef`) and `bake-luts.ts:126-130` (`fieldJobs()`), which is a loop you can re-point.

Evidence against, and it is the decisive code — `bake-luts.ts:98-103`:

```ts
for (const [d, v] of series) if (doyOffset(d, target) <= nDays && Number.isFinite(v)) { pool.push(v); yrs.add(d.slice(0, 4)); }
```

The **dates are thrown away**. The LUT keeps `n` (pool size) and `years` (a count, not a list). `count`, `years[]`, and `last_occurrence` are all recoverable only by re-slicing the series. That is an additive ~40-line sibling of `buildLut`, not a rewrite.

Two harder limits:
1. **Geography axis is state-centroid or point only.** `registry.ts:73-92` builds exactly 50 `ghcn-XX` state instruments + 11 tide + 6 buoy + 5 needle = 72 (`board_instruments` count = 72, verified). Nothing sub-state exists in this machinery.
2. **The brief's own worked example is not a feature_type that exists.** `STATE_METRICS` (`registry.ts:16-18`) is one field: `avg_high_f`, two-sided, `n_days: 10`. There is **no 24-hour-delta / "fall" metric anywhere in the registry**, so "a July fall this size across Iowa" cannot be counted today without adding a derived series. UNVERIFIED whether a delta series can be computed from cache alone — I did not test it, but the cache holds contiguous dailies so it is arithmetic, not ingest.

### E3. Bake cost

Real cardinalities measured, not estimated:

- Warm offline cache exists: `scripts/frames/.frame-cache`, **35 MB, 73 files**, mtime 2026-07-16. `series-ghcn-ia.json` → `avg_high_f`, **27,759 dailies, 1950-01-01 → 2025-12-31, 76 distinct years**.
- ±7-day doy window around Jul 19 in that series: **1,140 observations across 76 years**. (±10, the current board window: 1,596.)
- `board_frames`: **27,953 rows, 1950-01-01 → 2026-07-24**, `dots` = hex bytea, 288 hex chars = 144 bytes/day.

Arithmetic for a state-level, ±7 bake keyed `(feature_type, state, doy)`:

```
50 states × 2 sides × 366 doy                    =  36,600 rows / feature_type
× 3 threshold tiers (e.g. p95 / p98 / p99)       = 109,800 rows
scan work: 50 series × 27,759 days × 15 buckets  =  20.8M in-memory increments
```

Occurrences per key at p≥0.95: ~1,140 × 0.05 ≈ **57**; at p≥0.99 ≈ 11. Both comfortably above and below the card's illustrative 34.

Wall clock: the scan is pure JS over a 35 MB warm cache — seconds. Cost is dominated by upsert, and `bake-luts.ts:38` already batches 400/request; 36,600 rows = 92 requests. The precedent bake (`board_pool_luts`, 32,574 rows/version) is the same order. **Estimate: a single-digit-minutes full backfill, zero DB reads**, because the cache makes it offline. Measured DB read path if you skip the cache: `board_frames` pages at 4,000 rows / ~1.0 s / 325 KB gzip → full store in ~7 s.

Caveat: the shipped LUT for `ghcn-ia` reports `years=72`, but the cache holds 76. The baked LUT is stale relative to the cache; a dictionary bake should re-derive, not trust `board_pool_luts.years`.

### E4. "What followed, in those N" — is the Court reusable?

**The Court is the wrong machine. The Mine is the right one, and it already exists.**

Court code: `supabase/functions/hunt-claim-court/index.ts` (578 lines), tables `hunt_claims` / `hunt_claim_fires` (`supabase/migrations/20260702090000_claim_court.sql`). Verified live: **9 claims, 74 fires, exactly 43 graded** (`evaluated=eq.true`, count=exact). The lift math, `index.ts:378-383`:

```ts
function computeLift(hit: boolean, controlHits: number, controlN: number): number | null {
  if (controlN === 0) return hit ? null : 0;
  const controlRate = controlHits / controlN;
  if (!hit) return 0;
  return Math.round((1 / Math.max(controlRate, 1 / (2 * controlN))) * 100) / 100;
}
```

and the control sampler, `index.ts:359-376`, whose era bound is `index.ts:74`: `const LIVE_ERA_START = '2026-03-15';`

Four disqualifying facts, all from that code:

1. **Controls come from ~4.5 months of live data only** (`LIVE_ERA_START = 2026-03-15`). The card promises a 1950-2026 denominator. The Court literally cannot see the archive.
2. **`CONTROL_N = 10`** (`index.ts:73`) — baseline rate is quantized to 0.1, and a zero-control run floors at `1/(2·10) = 0.05`. "An ordinary late-July baseline of 8%" is not expressible.
3. **Controls are season-blind.** `pickControlStarts` draws uniformly across the whole era; there is no doy matching. The card's whole claim is *late-July* baseline.
4. **`lift` is per-fire, not aggregate.** Live rows confirm the shape: `{"state_abbr":"TN","hit":true,"control_hits":4,"control_n":10,"lift":2.5}`. The card needs `19/34` and a pooled baseline; the Court stores 43 independent booleans.

What *does* produce card copy is `scripts/mine/mine.ts`, which is the same forward-window join done over the 1950+ frame store:

- `mine.ts:86-87` — `const FOLLOW_LO = 2; const FOLLOW_HI = 30;`
- `mine.ts:697-706` — builds a `followed: Uint8Array` over all 27,953 days by filling `[i-FOLLOW_HI, i-FOLLOW_LO]` behind every anchor.
- `mine.ts:710-731` — `baseRateDay = followedDays / scanDays`, where `scanDays` counts **only doy-matched days** (`SEASON_HALF = 15`, `mine.ts:90`). That is exactly the card's "ordinary late-July baseline".
- `mine.ts:842-847` `bandStats()` → `{ fires, followed }`; `mine.ts:890` wraps it in `wilsonInterval(fire.followed, fire.fires)`.
- `scripts/mine/stats.ts:90,132,208` — `fisherExactOneSided`, `wilsonInterval`, `lift`, all pure, no network.
- `scripts/mine/frames.ts:231` `invertPct(instId, metric, doy, pct, side)` turns a percentile back into raw units — written explicitly because "a percentile is not a product sentence"; `mine.ts:930-949` `buildSentence()` is already a copy generator.

**Verdict: reusable, with one hard honesty constraint on the numerator.** The outcome lane is `content_type=stitched-event`: measured **4,233 rows, 1990-01-16 → 2026-03-31** (also stale by ~4 months). `anchors.ts:53` sets `MIN_ANCHOR_DATE = "1990-01-01"` with an in-code explanation that pre-1990 anchors sit over sparse lanes. Raw `storm-event` does reach 1950, but non-stationarily — measured counts: 1950s **11,191** (1,119/yr), 1960s **25,045**, 1980s **75,167** (7,517/yr), 2015-19 **359,751** (71,950/yr) — a **~64× rise in reporting density**. So a card may honestly say "34 times since 1950" (occurrence counting from a physical series is stationary) but **must not** say "of those 34, 19 were followed by severe wind" using a 1950-anchored numerator. Split the eras or restrict "what followed" to 1990+.

A third, lighter implementation exists: `supabase/functions/hunt-days-like-today/index.ts:237-253` does a live btree-bounded `effective_date > date && <= date+7` forward join against `AFTERMATH_TYPES` (`:47-51`). Good pattern for the per-tick "open this date" drill-down; useless for aggregates.

### E5. New table + daily function, or does something half-do it?

Nothing does it. Exposed DCD tables (from the OpenAPI `definitions`): `board_frames, board_instruments, board_layout, board_pool_luts, board_rhymes, board_strings, formation_watches, morning_lines, planting_climatology, hunt_*`. No occurrence/frequency table.

Closest half-builds, in descending order:

1. **`board_pool_luts`** — already `(instrument, metric, doy) → distribution`. It is the dictionary minus `count / years[] / last_occurrence` (dropped at `bake-luts.ts:98-103`). The right move is a sibling table on the same key, baked by the same script pattern.
2. **`planting_climatology`** (`supabase/migrations/20260717120000_planting_climatology.sql`) — the exact product precedent: per-state, `n_years int NOT NULL`, jsonb distributions, `source text`, `computed_at`, RLS `Public read` + `GRANT SELECT ON ... TO anon` (`:37-40`), written once by an offline script, read directly by `/plant`. Copy this table's shape and its grant block verbatim.
3. `morning_lines` — the other anon-readable baked-sentence table.

Recommendation: **new baked table, offline script bake, no new daily edge function initially.** The dictionary over 1950-2025 is immutable; only the current year needs appending, which `hunt-frame-daily` (11:45 UTC) could extend in a few lines since it already loads the layout and the day's readings.

### E6. Minimum n, and every existing floor

Every n-floor I found:

| Floor | Value | Location | Behavior below floor |
|---|---|---|---|
| `FULL_SWELL_MIN_YEARS` | 10 yrs | `scripts/board/tailDepth.ts:21` | renders, clamps pct to `LOW_CONFIDENCE_CAP = 0.6` (`:22, :91-92`) |
| LUT honesty clamp | 10 yrs | `scripts/frames/bake-luts.ts:119`; `hunt-frame-daily/index.ts:56`; migration `...board_pool_luts.sql:17` | same clamp, byte-exact |
| `MIN_HEADLINE_YEARS` | 10 yrs | `hunt-morning-line/index.ts:46,152` | state not picked for the headline; refusal string at `:160` |
| `MIN_YEARS` (atlas anomaly) | 5 yrs | `hunt-atlas-anomaly/index.ts:31,135,152` | **z stays null** |
| `MIN_YEARS` (atlas spot) | 5 yrs | `hunt-atlas-spot/index.ts:43,907,1005` | z withheld; explicit copy at `:1016` — *"below the 5-year floor, so z is withheld rather than faked"* |
| `FLOOR_N_EFF` / `FLOOR_YEARS` | 20 events / 10 yrs | `scripts/mine/anchors.ts:45-46`; `scripts/mine/mine.ts:82-83` | cell is not minable, flagged "untested" in the payload |
| `NULL_GUARD_MIN_READABLE` | 20 of 31 days | `mine.ts:83` | window discarded |
| `TREND_MIN_DAYS_PER_YEAR` | 30 days | `mine.ts:269` | year-mean not used for trend |
| `MIN_YEARS` / `S1_MIN_YEARS` / `LINEUP_MIN_TIDE_DAYS` | 5 / 10 / 60 | `scripts/mine/lineup-engine.ts:41,50,40` | baseline NaN; state skipped |
| `MIN_OVERLAP` | 80 shared slots | `scripts/frames/rhyme.ts:66`; `hunt-board-rhyme/index.ts:51` | returns `null` — no rhyme |
| `MIN_BASELINE_DAYS` / `CONTROL_N` | 8 days / 10 | `hunt-claim-court/index.ts:73,75` | condition returns false |
| `min_years` (declared) | 10 | `registry.ts:17,21,25,28` | declarative; enforced via the tailDepth clamp |

**Honest minimum for the card, grounded in these precedents, not invented:**

- **State a frequency at all: n ≥ 10 distinct years.** Three independent subsystems already converge on 10 (`tailDepth.ts:21` says so explicitly: "matches morning-line n_years≥10"). Below 10 the house rule is *clamp or withhold, never fake* — the card should print the raw tick strip and the count without the "about once every N years" rate, because a rate from <10 years is an extrapolation.
- **State "what followed, in those N": n ≥ 20 occurrences.** That is `FLOOR_N_EFF = 20` from the Mine — the only floor in the codebase set specifically for a *forward-window outcome rate*, and it was set after the sweep proved smaller cells are noise.
- **Always print the Wilson interval, not just the fraction.** `stats.ts:132 wilsonInterval` exists and `mine.ts:890` already applies it to exactly this quantity. At 19/34 the 95% Wilson band is roughly ±16 points — a card that says "56%" without that band is overclaiming, and the machinery to avoid it is already written and unit-tested (`scripts/mine/stats.test.ts`).
- **Refuse below 5 outright.** Both atlas functions already do this and say why in user-facing prose (`hunt-atlas-spot/index.ts:1016`), which is the tone to reuse.

---

> ### ⚖︎ ADVERSARIAL VERIFY — E4 · can the Court’s grading machinery produce card copy
> *An independent agent instructed to refute the finding above, re-deriving it from the files and queries itself.*

> VERDICT: CONFIRMED (block E's E4 is right, and understated)
> 
> **Independently reproduced.** Read `supabase/functions/hunt-claim-court/index.ts` end to end and re-ran every count.
> 
> - `LIVE_ERA_START = '2026-03-15'` (:74), `CONTROL_N = 10` (:73), `MIN_BASELINE_DAYS = 8` (:75), `ROW_FETCH_LIMIT = 200` (:76) — all as reported.
> - `pickControlStarts` (:359-376) draws uniform random starts across the live era with **no doy matching** — confirmed by reading, not inference.
> - `computeLift` (:378-383) is per-fire; live rows confirm the shape.
> - DB: 9 claims, 74 fires, **43 graded** (`evaluated=eq.true`, count=exact). Hits 13/43. `fired_at` spans 2026-07-05 → 2026-07-23 only.
> - Mine side reproduced: `FOLLOW_LO=2/FOLLOW_HI=30` (mine.ts:86-87), `SEASON_HALF=15` (:90), `LABELED_START="1990-01-01"` (:91), doy-matched `baseRateDay = followedDays/scanDays` (:710-731), `bandStats` → `wilsonInterval` (:842-847, :890). `MIN_ANCHOR_DATE` is anchors.ts:**52**, not :53.
> - stitched-event: 4,233 rows, 1990-01-16 → 2026-03-31. storm-event 1950s 11,191 / 1980s 75,167 / 2015-19 359,751 — the ~64× non-stationarity is real.
> 
> **Corrections / what block E missed.**
> 
> 1. **The decisive blocker isn't listed.** The occurrence set is *not an input*. FIRE hard-codes `yesterday` (:398, `evalTrigger(..., yesterday)` :429); GRADE reads only `hunt_claim_fires` rows FK'd to a registered `hunt_claims` row (:461-467). There is **no entry point** for an arbitrary historical date list. That alone refutes reuse before any statistics argument.
> 2. **Archive-blindness is worse than "controls only."** `weather_z` reads `hunt_weather_history`, measured range **2020-09-01 → 2026-07-23**. The *outcome* side also cannot see pre-2020, not just controls.
> 3. **Geography:** every evaluator hard-binds `.eq('state_abbr', stateAbbr)` (:178, :225, :265). Arbitrary geography = rewriting all three condition kinds.
> 4. **Budget:** `TIME_BUDGET_MS = 120_000` with one network round-trip per condition per window; 34 occurrences × 11 windows blows it.
> 5. `control_n` is not uniformly 10 — one graded row is `control_n=75`, `grade_version` null (legacy grader). 42/43 at 10.
> 
> **On the fix:** the Mine is the right machine but not a full answer — `region` is also only `"US" | state` (anchors.ts:136), so sub-state is unsolved there too, and `followed` is built from `cd.scopedAnchors` (stitched-event families), so "what followed" isn't arbitrary outcomes. `bandStats(daysList: number[])` does accept an arbitrary date set — that half holds.

---

## F. DERIVED FRONTS

### F1. The Uri-bake code and the propagating 24-hour-fall signal

**Correction to the brief, on evidence.** The propagating signal described (ND/WA/MN deep Dec 21 → KY/OH/TN at 1.000 Dec 24) is **not from the Uri bake and is not a 24-hour fall**. Its origin is `docs/THE-WEEK.md:208`, the 2026-07-17 "four blank years are lit" entry, which reads: *"Elliott 2022-12-21..24 back at 134/142 with the cold wave visibly propagating west→east across the board (ND/WA/MN deep Dec 21 → KY/OH/TN at 1.000 Dec 24)."* That is **Winter Storm Elliott, Dec 2022**, observed in the re-baked `board_frames` store — not Uri (Feb 2021), and not a delta metric.

What actually produced it:

| Layer | File | What it computes |
|---|---|---|
| Metric | `scripts/board/tailDepth.ts:71-94` | `tailDepth(value, pool, direction, years)` — one-sided rank of today's value inside a same-day-of-year ±N pool. Not a delta. |
| Pool slice | `scripts/board/tailDepth.ts:108-122` | `poolForDay(series, day, nDays)` |
| Instrument def | `scripts/frames/registry.ts:16-18` | state temp = `avg_high_f`, `two-sided`, `n_days: 10`, `min_years: 10` |
| Backfill | `scripts/frames/backfill-frames.ts:143` (`loadSeries`), `:281`, `:380` | writes historical frames |
| Daily | `supabase/functions/hunt-frame-daily/index.ts:134-144` | day-0 bake |

**Is it reusable machinery? Yes — fully.** The registry/tailDepth/LUT/frame-byte stack is generic, direction-aware, and shared by seed + backfill + the daily cron (`scripts/frames/registry.ts:1-9` says so explicitly). `scripts/board/bake-uri.ts` is the **one-off ancestor** — a 610-line standalone script with hardcoded 16 state centroids (`bake-uri.ts:234-251`), inline `coldPct`/`highPct` (`:125-137`), and its own Albers (`:143-181`); `tailDepth.ts:5-7` states it exists to generalize exactly those functions. bake-uri is superseded, not the source of the Elliott signal.

**The signal is real but is a percentile field, not a front.** Each state gets one number at its centroid — 49–50 points nationally. "Propagation" is what a human eye reads across four daily frames. Nothing in the codebase computes a temperature *change*, a gradient, or a line.

### F2. Could a daily "leading edge of a 24h temperature fall" be baked from GHCN today?

**Not at any spatial resolution worth drawing a front on — the station data is aggregated away at ingest.**

Verified DB facts:
- `hunt_knowledge` `content_type=ghcn-daily` is **state-level daily**: 49–50 rows/day. `2025-07-01` → 49 rows; `2024-07-01` → 49; `2021-02-15` → 50.
- Sample metadata (`AL 2025-07-01`): `{avg_high_f: 88.3, avg_low_f: 71.1, max_temp_f: 94, min_temp_f: 66, avg_precip_in, station_count: 116}`. **No lat, no lon, no station id.**
- Station counts summed across states: **7,771 stations (2025-07-01), 6,121 (1975-07-01)** — the stations exist upstream and their readings are averaged into one number per state.
- The archive is **stale**: ghcn-daily returns rows for `2025-12-01` and `2025-10-01`, and **zero rows** for `2026-01-15`, `2026-03-01`, `2026-04-01`, `2026-06-15`, `2026-07-15`, `2026-07-22`, `2026-07-23`. `hunt-frame-daily/index.ts:135-138` documents this: *"ghcn-daily's backfill edge ends ~2025-12 (no current-year rows), so day-0 comes from `hunt_weather_history`."*
- `hunt_weather_history` is current (latest row `2026-07-23`) but is also **state-level** — `{state_abbr, date, temp_high_f, temp_low_f, pressure_avg_msl, wind_direction_dominant}`, no coordinates.

**The lat/lon is fetched and thrown away.** `scripts/backfill-ghcn-daily.ts:127-132` posts to ACIS MultiStnData with `meta: "name,state,ll"` — lat/lon is requested. `:363` keeps only `{name, readings}`; `ll` is discarded, then `aggregateStations()` (`:328`) collapses everything to state means.

**Concrete cost to make it possible.** Re-run the same ACIS call (one POST per state-year, no API key) but retain `meta.ll` and per-station daily maxt/mint, writing a new station-level table. Shape: 50 states × 76 years = 3,800 POSTs; ~7,000 stations × 365 days × 76 years ≈ **190M station-days** — an order of magnitude larger than all of `hunt_knowledge` (~9.9M rows). A CONUS-only, 1990+, TMAX-only subset is the realistic ask. **UNVERIFIED —** I did not time an ACIS call or measure a payload; to cost it honestly, run one `state=IA, sdate/edate=2022-12-15..12-31` POST and measure bytes and seconds.

**Also missing:** every existing lane is a *daily* value. A "24-hour fall" from daily TMAX is really TMAX(d) − TMAX(d−1), which lags and smears actual frontal timing by up to a day. The only sub-daily temperature lane in the repo is METAR: `hunt-weather-realtime/index.ts:253-278` already computes a 1–6 hour temp drop (`major-temp-drop` >12°F, `temp-drop` >5°F) over ~200 hardcoded ASOS stations (`:108`) — but it reads `m.lat`/`m.lon` only to snap the station to a state (`latLonToState`, `:80-98`) and then **stores `station` + `state_abbr` only** (`:262-263`, and writes go to `hunt_knowledge` at `:497`/`:527`). Coordinates discarded again. Restoring them is a small edit, and the ICAO roster's coords are public — this is the cheapest path to ~200 real points with sub-daily deltas.

**Honest failure mode.** With 49 state centroids ~500 km apart, a "front" is an interpolation artifact essentially always — any synoptic-scale cooling, any airmass modification, any single hot state cooling off draws a line. Even at 200 METAR stations you would draw fronts on sea breezes, thunderstorm outflow boundaries, diurnal terrain effects, and lake breezes. There is **no honest way to distinguish a synoptic front from an outflow boundary without a pressure/wind-shift/dewpoint-drop co-requirement** — and the pressure and wind-shift detectors already exist in the same function (`:295-325`), so a 3-of-3 gate is available.

**Ground truth: none held, and this is the hard stop.** We have no WPC surface analysis, no radar, no gridded reanalysis (Part 1 §3 already concedes this). Two partial proxies: (a) NCEI storm-events carry real coordinates — `metadata` keys confirmed to include `lat`, `lng`, `event_type`, `cz_fips`, `event_time_utc` — so a derived front could be scored against subsequent High Wind / Cold-Wind-Chill / severe events; (b) NWS alert onset times. Both measure *consequences*, not the front's position, so they can falsify a front that produced nothing but cannot confirm a front's geometry. **UNVERIFIED —** counts by storm-event type; my `metadata->>event_type=eq.…` count queries timed out at 120s (that JSONB path is unindexed). To verify, count via an indexed column or a bounded per-year scan.

### F3. The NWS alert fetch — what geometry we already hold

**Location:** `supabase/functions/hunt-nws-monitor/index.ts`. Fetches `https://api.weather.gov/alerts/active?status=actual&message_type=alert&event=…` in 7 event batches (`:12-26`, `:87-102`), hourly.

**Alive and healthy** — `hunt_cron_log` last four runs: `2026-07-24T23:00:20Z success {new_alerts:10, total_active:278}`, `22:01:16Z {11, 275}`, `21:00:20Z {12, 269}`, `20:00:14Z {20, 263}`.

**What is kept** (insert rows, `:144-159`): `alert_id`, `event_type`, `severity`, `headline`, `description` (truncated to 2000 chars, `:152`), `states` (derived from UGC prefixes, `:45-52`), `areas` (`areaDesc`), `onset`, `expires`, **`geometry: f.geometry`** (`:156`), **`raw_ugc`** (`:157`).

**So yes — geometry IS already stored, but only for a minority of alerts.** Measured on the live table:

| Metric | Count |
|---|---|
| `hunt_nws_alerts` rows (active only) | **278** |
| rows with `geometry IS NOT NULL` | **75 (27%)** |
| rows with `raw_ugc IS NOT NULL` | **278 (100%)** |
| geometry types present | 100% `Polygon` |

Breakdown of the 75 polygon-bearing rows: Flash Flood Warning 40, Severe Thunderstorm Warning 19, Flood Warning 14, Tornado Warning 2. **Every polygon is a *Warning*.** Watches, advisories, Red Flag, heat, winter, and freeze products are UGC-zone-based and arrive with `geometry: null` — confirmed on a live row: a CA Heat Advisory with 28 UGC zones and `"geometry": null`.

**What is thrown away:** `properties.instruction`, `sent`/`effective`/`ends`, `senderName` (issuing office), `certainty`, `urgency`, `messageType`, `geocode.SAME` (county FIPS), `parameters`, `references`, `affectedZones` (the zone API URLs), and `description` beyond 2000 chars. The embedding path (`:243`, `:258-273`) discards geometry entirely — the `hunt_knowledge` `nws-alert` row keeps only `{alert_id, severity, onset, expires}` in metadata (2,755 such rows for 2026-07 alone).

**The frontend throws away even more.** `src/lib/board/frameStore.ts:159-163` selects exactly `states, event_type, severity`, filtered to `severity in (Severe, Extreme)` and unexpired — which is why an alert today is only a ring around a state dot.

**Two hard limits before this becomes a polygon layer:**
1. **No history.** `:182-185` deletes rows 24h past expiry every run. Oldest `onset` in the table is `2026-07-23T00:08Z`. There is no archive of past alert polygons to draw a card's tick strip from — only what is active now.
2. **73% of alerts need zone shapefiles.** To draw the other 203 you must join `raw_ugc` (e.g. `CAZ038`) against NWS public forecast-zone geometry — a free, static, one-time download (~tens of MB), not a new ingest cadence. `raw_ugc` is already stored on every row, so nothing needs re-fetching.

**Bottom line for the pivot:** NWS gives us drawable, honest, no-derivation geometry for the sharp convective/flood warnings today, and for everything else after one static shapefile import. Derived fronts are the strictly harder, less honest path — and cannot be built from the archive as it stands, because GHCN's station coordinates were discarded at ingest.

## G. THE APP

### G1. Route table

All routes are declared in `src/App.tsx:42-74`. "Linked" = a `<Link>`/`<Navigate>` reachable in-app.

| Path | Component | File | Linked from |
|---|---|---|---|
| `/` | `TodayPage` (eager) | `src/pages/TodayPage.tsx` | `InnerHeader` home link on every page (`InnerNav.tsx:104`) |
| `/plant` | `PlantPage` (lazy) | `src/pages/PlantPage.tsx` | footer group "The Almanac" (`InnerNav.tsx:61`) |
| `/date/:dateStr` | `DatePage` | `src/pages/DatePage.tsx` | footer "Any date" (`InnerNav.tsx:66`, today's ISO) |
| `/court` | `CourtPage` | `src/pages/CourtPage.tsx` | footer + `MorningPage.tsx:360`, `CascadePage.tsx:108`, `CascadeSept2020Page.tsx:204` |
| `/ask` | `AskPage` | `src/pages/AskPage.tsx` | footer (`InnerNav.tsx:78`) |
| `/atlas` | `AtlasPage` | `src/pages/AtlasPage.tsx` | footer; `TodayPage.tsx:557` (`?date=`); `MorningPage.tsx:419,439` (`?state=`) |
| `/morning`, `/morning/:date` | `MorningPage` | `src/pages/MorningPage.tsx` | footer; `TodayPage.tsx:504` (FORMING chips) |
| `/born` | `BornPage` | `src/pages/BornPage.tsx` | footer; `TodayPage.tsx:674` |
| `/board/:story` | `BoardPage` | `src/pages/BoardPage.tsx` | footer (`/board/uri`); `TodayPage.tsx:639,644` film cards (uri, sandy). Only two stories registered (`BoardPage.tsx:40-42`); both JSONs exist in `public/board/`. |
| `/cascade` | `CascadeIndexPage` | `src/pages/CascadeIndexPage.tsx` | footer "Strangest days" |
| `/cascade/july-2026-heat` | `CascadePage` | — | `CascadeIndexPage.tsx:14` |
| `/cascade/sept-2020-whiplash` | `CascadeSept2020Page` | — | `CascadeIndexPage.tsx:20` |
| `/ops` | `OpsPage` | `src/pages/OpsPage.tsx` | **not linked anywhere** — URL-only (grep for `/ops` returns only `App.tsx:63`) |
| `/auth` | `Auth` | `src/pages/Auth.tsx` | **not linked** — only reached as Google OAuth `redirectTo` (`useAuth.tsx:79`, `Auth.tsx:20`) |
| `/welcome`, `/explore`, `/state/:s`, `/concepts*` | redirects | `App.tsx:68-72` + `middleware.ts:177-196` | legacy only |
| `*` | `NotFound` | `src/pages/NotFound.tsx` | fallback |

No dead routes. Dead *components*: `EventMap.tsx` default export is never rendered — only its `TILE_GRID`/`CELL`/`PITCH`/`VIEW_W`/`VIEW_H` constants are imported (`BornPage.tsx:3`, `CascadeSept2020Page.tsx:6`). `useTodayEventMap.ts` is referenced only for its types by the dead `EventMap.tsx:3` — the hook is fully dead.

### G2. `/` component tree and what breaks

Tree (`TodayPage.tsx:424-693`): `<header>` identity (static) → `<section ref=heroRef>` porch { date line 441-454 · status 456-468 · `porch.lead` h2 472 · ACTIVE/FORMING strip 477-512 · coda 514 · **`<TodayFitted>`** 531-539 (YOUR GROUND) · THE RHYME 542-563 · **`<div ref=stageRef>` board stage 567-612** { `model ? <canvas> : <SkeletonGround/>` · tap card 582-611 } · legend 613-629 } → THE FILMS 633-649 (`FilmCard`×2) → THE LEDGER 652-669 (`LedgerRow`×29) → invitation 672-680 → lore + `<InnerFooter current="today">` 684-691.

What a replacement map must satisfy, in place:
1. **`model: BoardModel`** — built at `TodayPage.tsx:323-334` by `compileDayFilm(day, resolved, alerts?, forming?)` (`frameStore.ts:336`). Downstream code touches `model.film.projection` only.
2. **`fitCanvas(canvas, cssW, proj)`** (`boardPlayer.ts:332`) — plus the stage `<div>` hardcodes `aspectRatio: "975 / 610"` (`TodayPage.tsx:570`) and `SkeletonGround` independently imports `BOARD_PROJECTION` + `CONUS_BORDERS` (`TodayPage.tsx:5,134,146`). Three places assume 975×610 Albers.
3. **`drawFrame(ctx, model, 0, now)`** in a ~30fps rAF loop (`TodayPage.tsx:359-379`).
4. **`hitTest(model, projX, projY, 0)`** (`boardPlayer.ts:609`) → `resolvedById` keyed on `inst.id` (`TodayPage.tsx:338-342, 407-421`). This is the only tap path; it is dot-only (`hit.type !== "dot"` dismisses).
5. Legend copy at `613-629` is keyed to `alertsApply`/`formingApply`.

**What does NOT break:** the porch sentence, `TodayFitted`, the rhyme, the ledger, films and footer all read `selected.resolved` / `selected.porch` from `resolveDay(frame, instruments)` (`frameStore.ts:268`) — never from the renderer. Swapping the canvas is genuinely contained.

**What breaks hardest:** the ledger. `selectDay` (`TodayPage.tsx:385-389`) re-renders the *hero board* for any of the last 30 days (`DAYS_BACK = 30`, line 49). A live weather map has no 30-day back-catalogue; either the replacement also renders historical days from `board_frames`, or the ledger's 29 rows become decoration. Second: the tap→card popover must be re-authored against a new hit model. `boardPlayer.ts` cannot be deleted regardless — `/board/:story` owns it (`BoardPage.tsx:4-15`).

### G3. File-by-file

- **`EventMap.tsx`** (165 lines) — **dead as a component.** Tile-grid SVG US map with hit targets and per-state event counts; nothing renders it. Only its `TILE_GRID` constant survives via two importers. Its SVG-tile hit-testing is the one working *interactive* map idiom in the repo and is free to salvage.
- **`InlineStateMap.tsx`** (83) — alive but marginal. 50 hardcoded normalized dot positions (`:7-18`), rendered only by `BrainResponseCard.tsx:115` when a chat answer mentions ≥2 states. `extractStates()` regex-matches bare 2-letter tokens — will false-positive on "IN", "OR", "OK", "ME", "HI". **Third, cruder copy of US geometry.**
- **`AtlasPage.tsx`** (685) — the most capable map surface and *not* canvas: pure SVG polygons from `STATE_SHAPES` with `pointInState` even-odd hit-testing (`:82-113`), rAF viewBox camera tween (`:322-350`). Half-broken: the dossier gate is `selected && loading` (`:658`) and `loading` clears in a `finally` (`:404-406`). I measured the three fetches live — `hunt-atlas-spot?state=TX` 200 in **10.35 s** (anon key) / 25.8 s (service role), `hunt-atlas-storms` 8.8 s, `hunt-atlas-anomaly` 26.3 s. **UNVERIFIED** whether the browser hang is that latency read as a hang or a genuinely non-settling promise; to settle it I'd need the Network panel on a live `/atlas?state=TX` load. Block A owns the fix. Also note `getJson` (`:40-43`) never checks `res.ok`.
- **`BoardPage.tsx`** (516) — healthy, self-contained film player. Fetches `/board/{uri-2021,sandy-2012}.json` (both present in `public/board/`), falls back to `makeUriFixture()` in dev only (`:143`). Canvas + scrubber + tap card. Not in the country-map path.
- **`SpotDossier.tsx`** (1,325) — the largest component in the repo, and **pure presentation**: renders entirely from a `SpotData` prop, no fetching (header comment `:15-18`). Every field nullable, degrades and labels its own granularity (`SpotResolution = nation|state|county|station|spot`). Not the hang. This is the closest thing in the codebase to the "card is the product" surface described in Part 1.
- **`stateChoropleth.ts`** (305) — **half-dead.** `AtlasPage.tsx:5` imports only `fetchStateAnomalyResponse`. The other 8 exports (`colorForZ`, `buildFillPaint`, `buildFillOpacity`, `buildChoroplethPaid`, `Z_CLAMP`, `QUIET_COLOR`, `PaintOptions`, `fetchStateAnomaly`) build **MapLibre paint expressions** for a map that no longer exists — `maplibre-gl@^5.24.0` is still in `package.json` but has **zero imports in `src/`** (only a comment at `stateChoropleth.ts:60`).
- **`frameStore.ts`** (712) — the healthiest module here. Reader for the packed frame store: `fetchInstruments/fetchFrames/fetchRhymes/fetchActiveAlerts/fetchFormingWatches`, `decodeDots`, `resolveDay`, `buildDayFilm`/`compileDayFilm`, plus the whole porch-sentence generator (`porchLine`, `:524`). No duplication — it deliberately synthesizes a one-day `BoardFilm` so there is one renderer.
- **`boardPlayer.ts`** (641) — hand-rolled Canvas2D, no deps. Contract is dots + strings + blooms + beats (`:22-95`). **Correction to Part 1:** hit-testing *does* exist (`hitTest`, `:609`) and `/` wires it on `pointerup` (`TodayPage.tsx:394-422`) — what's missing is *hover*, and it's nearest-neighbour distance math (24 units for dots, 18 for string midpoints), not geometry-aware.
- **`useTodayEventMap.ts`** (107) — **dead** (see G1). Its three bounded `hunt_knowledge` reads (`content_type` + `effective_date=eq.today` + `limit`) are the proven safe query idiom and worth keeping as a reference.
- **`CascadeRibbon.tsx`** (265) — alive, used by both cascade pages. Pure inline SVG lead-lag ribbon with a `mini` variant, `ResizeObserver`-measured width, renders any `RibbonDataset`. Data is **static and committed** (`src/data/cascade.ts`, `cascade_sept2020.ts`) — not archive-driven.

**Geometry duplication (four copies):** `conusBorders.ts` (27.7 KB, board borders) → `stateShapesAlbers.ts` (27.3 KB, generated from `usStates.geojson.ts`, registers within 1.6 px, includes AK/HI insets) → `usStates.geojson.ts` (60.9 KB source) → plus `stateCentroids.ts`, `EventMap`'s `TILE_GRID`, and `InlineStateMap`'s `STATE_COORDS`. No county geometry is committed (`src/data/atlas/README.md`: "Next asset: counties GeoJSON").

### G4. Pattern page — **confirm `PlantPage.tsx`**

507 lines, single purpose, no edge-function dependency. It is the cleanest instance of the current doctrine: `InnerHeader`/`InnerFooter` chrome (`:6`), the shared ground picker via `useYourGround(params.get("state"))` (`:107`) so `?state=XX` deep-links and persists, and **three independent bounded reads each with its own `cancelled` flag and an explicit honest-absence branch** — `planting_climatology` → `rowMissing` (`:130-145`), `hunt_weather_history` → `thisYear` (`:156-180`), `hunt_knowledge` filtered on `content_type + state_abbr + effective_date` → `crops = []` (`:192-215`). It renders distributions with named receipt years and prints its own granularity caveat. Copy this.

Runners-up and why not: `MorningPage.tsx` (548) is the better model if the new page is **edge-function-backed** (`fetch` with `apikey` headers, `:158`) and it owns the only date-permalink pattern (`/morning/:date`) — take that from it. `DatePage.tsx` (500) is heavier, streams AI, and pulls five hooks. `AtlasPage.tsx` is the SVG-map pattern but is currently the broken one.

### G5. `hunt_seasons`

Schema (PostgREST OpenAPI): `id uuid PK · species_id text FK→hunt_species.id · state_abbr text FK→hunt_states.abbreviation · state_name text · season_type text · zone text · zone_slug text · dates jsonb · bag_limit int · flyway text · weapon text · notes text · verified bool · source_url text · season_year text`. `dates` is an array of `{open, close}` ISO pairs.

**482 rows, all `season_year = "2025-2026"`, all 50 states.** Species: deer 144 · duck 104 · goose 87 · turkey 93 · dove 54. `season_type`: regular 223 · spring 56 · rifle 50 · archery 49 · muzzleloader 45 · fall 37 · light-goose-conservation 12 · early-teal 9 · special-white-wing 1. 59 distinct `zone` values. Ducks: 104 rows, 50 states, **25 states carry >1 duck zone** (CA 5, CO 4, CT 2, …); the rest are `Statewide`.

**Zones map to neither counties nor FIPS.** `zone` is free text and `zone_slug` a slug — no geometry, no county list. The companion table `hunt_zones` (`id, species_id, state_abbr, zone_slug, zone_name, county_fips text[]`) is the intended join and is **empty: 0 rows** (Content-Range `*/0`).

Missing before it can be surfaced: (1) `hunt_zones` populated — 59 zone→county-FIPS arrays, hand-transcribed from state regs; (2) 2026-2027 dates — the whole table is last season and will be wrong by September; (3) 13 duck rows have `verified != true` and 2 have `bag_limit = 0` (e.g. AL statewide regular, which is not zero); (4) **zero frontend references** — `grep -rn hunt_seasons src/` returns nothing.

### G6. zip → county → duck zone

**Nothing resolves any leg of it.** No zip table exists in the 258 exposed tables (grep for `zip|county|counties|fips` returns only `hunt_zones` and `hunt_user_locations`). `hunt_user_locations` (`id, user_id, name, lat, lng, state_abbr`) is **0 rows** and has no county column. `hunt_states` (51 rows) carries state `fips` + centroid only. No county geometry is committed in `src/data/`.

Cheapest honest path, in order: (a) ship the Census Gazetteer ZCTA file as a static asset — ~33.8 K rows of `zip → lat/lng` — but note the Gazetteer ZCTA file gives no county; the free `zip → county-FIPS` crosswalk is HUD's USPS ZIP-COUNTY file (quarterly, ~46 K rows, one zip can span several counties, weighted by address ratio). Ship the max-ratio row per zip → a flat `Record<zip, {fips, lat, lng}>` ~1 MB raw, well under 300 KB gzipped, and static like `src/data/atlas/*` already is. (b) Populate `hunt_zones.county_fips` by hand from the 59 zone descriptions — some are already county lists in `notes`, most are not; this is the labor. (c) Then `zip → fips → hunt_zones (county_fips @> [fips]) → hunt_seasons (state_abbr, zone_slug)`. Step (b) is the whole cost; step (a) is an afternoon. **UNVERIFIED:** exact current row counts / licensing of the HUD file — I did not fetch it. Alaska is the known trap (boroughs, and its duck row covers "Units 5-7 9 10 14-16", not counties).

### G7. Auth

**Auth gates nothing.** `AuthProvider` wraps the whole router (`App.tsx:40`), but the only consumers are `UserMenu.tsx:13` and `useChat.ts:36`. There are no route guards, no `if (!user)` blocks in any page, and no auth-conditional data fetch. `UserMenu` renders in exactly two headers — `CourtPage.tsx:263` and `AskPage.tsx:112` — and signed-out it renders a "Sign In" button (`UserMenu.tsx:25-34`). `useChat` attaches `Authorization: Bearer session.access_token` **only if a session exists** (`useChat.ts:97-99`); the chat works anonymously. Sign-in is Google OAuth only (`useAuth.tsx:76-81`), redirecting to `/auth`, which immediately bounces signed-in users to `/` (`Auth.tsx:10-12`).

`hunt_profiles` is **0 rows** (Content-Range `*/0`) — there are no accounts. Correction to Part 1: it isn't queried on every load; `fetchProfile` runs only after `supabase.auth.getUser()` returns a user (`useAuth.tsx:41-45`). Location state is not in the DB either — `useYourGround` is the shared ground picker and `hunt_user_locations` is empty.

**The country map does not need to care.** Everything it would read is anon-key PostgREST or anon-key edge functions today. The only thing auth could buy is persisting "my ground / my zone" server-side instead of in `useYourGround`'s local storage, and that is a later decision, not a dependency.

## H. LIMITS AND RISK

### H1. Plan, connection limits, statement timeout, DB size

| Fact | Value | Evidence |
|---|---|---|
| Project | `rvhyotvklfowklzjahdd`, name **"jac-agent-os"**, org `csdeyptpmxhmgmajjbok` ("jayhillendalepress@gmail.com's Org") | `npx supabase projects list --output json` |
| Postgres | 17.6.1.063, GA channel, region `us-west-2`, status `ACTIVE_HEALTHY` | same |
| Statement timeout (REST path) | **30s** — `ALTER ROLE authenticator SET statement_timeout = '30s'` | `supabase/migrations/20260322_fix_rpc_performance.sql:14` |
| Per-RPC overrides | `SET LOCAL statement_timeout = '30s'` inside vector RPCs | `20260347_fix_ivfflat_probes_v3_rpc.sql:34`, `20260411_update_probes.sql:34`, `20260414100004_fix_date_filter_rpc.sql:40` |
| PostgREST row cap | `max_rows = 1000` | `supabase/config.toml:18` (local config; prod cap matches the known 1000-row behaviour) |
| Plan tier / compute size / connection limit / pooler mode | **UNVERIFIED** — the CLI returns no plan or compute field and there is no REST surface for it. Settles with one read of Dashboard → Settings → Compute & Disk (plan, instance size, `max_connections`) and Settings → Database → Connection pooling. |
| Disk | **UNVERIFIED live.** Repo state log records "disk stays 121GB, autoscaled" and a pending Large→Small compute downgrade, dated 2026-07-05 — `docs/THE-WEEK.md:126`. |

Known consumers of the ceiling: the IVFFlat index alone is **30 GB** (`rpc/ivfflat_rebuild_status` → `{"index_size":"30 GB","reloptions":["lists=2645"],"index_exists":true}`). Storm partial index 18 MB; tide indexes 17 MB + 27 MB (`rpc/storm_partial_index_status`, `rpc/tide_indexes_status`). `hunt_knowledge` dead tuples 15,925 / live 149,765 with `last_vacuum: null, last_autovacuum: null` (`rpc/vacuum_hunt_knowledge_status`) — those live/dead numbers are stale planner stats against a 10M-row table, i.e. **ANALYZE has not run recently**, which matters for any new query plan the map depends on.

### H2. Largest tables and their indexes

Estimated counts via `Prefer: count=estimated` (Content-Range), service role:

| Table | Rows | Indexes the map would use | Source |
|---|---|---|---|
| `hunt_knowledge` | **10,095,678** | `(effective_date)` btree, `(state_abbr)`, `(content_type)`, `(content_type,state_abbr)`, gin `(tags)`, gin `(metadata)`, `(species)`, BRIN `(created_at)`, IVFFlat vector | `20260317_hunt_knowledge_v2.sql:9-12`, `20260309_hunt_monitoring_tables.sql:108-113`, `20260355_optimize_ops_dashboard_rpcs.sql:11`, `20260711030000_rebuild_ivfflat_for_10m.sql:42` |
| `hunt_cron_log` | 98,651 | none found in migrations | — |
| `board_pool_luts` | 64,455 | `(layout_version, doy)` | `20260711090000_board_pool_luts.sql:49` |
| `hunt_weather_history` | 54,698 | `(state_abbr, date)` | `20260308000012_hunt_historical_data.sql:35` |
| `board_frames` | **27,953** | `(layout_version)` only — **no index on `day`** beyond whatever the PK is | `20260711050000_board_frame_store.sql:75` |
| `hunt_weather_events` | 9,051 | `(state_abbr, event_date)` | `20260309_hunt_monitoring_tables.sql:30` |
| `hunt_seasons` | 482 | `(species_id)`, `(state_abbr)`, `(species_id,state_abbr)` | `20260306120000_hunt_bootstrap.sql:136-138` |
| `hunt_nws_alerts` | 278 | gin `(states)`, `(expires)` | `20260309_hunt_monitoring_tables.sql:48-49` |
| `board_rhymes` | 220 | none found | — |
| `formation_watches` | 90 | `(status)` partial | `20260717030000_formation_watches.sql:35` |
| `hunt_claim_fires` / `hunt_claims` | 74 / 9 | none found | — |
| `board_instruments` / `board_layout` / `board_strings` | 72 / 2 / **0** | `(lane) WHERE active`, `(slot_offset) WHERE active` | `20260711050000_board_frame_store.sql:46-47` |

These are migration-file definitions, not `pg_indexes` output — I cannot read `pg_indexes` over REST. **UNVERIFIED** whether every one actually exists on the live DB (several IVFFlat migrations conditionally drop/recreate each other); one `select * from pg_indexes where tablename like 'board%'` in the SQL editor settles it.

`board_strings` is **empty (0 rows)** — the string layer the brief proposes removing is already carrying nothing.

### H3. Anon-key exposure — there are real leaks

I swept all 82 non-`ct_` tables in the exposed schema with the legacy anon JWT (`role: anon`) and spot-checked `ct_*`. The publishable key `sb_publishable_9AvNwncjMaI2zi5OD0_Uug_iNk-UfQc` behaves identically. JAC's core is safe — `ct_trades` (16 rows), `ct_config` (260), `ct_flags` (15,302), `profiles` (1), `entries` (503), `agent_tasks` (433), `jac_reflections` (293), `brain_insights` (7), `ct_specialist_memory` (3), `user_settings`, `subscriptions` all return `[]` to anon while service role sees the rows — RLS is doing its job.

Three findings, worst first:

1. **`lupa_designs` leaks in full to anon.** 49 rows, `rls_enabled: true` but a permissive public SELECT policy must exist (no policy for it appears in `supabase/migrations/` at all — it was created outside this repo). `curl` with the anon key returns full design records including `created_at` and payload. This is Lupa's data readable by anyone holding the public key that ships in duckcountdown.com's bundle.
2. **RLS is OFF on five board tables** — `rpc/list_tables_rls_status` returns `rls_enabled: false` for `board_frames`, `board_instruments`, `board_layout`, `board_pool_luts`, `board_strings`. Only `board_rhymes` and `formation_watches` have RLS + an explicit public-read policy (`20260712232251_board_rhymes.sql:35-36`, `20260717030000_formation_watches.sql:41-44`). Reads being open is intended. **Writes may also be open**: `OPTIONS /rest/v1/board_frames` with the anon key returns `allow: GET, HEAD, POST, OPTIONS`. With RLS disabled, an INSERT grant to `anon` means anyone can write rows into the frame store the landing page renders. I did **not** attempt a write (read-only rule), so this is one step short of proven — settle it with `SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name LIKE 'board%' AND grantee IN ('anon','authenticated')` in the SQL editor. If `INSERT` is listed, that is a live defacement vector on the front door and the fix is one `REVOKE INSERT, UPDATE, DELETE ... FROM anon` plus RLS-on-with-read-policy, matching what `board_rhymes` already does.
3. **The whole archive is publicly scrapeable.** `hunt_knowledge` (10.1M rows) is readable by anon, as are `hunt_weather_history`, `hunt_weather_events`, `hunt_nws_alerts`, `hunt_seasons`, `hunt_states`, `hunt_claims`, `hunt_claim_fires`, `board_pool_luts`, `morning_lines`, `planting_climatology`, and ~20 more `hunt_*` tables. Paginated at 1000 rows/request, but nothing rate-limits it. Not a bug if intentional — but the "frequency dictionary" table this pivot bakes would inherit the same posture, and it *is* the product.

User tables are correctly closed: `hunt_user_locations`, `hunt_user_settings`, `hunt_user_alerts`, `hunt_profiles`, `hunt_conversations`, `hunt_feedback` all return `[]` (note `hunt_profiles`, `hunt_zones`, `hunt_user_locations`, `lupa_conversations`, `board_strings` are genuinely 0-row, so their emptiness proves nothing about their RLS).

### H4. Vercel build, env, bundle

`vercel.json` is one rewrite: `{"source": "/((?!assets|api/).*)", "destination": "/index.html"}` — SPA fallback that excludes `/assets` and `/api`. Plus `middleware.ts` (210 lines, `@vercel/edge`) doing 301 canonicalisation and static meta shims for unfurl bots (`middleware.ts:1-31`), and `api/og.ts` (`@vercel/og`).

Only two env vars are read by the client: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (`src/lib/supabase.ts:3-4`, `src/lib/almanac.ts:18-19`). `.env.local` also holds `VITE_MAPBOX_TOKEN`, `VITE_EBIRD_API_KEY`, `VITE_OWM_API_KEY`, `VOYAGE_API_KEY`, `EBIRD_API_KEY`, `SUPABASE_DB_PASSWORD` — **none of the first three are referenced anywhere in `src/` or `api/`**, so they are dead locals. The actual Vercel project env list is **UNVERIFIED** (would need `vercel env ls` or the dashboard).

`npm run build` succeeds, **exit 0, 2.51s, 2526 modules**, `dist/` = 1.3 MB total:

| Chunk | raw | gzip |
|---|---|---|
| `recharts` | 381.64 kB | 112.00 kB |
| `index` | 289.94 kB | 86.40 kB |
| `react-vendor` | 163.22 kB | 53.21 kB |
| `AtlasPage` | 61.55 kB | 22.48 kB |
| `stateBBoxes` | 58.61 kB | 16.11 kB |
| `index.css` | 40.03 kB | 8.36 kB |

Only warning: `Browserslist: caniuse-lite is 13 months old`. No chunk-size warnings, no TS errors. `maplibre-gl@5.24.0` is still a **dependency in `package.json` but imported nowhere in `src/`** (the only hit is a comment at `src/lib/atlas/stateChoropleth.ts:60`) — it is tree-shaken out of the bundle but bloats `node_modules` and install time; safe to drop.

What breaks with a canvas-heavy landing page: nothing structural — `TodayPage.tsx`, `BoardPage.tsx`, `src/lib/boardPlayer.ts`, `src/lib/board/frameStore.ts` already call `getContext('2d')`, so canvas is on the critical path today. Two real risks: (a) the landing chunk is `index-*.js` at 290 kB and a bigger renderer + geometry lands there unless code-split — `stateBBoxes` (58.6 kB) is already split, geometry should follow; (b) `api/og.ts` and the `middleware.ts` unfurl shims serve static HTML to crawlers, so a canvas-only front door renders as nothing to bots unless the shim copy is updated alongside.

### H5. Test coverage

Effectively **zero, and worse than zero — the suite is orphaned**. `npm test` → `vitest run` → **"No test files found, exiting with code 1"**. `vitest.config.ts:9` sets `include: ["src/**/*.{test,spec}.{ts,tsx}"]` and there are no test files in `src/` at all. Line 8 also sets `setupFiles: ["./src/test/setup.ts"]` — **that file does not exist** (`ls src/test` → No such file or directory), so the suite would fail to boot even if a test appeared.

The 1,370 lines of real tests that do exist are outside the include glob: `scripts/mine/lineup-engine.test.ts` (577), `scripts/mine/fusion-formation.test.ts` (566), `scripts/mine/stats.test.ts` (227). These are the gate-1/gate-2 fixtures the state log credits with 110/110 + 42/42 green — they are being run some other way, not by `npm test`. No frontend, hook, renderer, or edge-function test exists anywhere.

### H6. Git

Tree is **clean except one untracked directory**: `git status -s` → `?? scratch-almanac/` — 11 MB, containing `ofa-1950.pdf` (an Old Farmer's Almanac scan, research input for the positioning work). Not in `.gitignore` (`grep -n scratch .gitignore` → no match). No stashes (`git stash list` empty). On `main`.

Last 20 commits are coherent and finished — the newest is `a2a091f State log: rhyme gap closed, escalation clocks at 2 of 3`, preceded by publish-guard, watchman-retry, and QA-wrapper fixes. Nothing reads as half-landed in the tree. The one open thread is documentary, not code: `d65c74a State log: frame-daily missed 11:45, repaired by hand, watching tomorrow` — the 07-18 miss the brief already names, with no follow-up commit resolving it.


## I. THE READ

*Written by the main session after reading all eight blocks, all three verifier verdicts, and a separate inventory of dormant hunting machinery. Everything above is evidence; this is judgment, and it is mine, not an agent's.*

### I1. The riskiest assumption, and the cheapest thing that kills it

**Part 1 assumes the archive has enough spatial resolution to be a map. It does not.**

The pivot's base layer is described as objects a hunter reads without a legend — cold fronts, precipitation shading, fire polygons, smoke plumes, drought hatch, warning polygons, river gauges. Of those seven, exactly one is drawable from what we hold: NWS warning polygons, and only the 27% of alerts that are storm-based warnings (D2, F3). Everything else collapses to a state fill:

- GHCN is **not** station-level. It is 50 rows a day of state means, and the ingest script requests `meta: "name,state,ll"` and then throws the coordinates away (F2, `backfill-ghcn-daily.ts:127-132`, `:363`).
- AQI is not AirNow and not monitor-level — it is Open-Meteo sampled at one centroid per state (D6). A smoke plume can only be drawn as a whole-state fill.
- Wildfire perimeters are fetched with `returnGeometry: "false"` (D3). We have acres and a name, not a shape — not even a point.
- Drought is a state area-percentage table, not a polygon product (D4).
- The lanes that *do* carry real coordinates — 9 tide gauges, 19 buoys, 4,206 USGS sites, 66% of storm events — are frozen archives. `usgs-water`, `noaa-tide`, and `storm-event` all stop **2026-03-31**; GHCN stops **2025-12-31** (D1). None has a cron.

So the memory half of "a weather map with a memory" is real and deep. The **weather map** half is fifty dots and a handful of flood-warning polygons. That is the assumption everything else rests on, and it is the one Part 1 never tests.

**Cheapest experiment: don't build anything — render one honest frame.** Take today's live data at its true resolution and draw it once: the ~40 flash-flood and severe-thunderstorm polygons we actually store, drought as a state fill, AQI as a state fill, fires as labeled state dots, the 9 tide gauges as points. One static image, an afternoon's work, no renderer changes, no ingest. Then look at it and answer one question: *does that read as a weather map, or as a choropleth with three polygons on it?* If it's the second, the base-layer plan needs re-scoping before a single line of layer-engine code gets written. This is worth doing before anything in block C is touched, because the renderer rewrite (~400-600 net-new lines by C4's estimate) is scoped to draw layers the data can't currently fill.

### I2. What is harder than we think

**The two shipped geometries do not register with each other.** This is the finding I'd have least expected and it's the one with the longest blast radius. `conusBorders.ts` was baked with `d3.geoAlbersUsa().scale(1300).translate([487.5,305])`; the dots in `board_instruments.albers_x/y` were baked with `scripts/board/projection.ts`'s own CONUS fit. **31 of 50 state dots fall outside their own state's bounding box** — Maine's dot is 90px west of Maine (C2). Nobody caught it because a glowing dot roughly near a border reads fine at low zoom. Any layer you add from `albers_x/y` will sit wrong against any layer drawn from the ring files until one side is re-baked, and re-baking the dots means re-deriving `board_instruments` for all 27,964 frames' worth of coordinate assumptions. Fix this first or every subsequent layer inherits it.

**"What followed" cannot be honest over the same span as "how often."** Storm-event reporting density rises **~64×** from the 1950s to 2015-19 — 1,119 events/year to 71,950 (E4, verified independently). Counting occurrences from a physical temperature series is stationary and safe: *"34 times since 1950"* is true. Counting **outcomes** over that same window is not, because the denominator of what got *recorded* exploded. The card as written in Part 1 puts both sentences in the same box. The Mine already knows this — `anchors.ts` sets `MIN_ANCHOR_DATE = "1990-01-01"` with the reasoning in a comment. This is the same failure mode that killed gates 1 and 2 wearing different clothes, and it will find us again if the card's two halves aren't era-split explicitly on screen.

**The hunter's last leg is manual labor, not engineering.** `hunt_seasons` has 482 real rows, all 50 states, 59 named duck/deer/goose/turkey/dove zones. `hunt_zones` — the table that maps a zone to `county_fips[]` — has **zero rows** (G5). Country → state → **zone** → ground stops dead at the state line, and closing it means hand-transcribing 59 zone definitions out of state regulation PDFs. Alaska doesn't even use counties. No amount of parallel agents makes that faster; it's an evening with the regs open. Also: every row reads `season_year 2025-2026` and will be wrong by September.

**Five "believed held" lanes are frozen.** Not degraded — stopped, with no cron behind them. Anything the new front door says "today" about over GHCN, storm events, USGS, or tides is a lie by construction. Restoring those pipes is on the critical path for a live product and isn't in anyone's estimate yet.

### I3. What is already built that we've forgotten

**The Mine is the frequency card's engine, and it's already written and tested.** Block E's verdict — that the Court is the wrong machine — held up under an adversarial pass that came back *"CONFIRMED, and understated."* But the right machine exists: `scripts/mine/` does the doy-matched forward-window join over the 1950+ frame store, computes base rates against season-matched controls, wraps them in Wilson intervals, and `frames.ts:231 invertPct()` converts a percentile back into raw units — written explicitly because *"a percentile is not a product sentence."* `mine.ts:930-949 buildSentence()` is already a copy generator. It has 1,370 lines of passing unit tests. The card's math is done; what's missing is a table and a surface.

**`SpotDossier.tsx` already is "the card is the product."** 1,325 lines, pure presentation, no fetching, every field nullable, and it labels its own granularity through a `nation | state | county | station | spot` ladder. Part 1 describes this component without knowing it exists.

**`board_pool_luts` is the frequency dictionary minus three fields.** 64,455 rows already keyed `(instrument, metric, doy) → distribution`. `bake-luts.ts:98-103` throws away the dates while building the pool — keeping them is a ~40-line sibling of an existing script, and the 35 MB warm `.frame-cache` means the whole bake runs offline in single-digit minutes with zero DB reads (E3).

**`planting_climatology` is the table shape, grants and all.** Baked offline, `n_years NOT NULL`, public-read policy plus `GRANT SELECT TO anon`, read directly by `/plant`. Copy it verbatim (E5).

**`AtlasPage`'s `hitState` already solves polygon hit-testing** in the exact coordinate space the map would use — point-in-polygon over 3,306 points at interactive rates (C5). Nothing to invent.

And from the hunting inventory, three things nothing surfaces: **52,284 Ducks Unlimited field reports, every one geocoded**, seven seasons deep, with activity level, flyway, wind, temp and hunter votes — cron switched off eight days ago for being an "ops tile." **`hunt_weather_events`** — 9,051 rows of `pressure_drop`, `cold_front`, `high_wind`, `first_freeze` per state per date, **forward-dated** (it's carrying tomorrow's front right now), on no page. And **`hunt-atlas-solunar`**, which computes shooting light and major/minor windows for any lat/lng and is already mounted.

### I4. Four shippable stages

1. **The card, on what's already true.** The frequency card over the one lane that is complete, stationary, and 76 years deep — state temperature, doy-windowed. Ships into `SpotDossier` and `/date/:date`, where the card surface already exists. On screen: a denominator sentence, a 1950→2026 tick strip of openable dates, and a Wilson-banded "what followed" explicitly restricted to 1990+. **No map work at all.**
2. **Register the map.** Re-bake one geometry so dots and borders agree, add hover to the hit-test that already exists, then put the NWS warning polygons we already store on the board over drought and AQI state fills — with the bake-freshness stamp in the header. On screen: the first honest weather layer, and a map whose parts line up.
3. **Your ground.** Zip → county → zone → this season's dates, shooting light, solunar, and the cold-front/pressure-drop events already computed for tomorrow. On screen: the hunter's own page. Gated on populating `hunt_zones` by hand.
4. **The neighbors.** The 52,284 DU field reports as pins on your zone, seven seasons deep, each pin opening the frequency card for that water. On screen: what other hunters saw here, and how often that's happened.

Stage 1 is honest and shippable without touching the renderer. Stage 2 doesn't depend on stage 1. That ordering is deliberate — it front-loads the parts that can't fail.

### I5. What you didn't ask that you should have

**What does the machine cost to keep running, and what can be turned off?** The recon asked whether the machine runs; it never asked what the machine costs. Sixty registered crons, and four are silently broken in ways nobody has noticed: `hunt-birdweather-daily` has logged `partial` 21 times with its last true success on **2026-07-03**, `hunt-crop-progress-weekly` has **zero successes ever recorded** in a 30-day window, `hunt-phenology-weekly` has been dark since **2026-03-20**. A solo dev re-fronting a product inherits all sixty. The question worth asking alongside "what do we build" is "which lanes does the new product actually need," and then turning the rest off without guilt.

**The anon key that ships in duckcountdown.com's bundle leaks another project's data.** I added this check because the client talks to PostgREST directly and nobody had verified what that exposes. `lupa_designs` — 49 rows — returns in full to the anon key (H3). That is Lupa's data readable by anyone who views source on Duck Countdown. Separately, RLS is **off** on five `board_*` tables and `OPTIONS /rest/v1/board_frames` returns `POST` in its allow header; I did not attempt a write, so it's one step short of proven, but if `anon` holds INSERT that is a live defacement vector on the front door. Both are decisions for now, not later, and both are one statement each to fix.

**Does anything still grade itself?** The self-grading loop was always the thing that made this more than a search engine. A frequency instrument makes no prediction, so it can never be wrong — which is safe, and also means nothing keeps it honest. The Court is currently grading a thesis that's being retired. Decide whether it re-points at frequency claims, becomes a museum piece, or the honesty machinery retires alongside the prediction it was built to check.

**The timebox is measuring a product that no longer exists.** Gate 3 — museum posting, 100 visitors, default 2026-08-10 — was registered against the almanac identity, with copy drafted for a front door that this pivot replaces. Gates 1 and 2 failed honest. If the front door becomes a hunter's instrument, gate 3's copy and its measurement both point at the wrong thing. Carry it over, re-register it, or reset the clock — but don't let it quietly expire against a product that was never posted.
