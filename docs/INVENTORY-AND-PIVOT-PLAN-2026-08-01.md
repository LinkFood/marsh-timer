<!-- Produced 2026-08-01 by a 17-agent read-only workflow: 7 inventory readers,
     3 classifiers, 3 adversarial verifiers (14 KILL calls overturned), 3 independent
     planners, 1 synthesizer. 351 items catalogued. Read section 0 first — the
     adjudicated contradictions are the highest-value part. -->

# DUCK COUNTDOWN → THE HUNTER'S APP
### One plan, synthesized from three. Written 2026-08-01. 31 days to the goose opener, 70 to Blackwater's duck opener.

**Spine chosen: PLAN A (ship-fastest, additive route).** Grafted: PLAN B's offline pack contract, `GateResult` type, lint boundary and golden-file parity test; PLAN C's risk register, Gate-0 security/backup block, and refusal copy. Where the three contradict, §0 says which won and why.

Everything below carries a probe. Claims I re-verified this session are marked **[V]**. Claims I could not settle are marked **UNVERIFIED** inline.

---

## 0. THE FIVE CONTRADICTIONS, ADJUDICATED

These are the highest-value output of the run. Do not smooth them.

**0.1 — Scope. A says all three modes; B says architecture-first phases; C says freeze to PLAN mode only.**
**A wins, with C's scope cap.** C's logic (cut to one mode) is right; its choice of mode is backwards. PLAN is the mode *most* blocked — it needs county→zone geometry the repo does not have in any of its four committed copies of the United States, and its only shipped card counts a GHCN pool frozen at 2025-12-31 with no writer. FIELD is the mode *least* blocked: sun, moon and solunar are pure math with zero I/O; tide is a free keyless public API computable years forward; the bag counter is `localStorage`. **Ship FIELD by Sept 1, PREP by Sept 1 if it fits, PLAN as the designated slip.** Cap the ground at Maryland — C's "one state family" — because shooting hours are state law and we have transcribed exactly one state's.

**0.2 — Renovation. A says zero edits to `TodayPage.tsx`/`frameStore.ts`/`RarityMap`; B's Phase 0.3 makes splitting `frameStore.ts` (854 lines, 11 importers) a prerequisite for everything.**
**A wins.** B is right that the split blocks *the ledger's kills* — and the kills are all deferred to October. A new `/hunt` route imports `src/lib/supabase.ts` and nothing from the board, so the split blocks nothing on the Sept 1 path. The evidence for deferring: the ledger's own adversarial verifier overturned four frontend kills on missed importers (`MorningPage` reads `fetchFormingWatches`; `frameStore` imports `compileFilm` from `boardPlayer`; `DatePage` imports `useChat`/`BrainResponseCard`/`InlineStateMap`; `/born` has three uncounted inbound links). A four-miss rate on a careful read-only pass is the argument against renovation inside a 31-day window with a fixed external date.

**0.3 — Season data. A says the capture is already complete; the ledger and B treat `hunt_seasons` as thin and needing transcription.**
**A wins on evidence, with a correction that changes who decides. [V]** `data/seasons/2026-27.json`: **357 records, 50 states, 335 `status:"ok"`, 335/335 ok-records carry a `close` on every window, 298 carry a `bag_limit`.** MD alone holds 10 records, including `duck | Eastern Zone | Oct 10–17, Nov 14–27, Dec 15–Jan 30 | bag 6` and `goose | Early Resident Canada Goose - Eastern Zone | Sep 1–15 | bag 8`.

**The correction: the thin table is not a loader bug.** `src/lib/seasonOpeners.ts:1-40` is a documented binding ruling (Amendment 1.5, ruling 2) with its reasoning stated: *"Being wrong on a bag limit is a citation for the hunter — we are not the authority of record on anything with legal consequence when the actual authority publishes a URL we already hold."* **[V]** Plan A's "bake the JSON into the client, ~4 hours" reverses that ruling. It is a cheap *build* and an expensive *decision*. → §8.

**0.4 — The MD zone defect. All three plans and the ledger call it "a confidently wrong date on a real spot."**
**Overstated. [V]** `src/components/season/SeasonBlock.tsx:128` renders `· {o.zone}` beside the date, and `:160-170` renders a multi-zone disclosure: *"we publish the earliest and name the zone or special season it belongs to, so nobody reads a statewide date."* The live card says **"October 3 · Western Zone,"** which is true. It is **under-resolved, not fabricated.** Severity drops from "unrecoverable trust loss" to "incomplete for the flagship spot." It still must be fixed before Oct 10, because Blackwater's actual duck opener is a week later than the date the card shows and the hunter has to do the mapping himself.

Also confirmed: **the goose row is already correct. [V]** Live `hunt_seasons` MD goose row = `zone: "Early Resident Canada Goose - Eastern Zone", dates: [{"open":"2026-09-01"}]`. The Sept 1 target date needs no zone fix at all. Only the October duck openers do.

**0.5 — `hunt-atlas-solunar`. The ledger and B call it the offline core and prescribe porting it; A says do not port it as written.**
**A wins, and it is the single most consequential finding in the run. [V]** `supabase/functions/hunt-atlas-solunar/index.ts:440`:
```ts
const shootingEnd = sun.sunsetMin !== null ? isoFromMinutes(dateUTC, sun.sunsetMin + 30) : null;
```
Comment above it: *"Shooting light: ~30 min before sunrise to ~30 min after sunset."* Federal migratory-bird frameworks and MD both end at **sunset**. Ported verbatim, the app authorizes a hunter into thirty illegal minutes and shows a running clock while he does it. **Port the astronomy; do not port the rule.** B's golden-file parity test is the right mechanism and must **exclude `shooting_light_end`** — otherwise the test enshrines the bug. Same file returns `rating` and `score` (`solunarRating(age)`); strip both — a rating is a prediction wearing a number.

