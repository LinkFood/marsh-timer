# THE BOARD SPINE — Rung 2: THE FRAME STORE

> **Design doc, not a build.** The spine every board grammar (replay, live sentry, crossfader,
> the five camera angles) renders from. Rung 1 (`/board/uri`) proved the film by hand
> (`scripts/board/bake-uri.ts` → `public/board/uri-2021.json`). Rung 2 generalizes that one
> hand-baked story into a national, queryable, replayable substrate: **one row per day, every
> instrument's depth-into-its-own-tail, precomputed once, served in a range query.**
>
> Read `docs/THE-WEEK.md` PARK LIST (THE BOARD, THE SENTRY, THE LENSES, near-miss law) first —
> this doc is the machine under those images. Nothing here changes product direction; it builds
> the floor the whole doctrine stands on.

---

## 0. THE ONE-SENTENCE SPINE

**A frame is a day. A day is a vector of every instrument's percentile into its own seasonal tail,
plus the strings that were taut and the outcomes that bloomed. The archive is 27,740 of those
vectors (1950→now). Play them in order and you get the film; diff today's against history and you
get the sentry; nearest-neighbor them and you get ground-state rhyme.**

Everything below serves that sentence.

---

## 1. THE INSTRUMENT REGISTRY — what is a "dot" at national scale?

### 1.1 The dividing line: instruments swell, events bloom

A **dot** is a **fixed geographic instrument that emits a daily scalar we can percentile against
its own history.** That is the ONLY thing that swells and shrinks daily. Everything else is an
event, and events do not swell — they **bloom** (appear once, at their address, sized by severity,
then fade or etch). This split is the single most important decision in the spine:

| Layer | Members | Cadence | Rendering | Lives in |
|-------|---------|---------|-----------|----------|
| **Instruments (dots)** | GHCN state temp, tide gauges, buoys, climate needles | daily scalar | ember sized by tail-percentile² | `board_instruments` registry + per-day pct in frame |
| **Events (blooms)** | quakes, storm-events, stitched named events, OTD | one timestamp | bloom at lat/lng sized by severity | referenced per-day in `frame.blooms`, source rows unchanged |

**Quakes / storms / OTD are NOT registry rows.** They have no stable pin that reads a percentile
every day; a fault is silent for decades then emits one event. They enter frames as **bloom refs**
(§3.4) keyed by their `event_time_utc` / `effective_date`, pinned at their own coordinates
(quakes carry `lat/lng`; storm-events carry county centroids; OTD carry neither — see §1.5). This
is exactly what Rung 1 did: the Feb-15 Texas bloom (`665 · 131 · $736.8M`) is a storm-tally bloom,
not a dot.

### 1.2 Grounded lane inventory (live counts, `count=estimated`, 2026-07-10)

| content_type | rows | granularity | becomes | notes |
|---|---:|---|---|---|
| `ghcn-daily` | **1,446,550** | **state** (50 + terr.) | 50 state-temp dots | per-state avg-high, N reporting stations; no per-station lat/lng |
| `tide-gauge` | **746,499** | point (station) | tide dots | daily rollup carries `residual_max_ft` / `residual_min_ft` (pipe 3) — hundreds of stations in raw archive; roster-curated for the board |
| `ocean-buoy-historical` | **618,101** | point (station) | buoy dots | `pressure_mb` + `min_pressure_mb` (pipe 4) |
| `climate-index` | **9,953** | national | needle dots | **MONTHLY** today: AO 481 mo, PDO 446, NAO 68, ENSO 5. Daily-AO pipe QUEUED (§4.4) |
| `earthquake-event-v2` | **12,939** | point | blooms | `event_time_utc`, `lat/lng` — event lane |
| `storm-event` | 3,562,295 raw / **~2,030,218 live** | county/point | blooms | v2 live (superseded filtered); the outcome layer |
| `stitched-event` | **~4,233** | mixed | blooms (named) | the Lookout Mine's outcome anchors — the brass-etch layer |
| `onthisday-event` | **23,888** | **none** (mmdd) | world ticker | NO `lat/lng`, NO `state_abbr` — keyed by `metadata->>mmdd` (verified) |

### 1.3 The registry table

