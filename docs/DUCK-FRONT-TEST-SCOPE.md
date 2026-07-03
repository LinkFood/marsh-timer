# Duck–Front Test — Scope (the "founding-fact" experiment)

**Question:** At **daily** resolution, do cold-front passages precede duck (waterfowl)
migration pulses by 1–3 days — in the *matched* flyway but **not** in a *wrong* flyway?

**Status:** SCOPE ONLY. Nothing built. Written 2026-07-03.

**Non-negotiable design rule (from the convergence postmortem):** run the
**wrong-flyway placebo FIRST**. The "upstream handoff" variant already died on
exactly this test in the aha-hunt — it "measured 'it's fall.'" If a front in
flyway X predicts a pulse in flyway Y just as well as in flyway X, the whole
result is seasonality and we stop.

---

## 1. Data inventory (what we actually hold)

### 1a. eBird — SNAPSHOT, not historical density

`hunt-migration-monitor` (cron 7:00 AM daily) is the only eBird ingest.

- It calls `GET /v2/data/obs/US-{state}/recent?back=1&cat=species` — **the last 1
  day of recent observations only.** The eBird API 2.0 `recent` endpoint caps at
  `back=30`. **There is no way to pull historical daily density from the API.**
- What it persists to `hunt_migration_history`:
  `state_abbr, species='all-birds', date, sighting_count, location_count, notable_locations`.
  - `sighting_count` = raw `Σ howMany` across **all** birds (not waterfowl, not
    effort-corrected — this is a raw count, driven by how many checklists were
    submitted that day).
  - **Waterfowl is NOT stored as a column.** The function computes a per-group
    breakdown (`groupCounts.waterfowl`, uses the waterfowl pattern list at
    `hunt-migration-monitor/index.ts:15`) but throws it away — only the all-birds
    total lands in the table.
  - **BUT** the waterfowl number survives inside `hunt_knowledge`: every
    migration entry's `content` string contains `... waterfowl:N songbird:M ...`
    (`groupBreakdown`, index.ts:243-267), content_type in
    `migration-daily | migration-spike-{moderate,significant,extreme} | migration-lull`.
    So historical **daily waterfowl counts are recoverable by parsing that text**
    for the live-collection window. Ugly but real.
- **History depth:** `hunt_migration_history` had ~13,330 rows on 2026-07-02
  (runbook probe) → ~266 days × 50 states ≈ roughly **Oct 2025 → Jul 2026**.
  That is **one fall migration + one spring** — n=1 fall season for the duck
  question. (Verify exact first/last date before trusting; the cron has gaps.)

**Bottom line: the binding constraint is eBird. We have ~1 year of daily,
state-level, all-birds counts, with waterfowl recoverable from text. No deeper
history exists without the EBD download (§4).**

### 1b. Fronts — RICHER than the brief assumed (two regimes)

There are **two** front data sources, and they do not overlap the same years:

**Regime A — recent window (~2021→now), the one that overlaps eBird:**
`hunt-weather-watchdog` pulls Open-Meteo daily and **already ships a cold-front
detector** (`index.ts:66`): `high drops >15°F day-over-day → event_type='cold_front'`,
written to `hunt_weather_events` with `state_abbr, event_date, temp_drop_f,
prev_high, new_high`. The underlying Open-Meteo `DailyForecast` (index.ts:15-25)
carries **`pressure_msl_mean`, `wind_speed_10m_max`, `wind_direction_10m_dominant`,
`cloud_cover_mean`** — i.e. the *real* met signature of a front (temp drop **+**
pressure rise **+** wind veer to NW) is available for this window, not just a
temp proxy. `hunt_weather_history` holds the daily aggregates (5 yr per CLAUDE.md).
→ **This is what we join against the eBird window.** There is already a dated
cold-front event log to key off.

**Regime B — deep history (1950–2025), ghcn-daily:**
`content_type='ghcn-daily'` in `hunt_knowledge`, state-aggregate, one row per
state-day. `metadata` = `avg_high_f, avg_low_f, avg_precip_in, max_precip_in,
min_temp_f, max_temp_f, snowfall_in, snow_depth_in` (backfill-ghcn-daily.ts:391).
**NO pressure, NO wind.** A front here can only be a **temp-drop + precip proxy**
(`avg_high_f[d] − avg_high_f[d−1]` strongly negative, often with precip). Defensible
as an "airmass transition" marker, weaker than Regime A. **Coverage gap:** the
backfill is A–RI only until the runbook Step 2 (SC–WY, ~8–12h) runs; and it stops
at YEAR_TO=2025 with **no daily ghcn cron**, so ghcn does **not** cover the
2026 eBird window. **ghcn's 76 years are useless for this test on their own —
there is no matching daily eBird to pair them with.** ghcn only becomes the front
source if we get historical daily waterfowl via the EBD (§4).

