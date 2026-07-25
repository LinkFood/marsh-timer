# ERA5 SAMPLING SCHEME — v1, FROZEN
### The point-selection rule behind `era5_state_pressure` · written 2026-07-25 · **sampling_version = 1** · **scheme_hash = 587429395**

> **Amendment 1.3, Ruling 3a / PLAN §10.3, verbatim:**
> *"Freeze and version the scheme. Document the point-selection rule, store the actual coordinates used per state, add a `sampling_version` column. If those points ever move, every historical number moves with them and the archive silently stops being comparable to itself — invisible for a year, then unfixable."*

This document is the human-auditable half of that ruling. The machine-readable half is `scripts/era5/sampling.ts`, which **is** the rule — deterministic, offline, dependency-free — and the `era5_sampling_points` table, which stores the 250 resolved coordinates so a future run can *prove* it used the same points rather than assert it.

**Do not edit v1 in place. Ever.** If the rule must change, bump `SAMPLING_VERSION`, leave v1 intact and reachable, and let the two tiers coexist — `sampling_version` is part of the primary key of `era5_state_pressure` precisely so that a v2 cannot overwrite v1 and cannot be silently blended with it.

---

## 1. Why five points and not a centroid

The card says **"Maryland statewide."** A single ERA5 pull at a state centroid is one grid point, which is *less* than statewide — it would overclaim in the opposite direction from the one this project has spent months guarding against. The plan's §9.1 raised it, Ruling 10.3 settled it:

> *"ERA5 5-point average approved, with the scheme frozen and versioned … On the card face, a 5-point areal aggregate is fairly described as Maryland statewide; the 5-point detail belongs in the methods note. We are guarding against overclaiming resolution, not against plain language."*

Five points also cost nothing extra. Open-Meteo's weighting is per location-day, and the five points are five locations in one HTTP request.

---

## 2. The rule

Reproducible from this text alone. `scripts/era5/sampling.ts` implements exactly this and nothing else.

1. **Geometry.** `src/data/atlas/usStates.geojson.ts` — 51 features (50 states + DC), US Census TIGER lineage via PublicaMundi, `[lon, lat]`, coordinates rounded to 2 decimals (~1.1 km). DC is not sampled. The roster is the 50 keys of `supabase/functions/_shared/states.ts`, the same roster the board registry uses.

2. **Principal ring, and the antimeridian guard.** Of every ring in the feature, the one with the largest |shoelace area| is the **principal ring**. Rings whose bbox-centre longitude lies more than **60°** from the principal ring's bbox-centre longitude are excluded *from the bounding box*. This exists for Alaska: the western Aleutians sit near +172°E and would otherwise stretch the bbox across the entire Pacific and put every candidate point in open ocean. 60° keeps the Hawaiian chain (~5° span) intact. Excluded rings still count for **containment** — a point on an Aleutian island is still in Alaska.

3. **Sampling bbox.** Union bbox of the kept rings → `(minLon, minLat, maxLon, maxLat)`, centre `(cx, cy)`, width `w`, height `h`.

4. **The five candidates, in this fixed order and no other:**

   | idx | role | position |
   |---|---|---|
   | 0 | `C`  | `(cx,             cy            )` |
   | 1 | `NW` | `(cx − 0.25·w,    cy + 0.25·h   )` |
   | 2 | `NE` | `(cx + 0.25·w,    cy + 0.25·h   )` |
   | 3 | `SW` | `(cx − 0.25·w,    cy − 0.25·h   )` |
   | 4 | `SE` | `(cx + 0.25·w,    cy − 0.25·h   )` |

   ±0.25 of the bbox span puts the four quadrant points at the centres of the four bbox quadrants. It is the widest fixed spread that still leaves every point a quarter-span from an edge — wider and the quadrant points fall in the ocean for coastal states more often than not; narrower and five points collapse toward the centroid and stop being an areal average.

5. **Containment.** Even-odd ray casting over **all** rings of the feature (interior rings flip parity, which is what even-odd is for). Identical arithmetic to `src/pages/AtlasPage.tsx:83 pointInState`, already proven at interactive rates on this exact geometry.

6. **Repair — deterministic.** A candidate outside the polygon is replaced by the **first** inside point found on a fixed elliptical lattice anchored at the candidate:

   ```
   for r = 1 … 60:
     for k = 0 … 8r−1:   θ = 2πk / (8r)
       test ( x + r·0.02·w·cos θ ,  y + r·0.02·h·sin θ )
   ```

   Ring order, then bearing order, then first hit. No randomness, no nearest-distance tie-break, nothing that can reorder between runs or between machines.