```sql
CREATE TABLE board_instruments (
  id            text PRIMARY KEY,        -- 'ghcn-tx', 'tide-8574680', 'buoy-42040', 'needle-ao'
  kind          text NOT NULL,          -- 'state-temp' | 'tide' | 'buoy' | 'needle'  (player contract)
  label         text NOT NULL,          -- 'Texas', 'Baltimore', 'Arctic Oscillation'
  sublabel      text,                   -- 'air temperature', 'tide setdown', "the pole's grip"
  lane          text NOT NULL,          -- 'air' | 'water-level' | 'ocean-pressure' | 'climate'  (LENSES key)
  lat           double precision,       -- null for national needles
  lng           double precision,
  albers_x      real,                   -- PRECOMPUTED at canonical 975×610 (bake-uri projector)
  albers_y      real,                   -- needles get a fixed chrome position (AO: 487,28)
  proj_version  int  NOT NULL DEFAULT 1,-- bump if the CONUS-fit projection changes
  source_ct     text NOT NULL,          -- content_type to read: 'ghcn-daily' etc.
  source_key    jsonb NOT NULL,         -- how to find rows: {"state_abbr":"TX"} | {"station_id":"8574680"} | {"index_id":"AO"}
  metrics       jsonb NOT NULL,         -- ordered array of metric defs (§2.4) — defines this dot's slots
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON board_instruments (lane) WHERE active;
```

**`kind` is the player contract**, standardized here to fix Rung 1's punch-list mismatch (the baker
emitted `temp`/`pressure`; the player expects `state-temp`). Registry is canonical from now on.

**Albers is precomputed and stored**, reusing the exact hand-rolled projector in `bake-uri.ts`
(`buildProjector()`, standard parallels 29.5/45.5, origin −96/37.5, CONUS-fit into 975×610 with
padX 34 / padTop 70 / padBot 40). Regression anchor: `('ghcn-tx').albers_x ≈ 461.1, albers_y ≈ 442.9`
(TX centroid, matches `uri-2021.json`). The client rescales linearly to its canvas
(`x' = x · W/975`), so the projection is computed **once, ever** — not per-request, not per-frame.

### 1.4 The first ~500 — what actually ships

v1 does NOT need 500 to be a national board. Composition, smallest real set first:

| kind | v1 count | source | path to 500 |
|---|---:|---|---|
| state-temp | **50** | ghcn-daily (one per state) | already complete at state resolution |
| tide | **~11** (roster) | `tide-roster-backfill.ts` ROSTER | widen to ~100 deepest-record CO-OPS stations |
| buoy | **~20** | ocean-buoy-historical actives | widen to ~150 NDBC pressure stations |
| needle | **4** | AO/NAO/PDO/ENSO | daily-AO first; add MJO/PNA later |
| **v1 total** | **~85** | — | **a complete national board today** |
| station-GHCN | 0 | (queued pipe) | top-200 metros → the bulk of the 500 |

**500 is a horizon, not a v1 gate.** ~85 curated dots already render every catastrophe the horse-ride
test covers. The registry schema is identical at 85 and 5,000; only rows are added. The path to 500 is
mechanical (widen rosters) and one real pipe (station-GHCN top-200 metros, already on the PARK LIST).

### 1.5 OTD and the no-coordinate problem

`onthisday-event` has neither `lat/lng` nor `state_abbr` (verified — sample carries only
`url/mmdd/year/pages/source`). It cannot be a dot and cannot bloom at an address. It enters the board
as a **world ticker** lane (a marginal strip, mmdd-matched), never a map pin — exactly how `/morning`'s
ON THIS DAY panel already surfaces it. Documented so nobody tries to geo-place it and invents a lie.

---

## 2. TAIL-DEPTH MATH — the percentile that swells the ember

Generalizes `bake-uri.ts`'s `coldPct` / `highPct` / `stateBaseline` into one per-metric rule.

### 2.1 The pool: same day-of-year ±N, all years, per metric

For instrument-metric `m` on calendar day `d`:

```
pool(m,d) = { value(m, e) : e ∈ all recorded years,  doyOffset(e, d) ≤ N(kind),  season_ok(m, e) }
pct(m,d)  = rank of value(m,d) within pool, folded to the metric's danger side (§2.3)
```

`doyOffset` is bake-uri's calendar-day distance with Dec/Jan wrap. The pool is **reusable across all
76 years** for a given doy — this is what makes the backfill cheap (§4.2): load an instrument's whole
series once, slide the ±N window in memory.

### 2.2 Window size N per kind (grounded in signal smoothness)