**Secondary adjudications, stated once:**
- **`hunt-weather-realtime`:** ledger says KEEP with a cadence cut; B and C independently say take it to zero for v1. **B/C win** — it writes threshold *events*, never a series, discards station coordinates, and MD's only station is KBWI, ~70 mi from Blackwater across the bay. It cannot answer "what was the wind at 06:00." Two independent planners converging on a reversal of a KEEP is the signal.
- **`hunt_du_map_reports`:** ledger says "top revival candidate, revive before the openers"; B says it is a denominator not a gate (**79 reports ever** within 25 km of Blackwater; MD submissions 151→5 from 2021→2026); C says do not touch it until someone reads why the 07-17 migration killed it. **C gates, B frames:** read the kill rationale first, then revive the cron (national scale is irreplaceable), and print it as *"79 hunter reports have ever been filed within 25 km of here"* — never as GATE 5.
- **The vacuum one-shot:** the verifier overturned the kill on good evidence (`last_vacuum`, `last_analyze` **and** `last_autovacuum` all null on a 10.1M-row table whose planner reads 180,944). **C's conclusion wins over the verifier's:** a `*/30` job that has never once completed is not a maintenance path, it is a false one that the next reader will believe. Diagnose why it never completes; do not bank on it.
- **`board_rhymes`:** the verifier overturned the kill because `TodayPage.tsx:428-436` renders it ungated. **C is right on merit** — that is an argument for deleting the *render*, not keeping a 3.9%-spread argmax on the front door of a count-never-predict product — **but it is front-door surgery and therefore October.**

---

## 1. WHAT WE HAVE

| | |
|---|---|
| `hunt_knowledge` | 10,115,168 rows (planner est.); ~68 GB, of which the IVFFlat index is ~30 GB, `lists=2645` built for 7M rows, `probes=56` tuned for a `lists=3155` index that was never built. 4 of 4 anon vector calls → 57014. Service-role path returned `{unavailable:true}` for **Maryland**. |
| Bounded reads | `content_type + state_abbr + effective_date` → **0.25 s**. Every gate question is this shape. |
| Crons | 60 registered pg_cron jobs / 42 distinct workers / 90 deployed edge functions. `hunt-weather-realtime` = 674 of 1,228 runs in 7 d (54.7%), ~21,500 Voyage embeds/wk. |
| Auth | All 90 functions `verify_jwt=false`. `isServiceRoleRequest` has **zero call sites**. `_shared/auth.ts` imported by **1 of 90**. `_shared/rateLimit.ts:9-12` returns `{allowed:true}` for `userId===null` on the Anthropic path. |
| Season capture **[V]** | `data/seasons/2026-27.json`: 357 records / 50 states / 335 ok / 335 with full closes / 298 with bag limits / 40 states multi-zone. |
| Season table **[V]** | `hunt_seasons`: 100 live 2026-27 rows = 50 × {duck, goose}. `bag_limit` NULL on all 100, no closes, `verified:false`, `provisional:true`. Deliberate, per `seasonOpeners.ts:1-40`. |
| `hunt_zones` | 0 rows, 0 readers, schema exists. `hunt_user_locations` 0 rows, 0 references. `hunt_logs`/`hunt_profiles` 0 rows. |
| Tide | NOAA CO-OPS: **3,499 prediction stations, 100 in MD**, free, keyless, years forward. Nearest to Blackwater: **8571807 Woolford, Church Creek, 10.8 km**. Live probe returned Sept 1 2026 hi/lo in one call. **[V]** |
| Archive tide | `noaa-tide` 81,932 rows / 199 stations / frozen 2026-03-31. Superseded before it was finished. |
| Wind | Open-Meteo `/v1/forecast`, any lat/lng, 8 vars × 168 h = 10,897 B raw / **2,649 B gzip**, 0.55 s. No key. |
| Birds | eBird v2 at 38.4435/−76.0783: **144 obs / 14 d within 25 km**, 93 hotspots, 0.15 s. Key present in `.env.local` **[V]**. State lane (`migration-daily`) has NULL `metadata` and lists *Golden Corral, Frederick* as an MD hotspot. |
| Counting engine | `board_frames` 27,972 rows = the exact contiguous 1950-01-01..2026-08-01 span, zero gaps. `board_series_columns` 332 rows, **baked once 2026-07-25, no writer**, 300 GHCN columns all `last_year=2025`. |
| ERA5 | 0 of 2,400 units. `done:{}`, `rowsWritten:0`, last touched 2026-07-24. 2 of 50 states have any data; all six temperature columns 100% NULL. Remaining cost 310,250 weighted calls = **39 days** against a 31-day calendar. |
| Offline | **No service worker, no manifest, no PWA plugin, no cache layer.** 100% of surfaces are cold network reads. |
| Backups | `~/dcd-backups/` holds 4 run dirs, **all 2026-07-25**, nothing since. `launchctl` shows **no backup job**; the two DCD jobs that exist (`daily-qa`, `daily-indices`) both report **last exit status 1**. **[V]** |
| Live defects | `/date/<future>` renders forecast rows as "THE RECORD" under a NOAA byline (437 forward-dated rows exist; 1,095 were fabricated by `?? 0` and *marked*, not deleted). `hunt-dispatcher/index.ts:1336-1345` reads `d.start`/`d.end` against a stored shape of `{open, close}` → **every 2026-27 season reports `closed`, permanently, including on opening morning [V]**. |

---

## 2. THE LEDGER

Scoped to the Sept 1 path. Rows marked **↺** were overturned by the adversarial verifier; rows marked **↺↺** are ones where I overturn the overturn.