### 1c. Flyway assignment

No flyway column exists anywhere. Trivial to hardcode a `state → flyway`
(Atlantic/Mississippi/Central/Pacific) map in the analysis script — this is a
50-entry constant, standard USFWS assignment.

---

## 2. Where this will silently lie to us (ranked — the self-deception checklist)

The postmortem catalog is the checklist. In likelihood-of-fooling-us order:

1. **Effort confound (the killer).** eBird counts track *birder activity*, not
   birds. A cold front clears the sky → pleasant weekend → more checklists → more
   birds counted. This manufactures a front→"pulse" correlation that is pure
   observer behavior, and it's **temporally aligned with fronts** (the worst kind).
   Raw `sighting_count` **cannot** be used as the outcome. Mitigation ladder:
   (a) MVE crude: divide by `location_count` (unique hotspots ≈ weak effort proxy);
   (b) real fix: EBD **birds per party-hour** (duration/distance/observers) — §4.
   Until (b), any positive result is presumed effort artifact.
2. **Seasonality / shared trend.** Fronts and fall migration both ramp Sep→Nov.
   A raw lag-correlation "confirms" by co-trending. This is exactly what killed
   the upstream-handoff variant. Mitigation: the **wrong-flyway placebo**, plus
   within-calendar-week matching (compare front-preceded pulses to same-week
   no-front pulses), plus month fixed effects in the full version.
3. **n=1 fall season.** ~One fall in the live eBird window. Even a clean signal is
   statistically fragile and un-cross-validatable. The postmortem's standing
   caveat ("one season, can't difference out seasonality") applies at full force.
4. **State-aggregation smear.** A front crosses a big state over 24–48h; migration
   is local/nocturnal. State-day averaging dilutes a real 24–72h mechanism toward
   null (bias toward *false negative* — safer than a false positive, but means a
   null MVE is not exoneration).
5. **Continental fronts break the placebo.** A single synoptic system can cross
   Central and Atlantic flyways within 1–2 days, so "wrong flyway" isn't cleanly
   frontless. Must select fronts by **flyway-specific passage date**, not "a front
   existed somewhere," or the placebo silently also "fires."
6. **Multiple-comparisons drift.** Lag 1 vs 2 vs 3, temp-drop threshold 10/15/20°F,
   waterfowl vs all-birds, per-location vs raw — many knobs. **Log every lens
   tried** (the postmortem rule) and BH-correct. A survivor found after 20 silent
   tries is noise.
7. **Circularity via the spike label.** Do **not** use `migration-spike-*`
   (content_type) as the outcome — that label is already a week-of-year baseline
   deviation and partly weather-influenced. Use the recovered raw/effort-corrected
   waterfowl series and define the pulse independently.

---

## 3. Recommended MINIMUM-VIABLE experiment (placebo-first, ~1–2 sessions)

**Analysis-only. Zero schema changes, zero edge functions, zero frontend.** One
script in `scripts/experiments/`. Uses only data we already hold.

**Design:**
1. Pick 4 flyway-representative states, e.g. **Central: KS**, **Mississippi: AR**,
   **Atlantic: MD**, **Pacific: CA** (adjust to whichever have the densest
   live-window coverage).