| kind | N (±days) | pool size (typical) | why |
|---|---:|---:|---|
| state-temp | **10** | ~21 d × 76 y ≈ **1,600** | matches bake-uri `stateBaseline`; air temp is smooth |
| tide (residual) | **15** | ~31 d × ~45 y ≈ **1,400** | surge is spiky; wider window for a stable tail |
| buoy (pressure) | **15** | ~31 d × ~20 y ≈ **600** | fewer station-years; widen to hold the floor |
| needle (AO/…) | **15** | ~31 d × 76 y ≈ **2,300** | daily needle once the daily-AO pipe lands (monthly = step-held) |

Rung 1 used a **whole-season DJF pool** for AO/tide/buoy because it was a winter story. The spine
uses **doy ±N year-round** so seasonality is captured for any date, not just winter. The Uri window
reproduces within rounding either way (validated in §7 acceptance).

### 2.3 Two-sided vs danger-side — the buoy lesson, structural

Rung 1 hardcoded the buoy to the HIGH side (arctic ridge, not a hurricane low) per the story. The spine
refuses per-story hardcoding. Each metric declares a `direction`:

- **`low`** — deeper = smaller value (tide setdown `residual_min`, storm low pressure `min_pressure_mb`)
- **`high`** — deeper = larger value (surge `residual_max`, ridge `pressure_mb`)
- **`two-sided`** — either tail is unusual (state-temp `avg_high_f`: heat wave AND cold snap)

**The buoy's arctic-high-vs-hurricane-low tension is resolved by giving buoys TWO metrics**
(`min_pressure_mb` low-side, `pressure_mb`/daily high-side) — the board swells whichever tail the day
is in, so Uri's ridge and Katrina's low both light up the same instrument without any story code.
Same for tide (`residual_max` high, `residual_min` low). **This is the generalization that lets one
registry tell every story.**

Storage trick (§3): **every stored slot is one-sided.** A `two-sided` metric occupies **two slots**
(low-tail pct, high-tail pct); the board renders the larger and colors by which won (blue cold / red
hot). No sign byte needed.

### 2.4 Metric defs (the `metrics` jsonb)

```jsonc
// ghcn-tx
[{ "field": "avg_high_f", "parse": "regex:average high of ([\\d.]+)", "direction": "two-sided",
   "n_days": 10, "season": null, "min_years": 10, "label": "air temperature" }]
// tide-8574680  → 2 slots
[{ "field": "residual_max_ft", "direction": "high", "n_days": 15, "min_years": 10, "label": "surge" },
 { "field": "residual_min_ft", "direction": "low",  "n_days": 15, "min_years": 10, "label": "setdown" }]
// buoy-42040 → 2 slots
[{ "field": "min_pressure_mb", "direction": "low",  "n_days": 15, "min_years": 10, "label": "storm low" },
 { "field": "pressure_mb",     "direction": "high", "n_days": 15, "min_years": 10, "label": "ridge" }]
// needle-ao
[{ "field": "value", "direction": "two-sided", "n_days": 15, "min_years": 10, "label": "the pole's grip" }]
```

### 2.5 The honesty floor: `min_years`