### KEEP

| Item | Evidence | Gate on it |
|---|---|---|
| `hunt-atlas-solunar` (math only) | 484 lines, imports only `cors.ts`+`response.ts`, zero I/O, 0.152 s live. | **Do not port `shootingEnd` (`:440`, sunset+30). Strip `rating`/`score`.** Keep the deployed copy as the parity oracle only. |
| `data/seasons/2026-27.json` | 357/335/298, all closes **[V]** | It is a capture, not a product. Baking it into the client reverses a binding ruling → §8. |
| `hunt_seasons` + `SeasonBlock.tsx` | 100 live rows; `:128` renders the zone, `:166-170` discloses multi-zone **[V]** | Under-resolved, not wrong. Needs county→zone before Oct 10. |
| NOAA CO-OPS (external) | 3,499 stations, keyless, 21 Sept-1s counted in 2.73 s | Bind the station to the spot once, show it, allow override. |
| Open-Meteo (external, direct from client) | 2.6 KB gzip for 168 h at a coordinate | Do **not** route through `supabase/functions/hunt-weather` — its cache is keyed `state_abbr + zone_slug`, so 23 rows serve the country. |
| eBird v2 (external) | 144 obs / 93 hotspots at the pin | It is *reported presence*, not a census. Denominator = `numChecklistsAllTime`. |
| `FrequencyCard.tsx` + `frequency.ts` — **the shell** | 533 lines: count → recency → decade bars → receipt line → caveat | **Split the verdict:** shell KEEP, its six GHCN metrics KILL (frozen `last_year=2025`, no writer). |
| `planting_climatology` | 50 rows, p10/median/p90, named receipt years, printed granularity caveat | The shape every card copies. Do not rebuild. |
| `hunt-embed-interaction` | `:36-72` validation ladder, whitelist of 2 types | The shape every write endpoint copies. |
| `_shared/auth.ts` | Only module with `extractUserIdWithServiceRole`; imported by 1 of 90 | Gateway rewrites `Authorization` — service-role checks must read `apikey`. |
| `CountdownClock.tsx` | Self-contained ticking clock; only importer is the dying `CourtPage` | Repoint at legal-shooting-light. Highest value/effort ratio in the frontend. |
| `Denominator.tsx` / `CiteBlock.tsx` | The receipts law as components | After October's kills they hit zero importers. Rewire into the gate cards in the same commit. |
| `board_frames` + `hunt-frame-daily` | 27,972 rows, zero calendar gaps | Runtime went 2.6 s → 44.6 s over 07-22..07-24. Trending into the timeout. |
| `hunt-nws-monitor` | 168 runs/7 d, 0 errors/30 d, only GeoJSON polygons in the system | Strip the `arcReactor` import (fire-and-forget LLM POST off an hourly cron). |
| `hunt_ops_cache` ↺ | Verifier proved it populated: live dashboard returned 15 `growth_by_day` + 37 `content_types`, fresh to 2026-08-02T00:15Z. `*/0` was an RLS mask. | The kill list's "empty" reading was inadmissible. |
| `crop-progress` (legacy) ↺ | 17,824 rows 2022-25; `crop-progress-weekly` has **zero** rows before 2026. Not a duplicate — the other half of the same lane. | Deleting it would erase GATE 2's entire history. |

### FREEZE

| Item | Evidence | Revival trigger |
|---|---|---|
| Everything on `/atlas`, `/date`, `/morning`, `/court`, `/plant`, `/ops`, `/cascade`, `/board`, `/born` | Full classification in the ledger; four kills already overturned on missed importers | October. Freeze = stop feeding, keep rendering. |
| `TodayPage.tsx` museum body (6 blocks, 6,843 px, 60 sub-44px targets) | Inline JSX, no external importers | October. Renovation is not a 31-day activity. |
| `hunt-weather-realtime` | 54.7% of fleet runs; events only, no series; MD = KBWI, 70 mi away | If GATE 6 ever wants a *series*, build a new lane that keeps coordinates. Not this one. |
| `hunt-du-map` | 52,520 reports; **79 ever within 25 km of Blackwater**; MD 151→5 (2021→2026) | Revive the cron after reading the 07-17 kill rationale. Print as a denominator. |
| ERA5 backfill | 0/2,400; 39 days > 31 days | Keep `era5_sampling_points` (250 rows, `scheme_hash 587429395`) forever so a restart is reproducible. Nothing else. |
| `hunt_solunar_calendar`, `hunt-solunar-precompute`, `photoperiod` | Superseded by 484 lines of on-device math. A state spans 4–7° longitude = 16–28 min of twilight error | Retire when the port lands. |
| `hunt_usfws_harvest` / `hunt_usfws_hip` | 0 rows, **no writer anywhere** | These two empty tables *are* GATE 5's schema. Keeping them costs nothing. |

### KILL