2. Build the daily **waterfowl series** per state by parsing `waterfowl:N` out of
   `hunt_knowledge.content` for `content_type IN (migration-daily,
   migration-spike-*, migration-lull)`, bounded by `effective_date` + `state_abbr`.
   Effort-correct crudely: `waterfowl / max(location_count,1)` (join
   `hunt_migration_history` for `location_count`). Deseasonalize to a within-state,
   trailing-21-day z-score (same method the postmortem's reformulation used).
3. Build the daily **front series** per state from `hunt_weather_events`
   (`event_type='cold_front'`, dated), enriched where possible with
   `pressure_msl` / `wind_direction` from `hunt_weather_history` to require a
   real signature (temp drop **and** pressure rise **and** wind from N/NW).
4. **PLACEBO FIRST:** for each flyway-X front at day 0, measure the mean waterfowl
   z-anomaly at days +1..+3 in **flyway X** vs the **wrong flyway** (a flyway the
   front did not cross that week). Hold the calendar week constant. **If
   matched ≈ wrong, STOP and report "seasonality — no local mechanism."**
5. Only if the placebo separates: report matched-flyway lift with a matched-control
   (no-front, same-week) baseline and BH correction over the lens grid.

**Realistic verdict expectation:** underpowered → most likely "cannot conclude
in one season," possibly a directional hint. Its value is (a) it runs the honest
placebo cheaply, (b) it tells us whether the full EBD project is worth the weeks
of setup, (c) it exercises the harness on real duck data for the first time.

**Files touched:** 1 new — `scripts/experiments/duck-front-test.ts`
(read-only REST against `hunt_knowledge` / `hunt_migration_history` /
`hunt_weather_events` / `hunt_weather_history`). Optional shared: a `state→flyway`
const. **Effort: 1–2 sessions.** No new deps (matches "no new external service"
constraint — analysis-only, uses existing keys).

**Optional durability add-on (do NOT block MVE on it):** add a `group_counts jsonb`
column to `hunt_migration_history` and write it in `hunt-migration-monitor`
(2 files: 1 migration + the function) so future waterfowl density is a clean
column instead of parsed text. Helps *future* data only — can't recover history.
~0.5 session.

---

## 4. FULL version (the real test — has power, has an external dependency)

The only way to escape n=1 and the effort confound is the **eBird Basic Dataset
(EBD)** from Cornell:

- **What:** free, but requires an **access request + agreement** (individuals are
  granted; approval is typically days, not instant) and a citation. Delivered via
  a **Custom Download** filtered by taxon + region + date (filtering is required —
  the full global file is 100+ GB). Request **Anseriformes**, ~6–8 flyway states,
  ~2000–2026 → a few GB TSV. **Also download the companion Sampling Event Data
  (SED)** — this carries `duration_minutes`, `effort_distance_km`,
  `number_observers`, `all_species_reported` — the fields required to compute
  **birds per party-hour**, the only real fix for the effort confound.
- **Pipeline shape:**
  1. Request EBD access (external, lead-time days–weeks) — **start this now if the
     MVE looks promising; it's the long pole.**
  2. `scripts/ingest-ebd-waterfowl.ts` — stream-parse the TSV (never load whole),
     join checklist obs → SED, compute per-checklist waterfowl density, aggregate
     to **state-day effort-corrected density**. Local GB-scale temp storage.
  3. Land it as a real series. Per the **Embedding Law**, each state-day summary
     must be embedded → `hunt_knowledge` (a new content_type, e.g.
     `waterfowl-density-daily`) — OR a dedicated `hunt_waterfowl_density` table
     if you want it queryable without vector search (recommend both: table for
     analysis, embedding for the brain). New table = 1 migration.
  4. Fronts for the deep window: **now ghcn-daily's 76 years become usable** —
     temp-drop+precip proxy paired with real historical waterfowl density. For the
     overlap years also cross-check against Open-Meteo pressure/wind.
  5. Re-run the placebo-first design across **20+ fall seasons** with **month
     fixed effects** and per-flyway front timing. This is the design the postmortem
     named as the definitive version.
- **Files touched:** ~4–6. New: `ingest-ebd-waterfowl.ts`, 1 migration
  (`hunt_waterfowl_density`), `duck-front-test-full.ts` (or extend the MVE script),
  optional embedding writer. Prereq: **ghcn SC–WY backfill (runbook Step 2)** must
  finish for full CONUS front coverage, and ideally extend ghcn YEAR_TO to 2026.
- **Effort: 4–6 sessions of build** + **external approval lead-time** + GB local
  processing. **This is the only version that can actually answer the question.**

**Constraint check (full version):** EBD is a new *data source* but **not a new
runtime dependency** — it's a one-time download processed by a local script with
existing keys (Voyage for embedding). No new API/library/service in the running
system. The only true "new dependency" is the Cornell data-use agreement (free,
citation required). Compatible with the stack; no Vercel/edge involvement.

---

## 5. Recommendation

1. **Build the MVE now** (§3, 1–2 sessions, one read-only script). Placebo first.
   Treat any positive as effort-artifact-until-proven-otherwise. Its job is to
   decide whether §4 is worth it, not to answer the question.
2. **In parallel, submit the EBD access request today** — it's the long pole and
   costs nothing to start. Even if the MVE is null (likely, given n=1 + effort
   confound + aggregation smear biasing toward null), the EBD is the only path
   that can distinguish "no mechanism" from "we couldn't see it."
3. **Do not** invest in ghcn's deep history for this test until EBD daily waterfowl
   exists — without paired historical eBird, 76 years of fronts have nothing to
   predict.

**One-line honest verdict:** the founding-fact test is *buildable cheaply as a
placebo screen* but *not truly answerable* until the EBD download lands — the
brain never stored the effort-corrected, waterfowl-isolated daily density the
question requires; it stored effort-confounded all-birds snapshots.