- **≥ 10 years** in pool → dot **swells** (full pct). (Matches morning-line's `n_years ≥ 10`.)
- **1–9 years** → dot **renders but never swells** — pct clamped to a faint cap, slot flagged
  low-confidence. A thin baseline may NOT claim "deepest in history."
- **0 years** → instrument absent from the frame (no slot).

This is the same law atlas-anomaly enforces (`MIN_YEARS`, `z stays null`) — a swollen ember is a claim,
and a claim needs a denominator.

---

## 3. THE FRAME BLOB — one row per day

### 3.1 Schema

```sql
CREATE TABLE board_frames (
  day            date PRIMARY KEY,
  layout_version int   NOT NULL,        -- which registry ordering these bytes decode against
  dots           bytea NOT NULL,        -- packed uint8, one byte per SLOT in registry order
  strings        jsonb,                 -- { "<string_id>": activation 0..1 }  (few — earned only)
  blooms         jsonb,                 -- [ { ref_ct, ref_id, lat, lng, label, severity } ]
  day0_source    text,                  -- 'live'|'live-yesterday'|'archive' for the leading lane (audit)
  updated_at     timestamptz NOT NULL DEFAULT now()
);
```

### 3.2 The packing — bytea uint8, not jsonb

Layout = the registry's active instruments expanded to slots (two-sided → 2), in a fixed order pinned
by `layout_version` (a hash/serial over the ordered instrument+metric list). One byte per slot:

```
byte = 255                      → null (no reading / below min_years floor renders separately)
byte = round(pct × 254)         → pct ∈ [0,1]
```

**Size math (the whole reason for bytea):**

| instruments | slots (~2/inst) | bytes/day | **60-day replay** | 27,740-day archive |
|---:|---:|---:|---:|---:|
| **500** | 1,000 | **1,000 B** | **60 KB** ✓ (<200 KB) | 27.7 MB |
| 5,000 | 10,000 | 10,000 B | **600 KB** ✗ | 277 MB |

At the 500-target a 60-day replay is **60 KB, comfortably under the 200 KB budget.** At 5,000 the raw
replay blows the budget — so **the 200 KB contract caps the product at ~1,600 instruments per full-fidelity
replay**; beyond that the player must request a **lane-filtered subset** (§6 lens) or a coarser cadence.
Documented ceiling, not a surprise.

**Why not jsonb:** at 500 instruments a jsonb `{"tx":{"h":100},…}` frame is ~15–25 KB → a 60-day replay
is ~1.2 MB, **6× over budget.** Bytea wins decisively for replay. (A small jsonb `hot` sidecar on
*today's* live frame only, for debug readability, is fine — one row, not 27k.)

### 3.3 Strings

Strings are **edges, defined once** in a companion table, not per-frame:

```sql
CREATE TABLE board_strings (
  id           text PRIMARY KEY,
  from_inst    text REFERENCES board_instruments(id),
  to_target    text,                  -- instrument id OR a region key (e.g. 'ghcn-tx')
  precedent_ct int,                   -- thickness = court/mine precedent count (EARNED, per PARK LIST)
  receipt      text,                  -- the tap-strip sentence
  source       text                   -- 'lookout' | 'graded-claim' | 'pattern-link'
);
```

The frame stores only per-day **activation** (`strings` jsonb, `{string_id: 0..1}`) — tautness =
formation stage. Strings are earned and therefore FEW (dozens, not thousands), so jsonb is correct here.
Rung 1's three strings (AO→TX, buoy→TX, tide→TX) are the prototype; the mine populates the rest.

### 3.4 Blooms

`frame.blooms` = the events that fired that day, resolved from the event lanes by timestamp:

```jsonc
[{ "ref_ct": "stitched-event", "ref_id": "<uuid>", "lat": 31.0, "lng": -97.6,
   "label": "Texas: 665 events · 131 deaths · $736.8M", "severity": 0.98 }]
```

Bloom rows are **references, not copies** — the source row stays the single source of truth (row
contract, provenance). Severity = normalized deaths·100 + injuries + $M (atlas-spot's proven blend).

### 3.5 FRAME RHYME — the frame as a ground-state vector

The `dots` bytea **is** a national ground-state vector. Nearest-neighbor over frames = "what days did the
whole country look like today." Where the computation lives:

- **NOT hunt_knowledge / Voyage.** That is a 512-dim *semantic-text* space; voyage-3-lite embeds prose,
  not byte arrays. Frame similarity is **structural** (cosine over pcts) in a **separate space.**
- **v1: a brute-force RPC** `board_frame_rhyme(target date, k)` — cosine of target's decoded pcts vs all
  27,740 frames (27 MB scan) is **sub-second in Postgres**, no index. Ship this first.
- **v2 (only if frames × dims grows):** an optional `frame_vec halfvec` column + its **own** ivfflat index
  on `board_frames` — completely separate from hunt_knowledge's index. Build server-side (§7 risk).

This separation is a **deliberate carve-out from the embedding law** — argued in §7.4.

---

## 4. THE BACKFILL PIPE — 27,740 daily frames, 1950→now

### 4.1 It is a write pipe — it queues

`board_frames` writes are a **new write pipe** → **ONE write pipe at a time** doctrine applies: it takes
the claimed lane in the STATE LOG, runs alone, checkpointed. It READS hunt_knowledge heavily (fan-out
fine); it WRITES only board_frames (the single pipe). Current queue ahead of it (STATE LOG 07-11):
tide-gauge index → IVFFlat rebuild → daily-AO ingest → **then this.**

### 4.2 Staging: load-all-per-instrument, compute-all-in-memory, write-per-year

The pool is global-per-instrument-per-doy, so the cheap shape is:

```
for each instrument:
  series = load full history         # ONE paginated scan, bounded by effective_date, NO ORDER BY (57014!)
  for each of 27,740 days:
    matrix[inst][day] = pct(metric, day) against doy±N window sliced from series in memory
assemble frames day-by-day from matrix → pack bytea → upsert board_frames (365 rows / year / txn)
```

Memory: 500 inst × 27,740 days × 2 metrics × 1 byte ≈ **28 MB** — trivially in-RAM. This is exactly
`bake-uri.ts`'s `stateBaseline` pattern (load once, `doyOffset` filter per day), scaled to all instruments.

### 4.3 IO budget, runtime, cost

- **Reads:** state-temp = the whole 1.45M-row ghcn lane; tide/buoy = per-station bounded windows. ~3–4M
  rows total, paginated 1,000/page, **NO `order=` clause** (proven today: ordered scans on ghcn/tide/buoy
  time out 57014). Tens of minutes of reads.
- **Writes:** 27,740 rows × ~1 KB = **27.7 MB**, upserted 365/txn, a few minutes. `day` PK → idempotent.
- **Voyage cost: $0.** Frames are numeric — **not embedded** (§7.4).
- **Total: ~1–2 hours, ~$0 API.** Checkpoint = `{ last_year_done }`; re-run recomputes idempotently (PK
  upsert), so kill+resume is safe — but a resume still reloads instrument series (cheap) to rebuild pools.

### 4.4 What it depends on (queued writes ahead of it)

- **daily-AO ingest (QUEUED):** until it lands, `climate-index` is **monthly** (AO 481 months). The needle
  slot is filled by the **month-held** value (step function) — honest but coarse. When the daily pipe lands,
  recompute ONLY the needle slots (one column of the matrix), cheap. **The board ships with a monthly needle
  and sharpens to daily** — don't block on it.
- **tide-gauge `(content_type,state_abbr,effective_date)` + `station_id` index (QUEUED):** per-station tide
  reads currently time out on ORDER / deep offset. The backfill works today via per-year bounded windows
  (bake-uri pattern), but the index makes it fast. Prefer running the frame backfill **after** the tide index.
- **IVFFlat rebuild (QUEUED):** unrelated to frames (semantic space) — no dependency, but it's ahead in the
  write lane, so frames wait behind it regardless.

---

## 5. THE LIVE EDGE — today's frame + the sentry diff

### 5.1 Updating today's frame

Today's frame needs each lane's **day-0**, which existing crons already write:
- **temp:** `hunt_weather_history` (weather-realtime/watchdog) — atlas-anomaly already reads this as day-0.
- **climate:** the daily climate-index launchd job (fixed 07-10).
- **tide/buoy:** historical only today — no live daily cron. A live tide/buoy day-0 needs a small future cron
  (or the dot renders `archive`/`live-yesterday`, honestly labeled, like atlas-anomaly's `day0_source`).

**New cron `hunt-board-frame-today`** (daily, after the morning data crons): reads day-0 per lane, computes
pcts against the **precomputed pools** (the backfill's per-instrument series, cached or re-derived), upserts
**one** `board_frames` row for today and re-finalizes yesterday. This is a **one-row daily maintenance write**
(like every other daily cron), **exempt from the big-pipe doctrine** — it is not a backfill. It calls
`logCronRun` on every exit path.

### 5.2 The sentry diff → porch sentence + court registration (EXISTING machinery)

The sentry (PARK LIST: "know when fusion is FORMING") re-arms the **existing** TRIGGER→WATCH→REPORT→GRADE
loop with **mined lookouts** instead of the demolished convergence score. It adds **no new grading tables:**

1. **Armed lookouts** (from the Lookout Mine) are threshold conditions over frame slots, e.g.
   `needle-ao two-sided-cold ≥ 0.98  AND  ≥3 buoy high-slots ≥ 0.9`.
2. `hunt-board-frame-today` (or a sibling `hunt-board-sentry` right after it) diffs today's frame against
   each armed lookout; when a lookout's **formation stage** advances it emits:
   - a **porch sentence** — templated from the frame's own facts (morning-line style, no LLM, no forecast):
     *"the needle moved −0.8 → −1.9 over twelve days; the last 19 times this built, here is the outcome record."*
   - a **court registration** through the **existing** `hunt_alert_outcomes` (claim + basis + deadline) and
     `hunt_claims` (the standing lookout), graded later by the **existing** `hunt-alert-grader`. The
     near-miss ledger (PARK LIST) is logged for free — a formation in progress IS a near-miss in motion.

The sentry writes prose (embedded per the law, §7.4) and claim rows; it does **not** touch the frame substrate.

---

## 6. SERVING — `hunt-board-frames`

### 6.1 Contract

```
GET /board-frames?from=YYYY-MM-DD&to=YYYY-MM-DD&lens=air
```
```jsonc
{
  "projection": { "width": 975, "height": 610, "version": 1 },
  "layout_version": 7,
  "instruments": [ { "id":"ghcn-tx","kind":"state-temp","x":461.1,"y":442.9,"lane":"air",
                     "label":"Texas","slots":[{"metric":"avg_high_f","direction":"two-sided"}] } ],
  "strings":  [ { "id":"ao->tx","from":"needle-ao","to":"ghcn-tx","precedent_ct":19,"receipt":"…" } ],
  "frames":   [ { "day":"2021-02-15", "dots":"<base64 bytea>", "strings":{"ao->tx":0.994},
                  "blooms":[{ "label":"Texas: 665 · 131 · $736.8M","lat":31.0,"lng":-97.6,"severity":0.98 }] } ]
}
```

Instruments + string defs are sent **once**; each frame carries only its packed `dots` + activations +
blooms. Range is **capped (≤120 days)** so payload stays < 200 KB at the 500-target. Read-only, no
precompute-on-request. This edge fn **reproduces `uri-2021.json`** for `from=2021-01-15&to=2021-02-20`
(§7 acceptance) — Rung 1 becomes a special case of the general server.

### 6.2 LENSES at read time — no new tables

A **lens is a lane-weight mask**, defined in code (a `LENSES` constant), not a table (honors THE LENSES:
"re-light, never delete"; and "no new tables"):

```ts
const LENSES = {
  all:     { air:1, 'water-level':1, 'ocean-pressure':1, climate:1 },
  air:     { air:1, 'water-level':0, 'ocean-pressure':0, climate:0 },
  coastal: { air:0, 'water-level':1, 'ocean-pressure':1, climate:0 },
};
```

The edge fn returns each instrument's `lane`; the **client** dims/hides out-of-lens dots (or the fn zeroes
their bytes if payload trimming is needed). Denominators stay global (a lens re-lights, never re-computes a
new baseline). Adding a vertical = adding a lens constant, zero schema change.

---

## 7. BUILD ORDER, ACCEPTANCE TESTS, RISKS

### 7.1 Rungs (smallest real thing first; each with a test)

| Rung | Deliverable | Acceptance test |
|---|---|---|
| **2a** | `board_instruments` + seed ~85 (50 states, 11 tide, 20 buoy, 4 needle) | `SELECT count(*) = 85`; `ghcn-tx` albers = (461.1, 442.9); the 3 Uri buoys/tides match `uri-2021.json` coords within 0.1 px |
| **2b** | pool-precompute + `pct(metric,day)` pure fn | feed the Uri window → TX 2021-02-15 = **1.000** (v 21.4), AO 2021-02-10 = **0.997** (v −5.28), Galveston 42035 2021-02-16 high-pct = **0.725** (v 1023.7). Byte-match `uri-2021.json` within rounding |
| **2c** | `board_frames` schema + pack/unpack + backfill **2021 only** | a 60-day range query decodes to identical pcts; payload **< 200 KB** |
| **2d** | full **1950→now** backfill (the pipe) | 27,740 rows; checkpoint kill+resume converges; spot-check Katrina/Sandy/Uri/Sept-11/Ridgecrest days |
| **2e** | `hunt-board-frames` edge fn + LENSES | `from=2021-01-15&to=2021-02-20` **reproduces `uri-2021.json`** dots; `lens=air` drops tide/buoy/needle |
| **2f** | `board_frame_rhyme` RPC (brute-force) | nearest-neighbor to **2021-02-15** surfaces the **Feb 2011 TX freeze** (the same precedent semantic rhyme already found) |
| **2g** | `hunt-board-frame-today` cron + sentry diff | today's frame upserts daily (`logCronRun`); a seeded test lookout writes a `hunt_claims` + `hunt_alert_outcomes` row |

### 7.2 Risks

- **IO / 57014:** every full-lane read MUST be bounded by `effective_date` with **NO `order=`** (proven today:
  ordered scans on ghcn/tide/buoy all time out). Run the backfill off-peak; it's the single write lane.
- **Index locks:** the optional `frame_vec` ivfflat (2f-v2) locks `board_frames` — but it's a new, small table
  (minutes, not hunt_knowledge's 30–60 min). Still build server-side (self-unscheduling pg_cron), never on a
  held client connection — the same pattern that built the 20 GB IVFFlat.
- **layout_version drift:** if the registry reorders/adds instruments, old frames decode wrong. Every frame
  stores its `layout_version`; the server refuses to decode a frame against a mismatched layout (recompute or
  version-map). This is the single sharpest footgun in the design — guard it hard.
- **Monthly-AO coarseness:** the needle is a step function until the daily-AO pipe lands; label it honestly in
  the frame (`day0_source`) and don't let a step-held needle claim daily precision.
- **500-instrument replay ceiling:** the 200 KB budget caps full-fidelity replay at ~1,600 instruments; past
  that, lens-subset or coarser cadence is mandatory (§3.2). Not a v1 problem; a documented growth wall.

### 7.3 Row-contract & shared-DB guardrails (unchanged, restated)

- Frames live in **new `board_*` tables** — never touch JAC tables, never widen hunt_knowledge.
- Bloom refs point at source rows (provenance intact); the board copies nothing it can reference.
- `git status -s supabase/functions/` clean before any edge-fn deploy (07-08 incident).

### 7.4 DO frames get embedded? — the embedding-law argument, both ways

**FOR (embed them):** "Every piece of data → Voyage → hunt_knowledge. No exceptions." A frame is derived data;
the law says no exceptions.

**AGAINST (recommended — do NOT embed frames):**
1. **Type mismatch.** voyage-3-lite embeds **prose**; a frame is a 1,000-byte numeric vector. Embedding a byte
   array produces a meaningless 512-dim point. The law's *mechanism* doesn't apply to non-text.
2. **The law's intent is already satisfied.** The intent is "nothing retrievable falls out of the brain." The
   frame's **source rows** (ghcn/tide/buoy/climate) are ALL already embedded. A frame is a **derived index** over
   already-embedded data — structurally identical to the IVFFlat index itself, which we do not re-embed.
3. **Pollution.** 27,740 non-semantic rows in hunt_knowledge would dilute the 512-dim space and bloat the
   IVFFlat index for zero retrieval value (nobody searches "days like today" in *prose* space — they search it
   in *ground-state* space, which is exactly what `board_frame_rhyme` provides).
4. **The right space already exists in this design:** frame similarity is structural cosine over `board_frames`
   — a **separate, purpose-built vector space**, not a competitor to the brain.

**VERDICT:** Frames are a **derived structural index, carved out of the embedding law** — documented as a
decision, not a drift. The law continues to bind the **inputs** (every source row is embedded) and the
**sentry's outputs** (every porch sentence / graded lookout is prose → Voyage → hunt_knowledge, exactly as
alert grades already are). Only the numeric substrate in between is exempt.

---

## OPEN QUESTIONS FOR JAMES

1. **Registry curation to 500** — auto-select top-N deepest-record tide/buoy stations, or hand-pick the roster?
   (v1 ships ~85 auto from existing lanes; 500 is a later pipe.)
2. **Two-sided temperature color** — does a July heat wave swell the *same* Texas dot that a February freeze
   swells (blue/red both), or should the board only ever light the season's "danger" side?
3. **Needle cadence** — ship the board now on the **monthly** AO (step-held) and sharpen when the daily-AO pipe
   lands, or block Rung 2d on the daily pipe?
4. **FRAME RHYME** — brute-force RPC for v1 (fine to ~100k frames), or stand up the `frame_vec` ivfflat now?
5. **Sentry court scope** — do sentry fires write to the **same** `hunt_alert_outcomes` / `hunt_claims` as the
   old convergence claims (mixed on `/court`), or carry a `board`-scoped tag so the board's grades are a distinct
   ledger?
6. **Live tide/buoy day-0** — stand up a small live CO-OPS/NDBC daily cron so coastal dots swell in real time, or
   accept `live-yesterday`/`archive` labeling for coastal dots until then?