| Item | Evidence | Savings |
|---|---|---|
| `/date/<future>` rendering | `DatePage.tsx:89` has no upper bound; input `max` at `:231` and `goTo()` at `:98` both clamp, the URL does not | 10 min. Removes the site's only mechanism for printing a forecast as a federal record. |
| `brainContext` in `hunt-dispatcher` `season_info` | `:1313-1323` full-brain `searchBrain`, **no content-type filter, 0.35 threshold**, top-3 injected at `:1365` as authority. Brain contains 52,614 DU hunter comments + hand-seeded prose | 1 hr. Closes the only path by which a stranger's field note grounds a regulatory answer. |
| `"and bag limits"` in the system prompt `:1371` | Instructs the model to include a field that is NULL on 100/100 rows, one sentence after telling it not to invent | 1 line. |
| `d.start`/`d.end` in `hunt-dispatcher:1336-1345` **[V]** | Stored shape is `{open, close}`. `new Date(undefined)` → every comparison false → `status='closed'` forever | 1 hr, or delete the status computation. |
| Anonymous rate-limit bypass | `_shared/rateLimit.ts:9-12` + `hunt-dispatcher:480-496` | Killing `/ask` does **not** close it — `DatePage.tsx:167` calls the same dispatcher and the URL stays curl-reachable. Close it server-side. |
| `hunt-generate-embedding`, `hunt-cron-health`, the 8 unscheduled LLM functions | Unauthenticated public endpoints spending `VOYAGE_API_KEY`/`ANTHROPIC_API_KEY`; `hunt-cron-health` returns 37,475 B to a stranger | Attack surface. ⚠ `hunt-generate-embedding` is the `USE_EDGE_FN` fallback in 28 backfill scripts — check before undeploying. |
| The 13 confirmed dead-thesis crons | `power-outage` (29,382 rows, no reader), `bio-correlator` (1,100 queries/run), `gbif-daily` (**0 rows ever**), `snow-cover-daily` (**0 rows ever**), `search-trends`, `multi-species` (9 rows), `disaster-watch`, `historical-news`, `alert-calibration`, `pattern-link-worker`, `arc-narrator`, `hunt-solunar`, `query-signal` **cron only** | ~3,700 Voyage embeds/wk. **October** — each kill needs a same-commit edit to two hardcoded registries or `/ops` drifts further. |
| `hunt-phenology-weekly` ↺ | Overturned: 952 rows on a perfect Wednesday cadence through 2026-07-29. It doesn't log on success. | Kill was factually wrong. |
| `hunt-alert-grader` ↺ | Overturned: the quoted `graded:0` is the 17:00 run; the 11:30 run graded a confirmed alert on 5 of the last 7 days. | Kill was factually wrong. |
| `vacuum-hunt-knowledge-oneshot` ↺↺ | Verifier overturned the kill correctly (never completed once). **I overturn the overturn's conclusion:** a job that has never completed is not maintenance. | Diagnose, don't bank. |
| `board_rhymes` ↺↺ | Verifier overturned on the ungated `LedgerRow` render at `TodayPage.tsx:428-436`. That is an argument for deleting the render. | October (front-door). |
| `maplibre-gl@^5.24.0` | Zero imports anywhere in `src/` | Install time only. |
| `recharts` (with `/ops`) | 381,643 B raw / 112 KB gzip, **only importer is `OpsPage.tsx`** | ~35% of all JS shipped. Must delete `vite.config.ts:19` `manualChunks` in the same commit. |

---

## 3. WHAT THE PRODUCT IS

Three modes, one spot, six gates.

**PLAN** — weeks out. Tide, moon, sun, season dates, day-of-week. Everything computable years ahead. *"At Woolford, the tide has fallen through 06:00–09:00 on 15 of the last 21 September 1sts."*

**PREP** — the night before. Wind lock-in, tomorrow's tide with the shooting window shaded across it, recent bird reports at the pin, the zone's dates and limit with its citation. No verdict. The hunter reads the arrow.

**FIELD** — in the blind, **offline**. Legal-shooting-light countdown, moon, tide now, wind-with-its-age, bag counter against a cited limit, sunset.

**The six gates are a CONJUNCTION, not a sum.** All six must be open; any one shut takes the day to zero. This is why the old engine — which summed 8 weighted domains into a 0–135 score — had no signal: summing destroys a conjunction. The app displays six facts and **the hunter conjoins them.** There is no score, no rating, no stars, no go/no-go verdict, ever.

| | |
|---|---|
| **1 BIRDS** | are they in the region |
| **2 FOOD** | is there anything to eat |
| **3 WATER** | huntable depth |
| **4 MOON** | did they feed all night |
| **5 PRESSURE** | have they been shot at |
| **6 GEOMETRY** | does wind/sun work for *your* blind |

**COUNT, NEVER PREDICT.** Every surface is a measurement, a computation, or a cited regulation. Anything else is refused out loud, by name, with the reason. Four prediction theses died here — convergence (no signal), lineup precedent (−0.19 pp over 1.35M paired days), the fusion metric (invalid), tail-depth comparability (43% band disagreement). None is resurrected.

**Enforced in the type system, not by review:**
```ts
type GateResult =
  | { state:'open'|'shut'; value:number; unit:string;
      denominator:string; citation:Citation; as_of:string }
  | { state:'refused'; reason:RefusalReason; detail:string; citation?:Citation };

type RefusalReason = 'no_lane_here' | 'wrong_resolution' | 'stale'
                   | 'too_few_years' | 'provisional' | 'zone_unresolved';
```
There is no code path that returns a number without a denominator and a citation.

---

## 4. HONEST COVERAGE

**How many states each gate can actually be populated for, today.** This is the section that stops the overpromise.