7. **Terminal fallback.** If 60 rings find nothing, the point becomes the principal ring's vertex nearest the candidate, moved 2% of the way toward the principal ring's bbox centre, and is recorded as `resolution = "fallback"` so it can never be mistaken for a pattern point. **v1 uses this zero times.** The deepest repair anywhere in the roster is ring 24 of 60.

8. **Rounding.** Every resolved coordinate is rounded to 4 decimals (~11 m). That rounded value is what is stored, what is sent to the API, and what is hashed — float formatting can never drift the request URL.

9. **Scheme hash.** djb2 over `"state:idx:role:lon:lat"` for all 250 points in roster order — the same hash shape `registry.ts:137` uses for `layout_version`. Written on every archive row. **v1 = `587429395`.** The backfill hard-stops if the live hash ever differs from its checkpoint's; a mismatch is not a warning, it is the failure Ruling 3a describes.

---

## 3. What happens where the pattern lands on water or outside the polygon — honestly

**196 of 250 points (78.4%) land inside on the first try. 54 (21.6%) needed repair. 0 needed the fallback.**

The repairs are what you would expect from a rectangle pattern laid over non-rectangular states: coastal and river-bordered states (MD, FL, MI, HI, LA, AK's islands) push candidates into water or across a border; compact interior states (WY, CO, KS, NM) take all five unrepaired.

Two things must be said plainly rather than papered over.

**Water is not disqualifying here, and the containment test is not a land mask.** The variable is *mean-sea-level pressure*, a smooth synoptic field ERA5 defines everywhere on the globe, ocean included, at 0.25° (~28 km). A sample 5 km offshore of Ocean City reports the same weather system as one 5 km inland — MSL pressure has no coastline discontinuity the way 2 m temperature does. The containment test exists for a different reason: so that a point called "Maryland" is *inside Maryland*. It is a provenance constraint, not a physics one. Consequently the simplified TIGER polygons are **not** cut for inland water either — the Great Salt Lake, Lake Okeechobee, Michigan's share of the Great Lakes and Chesapeake Bay are all inside their state polygons and a point may land on them. For this variable that is immaterial. **For any future variable that is not MSL pressure — temperature, humidity, soil, snow — this scheme is not automatically fit for purpose and must be re-argued.**

**The polygon is simplified and the grid is coarse, in that order of magnitude.** The boundary is accurate to ~1.1 km; an ERA5 cell is ~28 km across. A point the simplified polygon accepts but the true border rejects is at worst ~4% of a grid cell from where it should be, and in nearly every case resolves to the same cell either way. The scheme does not pretend to sub-cell precision and no number derived from it should be read as if it did.

**The cell actually sampled is a second fact, and it is checked.** Open-Meteo answers from the nearest ERA5 grid-cell centre, up to ~0.125° from the requested point. `--verify-points` re-runs the containment test on the *snapped* coordinate. Measured on AK/HI/MD/TX (20 points): max snap shift **0.117°**, under one half-cell, and **0/20 snapped cells fell outside their own state**. Run it over the full roster (~18 weighted calls) before the real backfill and record the result here.

---

## 4. The frozen coordinates — v1

`† = repaired` (candidate fell outside the polygon; resolved by the rule in §2.6). These are the exact values sent to `archive-api.open-meteo.com`, and the exact contents of `era5_sampling_points` at `sampling_version = 1`.

| State | C (lon, lat) | NW | NE | SW | SE | repaired |
|---|---|---|---|---|---|---|
| **AL** Alabama | -86.68, 32.625 | -87.575, 33.8125 | -85.785, 33.8125 | -87.575, 31.4375 | -85.785, 31.4375 |  |
| **AK** Alaska | -159.445, 61.48 | -167.6414, 65.5085 † | -144.7175, 66.415 | -163.6747, 54.7526 † | -135.3373, 56.8546 † | 3 |
| **AZ** Arizona | -111.93, 34.17 | -113.375, 35.59 | -110.485, 35.59 | -113.375, 32.75 | -110.485, 32.75 |  |
| **AR** Arkansas | -92.175, 34.75 | -93.3975, 35.625 | -90.9525, 35.625 | -93.3975, 33.875 | -91.0217, 33.9245 † | 1 |
| **CA** California | -119.275, 37.275 | -121.8425, 39.6425 | -118.8094, 38.124 † | -121.2388, 35.6736 † | -116.7075, 34.9075 | 2 |
| **CO** Colorado | -105.55, 38.995 | -107.305, 39.9975 | -103.795, 39.9975 | -107.305, 37.9925 | -103.795, 37.9925 |  |
| **CT** Connecticut | -72.765, 41.52 | -73.2475, 41.785 | -72.2825, 41.785 | -73.2475, 41.255 | -72.253, 41.2942 † | 1 |
| **DE** Delaware | -75.42, 39.14 | -75.605, 39.485 | -75.4538, 39.316 † | -75.605, 38.795 | -75.235, 38.795 | 1 |
| **FL** Florida | -82.766, 28.06 † | -85.2245, 29.7913 † | -81.93, 29.53 | -82.4624, 27.1399 † | -81.93, 26.59 | 3 |
| **GA** Georgia | -83.25, 32.68 | -84.43, 33.84 | -82.3436, 33.7679 † | -84.43, 31.52 | -82.07, 31.52 | 1 |
| **HI** Hawaii | -156.5865, 20.8374 † | -158.1265, 21.41 † | -156.3506, 20.9251 † | -158.059, 21.3141 † | -155.9485, 19.77 † | 5 |
| **ID** Idaho | -114.145, 45.5 | -115.6925, 47.25 | -114.3636, 46.6011 † | -115.6925, 43.75 | -112.5975, 43.75 | 1 |
| **IL** Illinois | -89.505, 39.745 | -90.5075, 41.1275 | -88.5025, 41.1275 | -90.3471, 38.3625 † | -88.5025, 38.3625 | 1 |
| **IN** Indiana | -86.43, 39.775 | -87.245, 40.7675 | -85.615, 40.7675 | -87.245, 38.7825 | -85.615, 38.7825 |  |
| **IA** Iowa | -93.385, 41.94 | -95.0075, 42.72 | -91.7625, 42.72 | -95.0075, 41.16 | -91.7625, 41.16 |  |
| **KS** Kansas | -98.33, 38.495 | -100.19, 39.2475 | -96.47, 39.2475 | -100.19, 37.7425 | -96.47, 37.7425 |  |
| **KY** Kentucky | -85.695, 37.8 | -87.5575, 37.93 † | -83.8325, 38.45 | -87.5575, 37.15 | -83.8325, 37.15 | 1 |
| **LA** Louisiana | -91.5913, 31.0717 † | -92.78, 32.0175 | -91.005, 32.263 † | -92.78, 30.0125 | -90.26, 30.0125 | 2 |
| **ME** Maine | -69.03, 45.26 | -70.055, 46.36 | -68.005, 46.36 | -70.055, 44.16 | -67.9413, 44.415 † | 1 |
| **MD** Maryland | -77.0036, 38.815 † | -77.6833, 39.324 † | -76.16, 39.2675 | -77.2277, 38.3909 † | -76.16, 38.3625 | 3 |
| **MA** Massachusetts | -71.725, 42.195 | -72.6175, 42.5425 | -70.8325, 42.5425 | -72.4524, 42.0312 † | -70.8325, 41.8475 | 1 |
| **MI** Michigan | -86.1747, 44.5933 † | -88.4175, 46.55 | -84.4125, 46.4204 † | -86.3349, 43.31 † | -84.4125, 43.31 | 3 |
| **MN** Minnesota | -93.425, 46.44 | -95.3275, 47.91 | -91.5225, 47.91 | -95.3275, 44.97 | -92.4246, 44.532 † | 1 |
| **MS** Mississippi | -89.87, 32.59 | -90.755, 33.795 | -88.985, 33.795 | -90.755, 31.385 | -88.985, 31.385 |  |
| **MO** Missouri | -92.45, 38.31 | -94.11, 39.465 | -91.0556, 39.465 † | -94.11, 37.155 | -90.79, 37.155 | 1 |
| **MT** Montana | -110.045, 46.695 | -113.0475, 47.8475 | -107.0425, 47.8475 | -113.0475, 45.5425 | -107.0425, 45.5425 |  |
| **NE** Nebraska | -99.68, 41.5 | -101.865, 42.25 | -97.495, 42.25 | -101.865, 40.75 | -97.495, 40.75 |  |
| **NV** Nevada | -117.02, 38.5 | -118.51, 40.25 | -115.53, 40.25 | -117.7729, 37.4605 † | -115.53, 36.75 | 1 |
| **NH** New Hampshire | -71.62, 44 | -72.0227, 44.2951 † | -71.16, 44.65 | -72.08, 43.35 | -71.16, 43.35 | 1 |
| **NJ** New Jersey | -74.73, 40.175 | -75.1118, 40.7675 † | -74.315, 40.7675 | -75.145, 39.5825 | -74.315, 39.5825 | 1 |
| **NM** New Mexico | -106.025, 34.165 | -107.5375, 35.5825 | -104.5125, 35.5825 | -107.5375, 32.7475 | -104.5125, 32.7475 |  |
| **NY** New York | -75.93, 42.78 | -77.965, 43.367 † | -74.015, 43.9 | -77.7254, 42.0115 † | -74.015, 41.66 | 2 |
| **NC** North Carolina | -80.02, 35.22 | -82.17, 35.905 | -77.87, 35.905 | -80.7035, 34.8213 † | -77.87, 34.535 | 1 |
| **ND** North Dakota | -100.305, 47.465 | -102.1775, 48.2325 | -98.4325, 48.2325 | -102.1775, 46.6975 | -98.4325, 46.6975 |  |
| **OH** Ohio | -82.67, 40.2 | -83.745, 41.09 | -81.595, 41.09 | -83.745, 39.31 | -81.595, 39.31 |  |
| **OK** Oklahoma | -98.715, 35.32 | -99.8291, 36.16 † | -96.5725, 36.16 | -99.8379, 34.5326 † | -96.5725, 34.48 | 2 |
| **OR** Oregon | -120.505, 44.125 | -122.5275, 45.1925 | -118.4825, 45.1925 | -122.5275, 43.0575 | -118.4825, 43.0575 |  |
| **PA** Pennsylvania | -77.61, 40.995 | -79.065, 41.6325 | -76.155, 41.6325 | -79.065, 40.3575 | -76.155, 40.3575 |  |
| **RI** Rhode Island | -71.49, 41.67 | -71.675, 41.845 | -71.3479, 41.8559 † | -71.675, 41.495 | -71.305, 41.495 | 1 |
| **SC** South Carolina | -80.94, 33.615 | -82.14, 34.4075 | -79.74, 34.4075 | -81.571, 33.0586 † | -79.6721, 32.8673 † | 2 |
| **SD** South Dakota | -100.245, 44.215 | -102.1525, 45.0775 | -98.3375, 45.0775 | -102.1525, 43.3525 | -98.3375, 43.3525 |  |
| **TN** Tennessee | -85.995, 35.83 | -88.1525, 36.255 | -83.8375, 36.255 | -88.1525, 35.405 | -83.9696, 35.4678 † | 1 |
| **TX** Texas | -100.085, 31.195 | -102.8381, 33.8475 † | -96.8075, 33.8475 | -103.1589, 29.1574 † | -96.8075, 28.5425 | 2 |
| **UT** Utah | -111.545, 39.5 | -112.7975, 40.75 | -110.2925, 40.75 | -112.7975, 38.25 | -110.2925, 38.25 |  |
| **VT** Vermont | -72.465, 43.87 | -72.9525, 44.44 | -71.9775, 44.44 | -72.9525, 43.3 | -72.2115, 43.7739 † | 1 |
| **VA** Virginia | -79.455, 38 | -79.6467, 38.5047 † | -77.3475, 38.73 | -81.3939, 37.27 † | -77.3475, 37.27 | 2 |
| **WA** Washington | -120.815, 47.275 | -122.6523, 48.1863 † | -118.8675, 48.1375 | -122.7625, 46.4125 | -118.8675, 46.4125 | 1 |
| **WV** West Virginia | -80.17, 38.92 | -80.807, 39.78 † | -78.8685, 39.5101 † | -81.395, 38.06 | -79.2426, 38.4939 † | 3 |
| **WI** Wisconsin | -89.96, 44.725 | -91.425, 45.8425 | -88.495, 45.8425 | -91.1906, 43.6075 † | -88.495, 43.6075 | 1 |
| **WY** Wyoming | -107.55, 43 | -109.3, 44 | -105.8, 44 | -109.3, 42 | -105.8, 42 |  |

---

## 5. The call budget — read this before starting a long run

Open-Meteo counts a call as **locations × (days / 14) × max(1, variables / 10)**. Their words, from `open-meteo.com/en/pricing`:

> *"Requests for data covering more than 10 weather variables or extending over a period of more than 2 weeks for a single location are considered multiple API calls. To calculate the number of API calls accurately, fractional counts are used. For example, a request for 2 weeks of data with 15 weather variables will be calculated as 1.5 API calls, while 4 weeks of data equals 3.0 API calls."*

For the v1 scope (250 locations × 17,367 days × 3 variables):

| | |
|---|---|
| archive rows | **868,350** |
| location-days | **4,341,750** |
| **weighted Open-Meteo calls** | **~310,125** |
| free tier | 10,000/day · 300,000/month · 5,000/hour · 600/min |
| measured live-cron baseline | ~222/day weighted (~6,760/month) — see §6 |
| days at `DAILY_CALL_BUDGET=8000` | **39** |
| fraction of a **month's entire** free allowance | **1.03×** |

**The backfill does not fit in the free tier's monthly cap. Not slowly, not cleverly — the total is location-days and location-days are fixed by the scope.** Chunking changes nothing. Three variables cost nothing (the surcharge starts past ten), so `pressure_msl_min` and `_max` are free and are pulled.

Three ways out, none of which this script picks for you:

1. **Trickle on the free tier.** ~39 days at 8,000/day, straddling two calendar months, consuming essentially the whole account's Open-Meteo quota for August — which collides head-on with v1b's lattice (1,380–2,340/day from weeks 4–5). Finishes ~Sep 1. Works; costs the map its budget.
2. **One month of a paid key.** The Historical Weather API requires the **Professional** plan (the pricing table shows Standard as ❌ for historical). Professional is 5M calls/month; the backfill is **6.2%** of one month and completes in **~3.3 hours**. Set `OM_API_KEY` and the host switches to `customer-api.open-meteo.com` and the local budget check is skipped. This also buys the commercial-use licence the free tier withholds.
3. **Copernicus CDS directly — Ruling 10.5's own escape hatch.** *"ERA5 is Copernicus data and Open-Meteo's terms govern their API, not the underlying dataset — the archive may be sourceable from Copernicus directly under attribution, leaving only the live layer needing a paid key. That converts a recurring cost into an attribution line."* The CDS product `derived-era5-single-levels-daily-statistics` serves the same daily mean/min/max with no per-call quota and no non-commercial restriction. Same table, same sampling scheme, different faucet — it needs a CDS account, the `cdsapi` client, and NetCDF handling, so it is a day of work and a queue wait rather than a drop-in. **It is the right long-term answer and the only one that also fixes the licensing question.**

Also note the free tier is **non-commercial only** and the data is **CC-BY 4.0** — attribution is required on anything that ships. That constraint attaches to the *live* layer far more sharply than to a one-time backfill, but it attaches.

---

## 6. Measured Open-Meteo baseline (Ruling 10.5 gate)

Read from committed migrations and function source on 2026-07-25. **Ruling 10.5 makes this a gate on the v1b lattice, not a note.**

| Function | Endpoint | Locations/run | HTTP req/run | Runs/day | Location-calls/day |
|---|---|---|---|---|---|
| `hunt-weather-watchdog` | `api…/v1/forecast` | 10 | 1 | 5 | 50 |
| `hunt-air-quality` | `air-quality-api…` | 50 | 50 | 1 | 50 |
| `hunt-soil-monitor` | `api…/v1/forecast` | 50 | 50 | 1 | 50 |
| `hunt-river-discharge` | `flood-api…/v1/flood` | 50 | 50 | 1 | 50 |
| `hunt-alerts` | `api…/v1/forecast` | 50 | 1 | **0 — no cron exists** | 0 |
| `hunt-weather` | `api…/v1/forecast` | 1 | 1 | on-demand (1 h cache) | ~0 |
| | | | | **total** | **200 raw / ~222 weighted** |

- Only `hunt-weather-watchdog` crosses the 2-week line (`past_days=1&forecast_days=16` = 17 days), so it is the only weighted one: ~72–100/day rather than 50. No function exceeds 10 variables (max 9), so there is **zero** variable surcharge anywhere in the fleet.
- Effective schedules: watchdog `b1..b5` at 06:00/02/04/06/08 UTC (`20260352_batch_crons_timeout_fix.sql:10-90`, which unscheduled the old single job); river 05:00, soil 05:30, air-quality 06:15 (`20260390_schedule_new_environmental_crons.sql:6,22,38`). **None of the five was among the 13 crons killed on 07-11/07-17** — note `du-alerts` ≠ `hunt-alerts`.
- Headroom: **2.0% of daily, 2.0% of monthly, 2.4% of the worst hour** (06:00 UTC ≈ 122). Peaks at 05:00 (100) and 06:00 (~122); otherwise idle.
- Sizing the lattice on top: 1,760–2,540/day = **17.6–25.4%** of daily. Volume is not the binding constraint. The **hourly 5,000 / per-minute 600** ceilings are, if the lattice fires as a burst — and the **non-commercial licence** is, which no amount of headroom solves.

**One caveat that is not closeable from the repo:** every number above is derived from committed migrations, not from `SELECT * FROM cron.job`. A job created by hand in the SQL editor would not appear here. Verifying against the live `cron.job` table is the one step that closes this gate hard.

---

## 7. Wiring it to the board (a hand-off, not a decision)

`--emit-cache` writes `scripts/frames/.frame-cache/series-era5-XX.json` in the envelope `backfill-frames.ts` writes and reads:

```json
{ "endYear": 2026, "fields": { "pressure_msl_mean": { "1979-01-01": 1021.72, … }, "pressure_msl_min": {…}, "pressure_msl_max": {…}, "pressure_delta_24h": {…} } }
```

**The cache alone is inert.** For the board to carry these instruments, `scripts/frames/registry.ts` must gain 50 `era5-XX` instruments, and the APPEND-ONLY LAW (`registry.ts:96-102`) requires every one of them in `APPEND_ORDER`, after `needle-pna`, so no existing offset moves:

```ts
export const ERA5_METRICS: MetricDef[] = [
  { field: "pressure_delta_24h", direction: "two-sided", n_days: WINDOW_HALF, min_years: 10, label: "pressure change" },
];
// in buildInstruments(), after the needles:
for (const abbr of Object.keys(STATE_CENTROIDS)) {
  const c = STATE_CENTROIDS[abbr]; const p = project(c.lat, c.lng);
  out.push({ id: `era5-${abbr.toLowerCase()}`, kind: "state-pressure", label: c.name,
    sublabel: "pressure change", lane: "air-pressure", lat: c.lat, lng: c.lng,
    albers_x: p.x, albers_y: p.y, proj_version: PROJ_VERSION,
    source_ct: "era5-state-pressure", source_key: { state_abbr: abbr }, metrics: ERA5_METRICS });
}
const APPEND_ORDER: string[] = ["needle-pna", ...Object.keys(STATE_CENTROIDS).map(a => `era5-${a.toLowerCase()}`)];
```

**Three consequences the main session must rule on, which is why this patch is written here and not applied:**

1. `layout_version` changes (it hashes the manifest), so `backfill-frames.ts:310` and `bake-luts.ts:162` both hard-stop on checkpoint drift and demand a **full re-bake of all 27,964 `board_frames` rows**. Stored bytes at offsets 0–143 stay correct — appends go at the end — but the version stamped on every existing row does not.
2. Slots go 144 → 244. Frames grow 144 → 244 B/day; a 60-day replay goes 8.4 KB → 14.3 KB, still far under the 200 KB payload check.
3. `n_days` must come from the **unified window constant** (Ruling 1 / PLAN §2.1). `registry.ts:17` says 10 and `scripts/mine/mine.ts:90` says 15 for the same concept; that disagreement invalidated an entire analysis once. Do not add a 51st consumer of an unresolved constant — resolve it first.

**Also found while reading that machinery, unrelated to ERA5 and worth its own fix:** `bake-luts.ts:79` reads the cache with the *old* bare shape (`Record<field, Record<date, value>>`) while `backfill-frames.ts:203` writes the `{endYear, fields}` envelope, which every file on disk now carries. `loadCachedSeries` therefore returns a map keyed `endYear`/`fields` and `.get(job.field)!` is `undefined` — `bake-luts.ts` crashes against its own cache today. It fails loudly rather than silently, but it fails.

---

## 8. Provenance carried per row

| Column | Value |
|---|---|
| `source` | `ERA5 (0.25°) via Open-Meteo archive-api, 5-point state mean` |
| `source_url` | the exact request, coordinates included |
| `source_event_id` | `era5-pressure:v{sampling_version}:{STATE}:{YYYY-MM-DD}` — unique-indexed |
| `sampling_version` | `1` (part of the primary key) |
| `scheme_hash` | `587429395` |
| `n_points` | how many of the five reported |
| `spread_hpa` | max−min across the five points' daily means — the receipt for the word *statewide* |

Measured on Maryland 1979: spread runs **median 1.1 hPa, p90 2.3, max 5.2**, with all five points reporting on 365/365 days. Five cells describing one weather system — which is the condition under which "statewide" is a fair word rather than an average of two different storms.