| Gate | Live source | States | Resolution | Offline? |
|---|---|---|---|---|
| **4 MOON** | on-device math (port of `hunt-atlas-solunar`) | **50 + any lat/lng on earth** | exact coordinate | **yes, zero bytes** |
| **6 GEOMETRY** | sun (computed) + Open-Meteo point forecast + user's blind bearing | **50** | exact coordinate; forecast, not an anemometer | yes, packed with issue time |
| **3 WATER — tidal** | NOAA CO-OPS predictions, 3,499 stations | **25 + DC.** FL 583, AK 524, SC 247, NJ 195, CA 193, WA 162, VA 132, NY 124, ME 111, **MD 100** … DC 5 | station (Woolford = 10.8 km from Blackwater) | yes, deterministic |
| **3 WATER — inland** | USGS Instantaneous Values | ~50 **but unbuilt**; 154 active gage-height sites in MD alone | gauge | snapshot only |
| **3 WATER — impoundment** | — | **0** | no lane exists anywhere in the project | — |
| **1 BIRDS — spot** | eBird v2 geo | **50 where birders are**; thin in remote country | 25 km radius of the pin | yes, packed |
| **1 BIRDS — state** | `migration-daily` | 50 | state; `metadata` NULL on every row; history begins 2026-03-10 → **no season-over-season denominator until 2027** | packed |
| **1 BIRDS — radar** | BirdCast | 50, but publishes **only Mar 1–Jun 15 and Aug 1–Nov 15**; 2026 rows dropped `metadata` | state | packed |
| **2 FOOD — harvest timing** | `crop-progress-weekly` | **19.** AR CA IL IN IA KS KY LA MN MS MO NE ND OH OK SD TN TX WI. **MD, DE, NJ, VA, NC are not among them.** Zero rows in any prior duck season | state | packed |
| **2 FOOD — baseline** | `crop-data` NASS county acreage | 32 in 2024, **0 in 2026**. Dorchester MD 2024: 26,800 ac corn / 44,100 ac soybean | **county** | packed |
| **2 FOOD — SAV / moist-soil** | — | **0** | no lane exists | — |
| **5 PRESSURE** | — | **0** | `hunt_usfws_harvest` + `hunt_usfws_hip` are empty with no writer anywhere | — |

**The honest product statement: two gates are national and exact, one is national and coarse, one is coastal-only for its good source, one is a 19-state feature that excludes the entire mid-Atlantic, and one does not exist.** Ship four gates where they are true and render GATE 2 and GATE 5 as visible structural absences. A gate that says *"no food lane exists for Maryland"* is a stronger product than a gate that shows a plausible national number.

---

## 5. THE BUILD

### GATE 0 — this week (Aug 2–4). Blocks everything. ~1 day of work, some of it human-only.

| # | Work | Why it is first |
|---|---|---|
| **0.A** | Verify the anon `EXECUTE` grant on `public.admin_unschedule_job(text)` — `20260707120000_vacuum_hunt_knowledge_oneshot.sql:20-33`, `SECURITY DEFINER` over PostgREST. Its sibling `vacuum_hunt_knowledge_status()` **executed with only the anon key this session**. | If anon holds EXECUTE, any stranger can `cron.unschedule()` any job in a cluster shared with **Lupa and JAC**. 10 minutes, blast radius outside this project. |
| **0.B** | `DCD_BACKUP_SYNC_CMD` → non-AWS object storage; launchd plist after 11:45 UTC; one hand-run. Fix the two DCD launchd jobs exiting 1. **[V]** | Backups last ran 2026-07-25. `scripts/frames/.frame-cache` (35 MB, gitignored, 0 files tracked) is the sole reconstruction path for the board stack and its only off-cluster copy is 8 days old on one laptop. |
| **0.C** | Clamp `DatePage.tsx:89` to today. | Live false citation on a public URL. 10 minutes. |
| **0.D** | Delete `brainContext` from `hunt-dispatcher` `season_info` (`:1313-1323`); drop `"and bag limits"` from `:1371`. | Removes the only path by which a DU hunter comment grounds a regulatory answer. |
| **0.E** | Fix or delete `d.start`/`d.end` at `hunt-dispatcher:1336-1345`. **[V]** | `/ask` currently reports every 2026-27 season permanently closed. |
| **0.F** | Close the anonymous rate-limit bypass server-side (`rateLimit.ts:9-12`). | Route kills do not close it. |
| **0.G** | Confirm `npm test` boots — `vitest.config.ts:8` references `./src/test/setup.ts`. **UNVERIFIED whether that file exists.** | 989 lines of tests are the pivot's only regression protection. |

### SPRINT 0 — Aug 2–4 (parallel with Gate 0). Unblocks the card.

| # | Deliverable | Blocks |
|---|---|---|
| 0.1 | `src/lib/sky.ts` — port the pure math from `hunt-atlas-solunar` (`:1-470`). Export `sunTimes`, `moonState`, `solunarWindows`. **Do not port `shootingEnd`. Do not port `rating`/`score`.** | all of FIELD |
| 0.2 | `src/data/regs/shootingHours.ts` — `{ MD: { start:"sunrise-30", end:"sunset+0", cite:<eregs URL>, verified:"2026-08-01" } }`. **MD only.** Every other state absent → the clock refuses by name, never falls back. | 1.1 |
| 0.3 | Golden-file parity test: `sky.ts` vs the deployed function across 366 dates × 6 spots, **excluding `shooting_light_end`**. Fixtures committed. Server copy stays deployed solely as the oracle. | makes 0.1 defensible |
| 0.4 | `src/lib/spot.ts` + `useSpot()` — `{name, lat, lng, county_fips, county_name, state, zones:{duck,goose}, coops_station_id, station_miles}`. Resolved **once at save time**, frozen in `localStorage`, **never re-resolved in the field**. Deliberately *not* an extension of `useYourGround` (12 importers). | everything |
| 0.5 | ESLint `no-restricted-imports` banning `@/lib/supabase`, `@supabase/supabase-js` and bare `fetch` inside `src/lib/sky.ts`, `tide.ts`, `geometry.ts`, `src/lib/gates/**`, `src/pages/FieldPage.tsx`. | A future edit that reintroduces a network read fails `npm run lint`, not the boat ramp. |
| 0.6 | `<Route path="/hunt">` lazy in `App.tsx`. Three tabs. Zero edits to any existing page. | — |

### SPRINT 1 — Aug 5–11. FIELD, online.

`FieldClock` (countdown → running clock to legal end; lift the tick from `CountdownClock.tsx`) · `FieldSky` (moon + the one GATE 4 sentence: *"up from 21:08 last night, 80% lit — they could see all night"*) · `FieldBag` (tap-to-increment against the cited limit, per-date, `localStorage`; header always carries species + zone + limit + `provisional_note` + source link) · `src/lib/tide.ts` + `FieldTide` (CO-OPS `datagetter`, labeled *"harmonic predictions, not observed water"*) · `src/lib/wind.ts` + `FieldWind` (Open-Meteo direct from the client; **every render stamps the fetch age**) · 375 px pass (≥44 px targets, bag counter ≥64 px, dark-first, one column).

**Global rule, from `feedback_null_coerced_to_zero_fabricates`:** every parse in the FIELD path is `Number.isFinite()`-guarded. `?? 0` appears nowhere in `tide.ts`, `wind.ts` or `sky.ts`. A missing tide reading is not a 0.0 ft tide.

### SPRINT 2 — Aug 12–18. OFFLINE. **The highest-risk sprint; it sits in the middle, not at the end.**

`vite-plugin-pwa` + `public/manifest.webmanifest`, precaching **the `/hunt` chunk only** — never the museum routes, never pack data. Then `src/lib/dayBundle.ts`: one **"PACK THE TRUCK"** button, fetched on wifi, written to IndexedDB (hand-rolled ~120 lines; no Dexie, no idb).

**Measured pack budget, per spot per season: ~185 KB raw / ≈50 KB gzip** — smaller than the `recharts` bundle currently shipped to serve one orphan route.

| shard | gzip | TTL |
|---|---|---|
| `sky` | **0** — computed on device | never |
| `tide.hilo` (475 rows, Oct 1 → Jan 31) | 3,794 B | immutable per season |
| `wx` (8 vars × 168 h) | 2,649 B | 3 h |
| `birds` (trimmed to 5 fields) | ~2.5 KB | 12 h |
| `season` + `alerts` + `du` | ~6 KB | per-shard |

Call `navigator.storage.persist()` and **show the result** — iOS evicts tab-visited site data after ~7 days; home-screen-installed PWAs are exempt, which makes the install prompt load-bearing, not decoration.

**2.4 is a gate, not a task:** airplane mode, hard reload, confirm clock ✓ moon ✓ tide ✓ bag ✓ wind ✓-with-age. **If it fails on Aug 18, Sprint 3 is cancelled and the week goes to offline.**

### SPRINT 3 — Aug 19–25. PREP (online only, expendable).
Dawn-window wind strip (04:00–10:00, direction as a compass arrow, no verdict) · eBird at the pin grouped by `locName` · tomorrow's tide with the shooting window shaded · the season block.

### SPRINT 4 — Aug 26–30. PLAN. **The designated slip — cut whole if Sprint 2 runs long.**
`src/lib/tideFrequency.ts` (the count that ran in 2.73 s for 21 years) + one card reusing `FrequencyCard`'s **grammar, not its data**.

### Aug 31 (Mon) 05:15 — DRESS REHEARSAL
Drive to Blackwater. Airplane mode from the truck. Run the FIELD card for the full window as if hunting. **Fix nothing on site**; write down what failed, fix it that afternoon. This is a scheduled deliverable.

### Sept 1 (Tue) — FIELD TEST. Early Resident Canada Goose, Eastern Zone, Sep 1–15, 8/day. **No deploys that day.**

### Sept 1–5 — HARD-DATED
MD DNR publishes final USFWS-approved dates in September. Re-verify all 10 MD records; drop the provisional banner or update. On the calendar, not in someone's head.

### Sept 15 (Tue) — early goose closes
Post-season pass: read the bag log, cut whatever went untouched in 15 days of real use.

### Oct 10 (Sat) — **Blackwater's duck opener. Eastern Zone. Not Oct 3.** [V]
Ships by then: county→zone resolution (MD only, from TIGER county polygons — the repo has four copies of the United States and **zero county geometry**) · multiple saved spots · **species-aware bag** (ducks are a 6-bird aggregate with per-species sublimits — a real transcription job, ~6 h, MD only, re-verified against the final publication) · **GATE 6 v1: blind bearing + wind-relative + sun-relative**, pure trig, on-device, no data — the only gate that is 100% computable and 100% spot-resolved, deferred only because a first-time user has no bearing on Sept 1.

**Dependency spine:** `0.1 + 0.2 → 1.1` · `0.4 → 1.4, 1.5` · `1.x → 2.1 → 2.2 → 2.4 (GATE) → Aug 31 rehearsal → Sept 1`. Sprint 3 and 4 hang off the side and are cut in that order.

---

## 6. DO NOT BUILD

| Not building | Why |
|---|---|
| **Any surgery on `TodayPage.tsx` / `frameStore.ts` / `RarityMap` / `boardPlayer.ts` before Oct** | 11 importers, four ledger kills already overturned on missed couplings. One white screen away from losing a week against a fixed date. |
| **The national map (v1b)** | 4–5 weeks of renderer work (~575 new lines + a fronts parser with no fixture corpus). Measured tap targets at 375 px: DC 1×2, Delaware 6×11, MD 28×14, against a 44 px minimum. The product is one man's marsh; a spot **list** is the correct control. |
| **Offline basemap tiles** | Tens of MB for the Chesapeake alone against a 50 KB pack. GATE 6 needs a bearing and an arrow, not a basemap. |
| **NEXRAD roost detection** | `grep -rniE "nexrad\|roost"` returns **zero radar code** — only hand-seeded turkey prose. Differentiating an exodus ring from clutter, insects and precip is a publishable result, not a 31-day feature. Do not put it on a roadmap slide. |
| **ERA5 completion** | 0/2,400 units; 39 days of budget against 31 days of calendar. Arithmetically impossible. Leave `TAIL_DEPTH_IS_COMPARABLE=false` — that is the correct posture. |
| **GATE 5 in any form** | 0 states, no writer, no public spot-resolution source. Render the absence; do not proxy it with day-of-week and call it a gate. |
| **Vector search anywhere near a gate** | Service-role path returned `{unavailable:true}` for **Maryland**, the ship target. Every gate question is a bounded count at 0.25 s. Delete the 4 s race at `hunt-atlas-spot:1452-1462` rather than tuning it. |
| **A free-text regulations assistant** | Render the row, print the URL. A regulatory answer generated from a 0.35-similarity brain search is R5. |
| **Species ID** | An offline classifier whose errors have a **legal** consequence, because bag limits are species-specific. Manual picker beside the cited limit; refuse ID out loud. |
| **Any server-side gate verdict endpoint** | If the verdict is computed on the server, FIELD mode is a lie. The pack carries inputs; the device computes the conjunction. Non-negotiable. |
| **Any score, index, rating or composite** | `hunt_convergence_scores` (6,020), `hunt_convergence_alerts` (529), `hunt_score_history` (7,635) all stop dead on 2026-07-11. A conjunction rendered as a number is the same mistake with better branding. Note `hunt-atlas-solunar` already returns `rating`/`score` — strip both on the port. |
| **Accounts, `/auth`, server-side user state** | `hunt_profiles`/`hunt_logs`/`hunt_user_locations` all 0 rows; `hunt-log/index.ts` reads `hunt_solunar_precomputed`, which 404s. `localStorage` + IndexedDB for one user. Sync is an October problem, and only if there is a second user. |
| **Push notifications / background sync** | iOS has no Background Sync API and web push requires home-screen install. Sync is an explicit act — that is a feature, and the hunter knows what he has. |
| **New dependencies (Dexie, idb, workbox, maplibre)** | The store and SW are ~200 hand-rolled lines. `maplibre-gl` is already in `package.json:22` with zero imports. |
| **The cron kills and the `/ops` rebuild** | Real savings, zero effect on Sept 1. Every kill needs a same-commit edit to `hunt-ops-dashboard/index.ts:29-35` **and** `hunt-cron-health/index.ts:18-33` or the registries drift further. October, wholesale — except Gate 0. |
| **Any claim that a place is legal to hunt** | The app names a season, a zone, a limit and a citation. It never says "you may hunt here." Land status, refuge permits and NWR hunt programs are outside what this data supports, and getting it wrong is a citation for the user. |

---

## 7. RISKS, RANKED

Probabilities are judgment, not measurement.

| # | Risk | P | Blast | Cheapest mitigation | Cost |
|---|---|---|---|---|---|
| R1 | **Reframe instead of ship.** Six documented direction changes in 23 days, each with its own doctrine file; this classification sweep is the seventh act of re-describing. PLAN-V1's week-2 foundation (`board_pool_luts.episodes`) **is not applied to the live DB** — PostgREST 42703 — and a week has passed. | 0.7 | the project | §5 §0.1: one mode, one state, one date. Nothing widens. | 0 |
| R2 | **Zone under-resolution on the Oct 10 duck opener.** The card names "Western Zone" truthfully **[V]**; it does not know Dorchester. | 1.0 (live) | Oct, not Sept | County→zone for MD only + refuse elsewhere. **Not on the Sept 1 path — the goose row is already Eastern Zone [V]**. | 2 d |
| R3 | **Gates cannot be populated nationally.** §4. | 1.0 (true now) | the promise | Name coverage per gate on the surface; refuse GATE 2 and 5 out loud. | 1 d |
| R4 | **The frequency card ages out.** `board_series_columns` baked once 2026-07-25, no writer; 300 GHCN columns end 2025-12-31. Nothing fails — it just counts a record that stops eleven months before the hunt. | 0.9 by Nov | the only shipped deliverable | Daily GHCN appender + nightly column append in `hunt-frame-daily`. **Rank above ERA5, above the map, above every kill except Gate 0.** | 2 d |
| R5 | **Regs assistant transmits wrong data faithfully / retrieval contamination.** `:1313-1323` full-brain search at 0.35, injected at `:1365` as authority. | 0.4/session | R2's genus + liability framing | Gate 0.D. | 1 hr |
| R6 | **Backup on one Mac, 8 days stale, no job registered.** **[V]** `hunt_knowledge` has never been dumped or restored at any scale; the Supabase physical restore has never been performed. | 0.05/qtr | total, permanent | Gate 0.B. **Human-once, and it has been 30 minutes away for 8 days.** | 30 min |
| R7 | **`/date/<future>` prints forecast as THE RECORD under a NOAA byline.** | 1.0 (live, public) | R2's genus | Gate 0.C. | 10 min |
| R8 | **Cross-project blast.** `admin_unschedule_job` SECURITY DEFINER over PostgREST + whole-cluster backups shared with JAC and Lupa. | 0.1 | outside DCD | Gate 0.A. | 10 min |
| R9 | **`shootingEnd` = sunset + 30 [V]** ported into FIELD mode. | 0.9 if ported blind | a hunter in an illegal shoot, with the app's clock running | §0.5: per-state cited rule table; golden test excludes the field. | 2 hr |
| R10 | **Offline fails on Aug 18.** No SW, no manifest, 100% cold reads today. | 0.35 | FIELD mode is the product | 2.4 is a gate: cancel Sprint 3, spend the week on offline. | scoped |
| R11 | ERA5 never finishes. | 0.95 | narrow — a deferred card + a flag already `false` | Cut from v1. | 0 |

---

## 8. DECISIONS THAT NEED JAMES

**8.1 — THE EMBEDDING LAW.** `CLAUDE.md` states it absolutely: *"ALWAYS embed new data. Every piece of data → Voyage AI → hunt_knowledge. No exceptions."* All three planners flagged it; none decided. The plan above retires ~3,700 Voyage embeds/wk by stopping producers, and the FIELD pack architecture needs **zero embeddings** — every gate question is a bounded count on `(content_type, state_abbr, effective_date)` at 0.25 s, while the 30 GB IVFFlat index returns 57014 on anon and `{unavailable:true}` for Maryland. **Recommended wording, for your ruling: "Every lane we keep is embedded. Not collecting is not the same as collecting and not embedding. The pack is not the archive."** Retiring the law is an architectural ruling, not cleanup. Do not let an agent make it.

**8.2 — REVERSE OR KEEP THE OPENERS-ONLY RULING.** `seasonOpeners.ts:1-40` is Amendment 1.5 ruling 2, with its reasoning written down: *"we are not the authority of record on anything with legal consequence."* Baking the full 357-record capture into the client (closes, bag limits, all zones) is ~4 hours of build and a direct reversal of that ruling. The FIELD bag counter **cannot ship without a bag limit**, so this must be decided before Sprint 1. Options: (a) reverse the ruling and carry limits with a permanent "not the authority of record" banner; (b) keep the ruling and ship the counter with no target — it counts, it never says "you are legal"; (c) reverse for MD only.

**8.3 — WHICH LIVE ROUTES SURVIVE.** Ten freeze/kill calls in the ledger are downstream of one product ruling: do `/ops`, `/court`, `/morning`, `/atlas`, `/date`, `/cascade`, `/board`, `/born`, `/plant`, `/ask` survive the pivot? Naming the survivors collapses ~10 freezes into kills. Nothing on the Sept 1 path depends on the answer — but nothing in October can start without it.

**8.4 — DU MAP TERMS.** 52,520 hunter reports scraped from `webapi.ducks.org/migrationmap` into what is being rebuilt as a competing hunting product. The ingest was deliberately unscheduled 2026-07-17 and nobody has read why. Value is real; the exposure is priced at zero in every plan. Your call, after reading the kill migration's rationale.

**8.5 — IS DCD STILL TIMEBOXED?** Memory records `TIMEBOX through 2026-08-10` with three pre-registered gates and a default of mothball-to-crons, nights to Lupa. This plan spends 31 nights on DCD. If the timebox still binds, the plan violates it on Aug 11.

**8.6 — THE SHOOTING-HOURS RULE IS A LEGAL SURFACE.** §0.5's table (`start: sunrise-30, end: sunset+0`) is my reading of a published regulation, transcribed by an agent. A human should read it against the MD booklet once before a countdown is pointed at a gun.

---

## 9. OPEN QUESTIONS

| Question | Why it matters | Cheapest way to settle |
|---|---|---|
| Does `src/test/setup.ts` exist? **UNVERIFIED** | 989 lines of tests are the pivot's only regression protection; `vitest.config.ts:8` references it. If it is missing, the suite is not running and none of the kills is safe. | `ls src/test/setup.ts && npm test` — 2 min |
| Does anon hold `EXECUTE` on `admin_unschedule_job`? | Any stranger could unschedule any cron in a cluster shared with Lupa and JAC. | One service-role `has_function_privilege` query — 10 min |
| Are all ~10.1M `hunt_knowledge` rows actually embedded? | Decides whether the Embedding Law is honored or believed. Four bounded slices came back 100%; the population count times out at 57014 on anon. | One service-role `count where embedding is null` |
| What are the ~50 unaccounted `content_types` (~1.2M rows)? | Nobody can claim the lane inventory is complete. `RECON` claims 105 types; 55 were enumerable from anon. | One service-role `GROUP BY content_type` with counts and `max(effective_date)` |
| Why did `hunt-drought-monitor` succeed on 07-28 and write nothing? | A success status on an empty write is the failure mode this fleet cannot see — the same class as `hunt-birdweather` logging `errors:2` on 7/7 runs and escalating nothing. | Read one run's logs |
| Why has the vacuum one-shot never completed? | `last_vacuum`, `last_analyze` **and** `last_autovacuum` all null on a 10.1M-row table whose planner reads 180,944. Nothing is maintaining it. | One service-role `pg_stat_user_tables` read + a manual `ANALYZE` timing |
| Do the batch fan-outs still need to be batches? | 22 registered jobs for 5 workers — the main reason the registry reads 60 and the health surface is intractable. | One timing test per worker at full 50-state scope |
| Is `morning_lines`' 502 intermittent or dead? | Decides whether a freeze or a fix. Evidence conflicts: the grader logged a 502 on 07-31, another reader measured a live row published 2026-08-02T00:22Z. | One GET after the next scheduled run |
| Do the 1,095 marked-fabricated rows get filtered by `ComingLine.tsx`? | If not, the one pivot-era route renders a fabrication. | Read the marker column from `20260725140000` and grep every reader |
| External callers of the endpoints slated for undeploy? | Every "zero callers" verdict is a repo grep — it cannot see a bookmark, a curl habit, or an uptime monitor. ⚠ `hunt-generate-embedding` is already known to be the `USE_EDGE_FN` fallback in 28 scripts. | Ask James; undeploy is reversible in one command, a silent external break is not |

---

**First commit:** Gate 0.A (the grant) → Gate 0.B (the backup) → 0.1 + 0.3 (`sky.ts` + the parity test) → **prove the floor: a page that, with the network physically off and IndexedDB empty, prints legal shooting light from GPS alone.** If that page works, the architecture is real and the other five gates are data problems. If it doesn't, nothing else on this list matters.