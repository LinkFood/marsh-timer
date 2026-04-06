---
name: Ocean/Coastal Data Pipe Designs (7 Pipes, ~5.5M New Entries)
description: Full design specs for 7 ocean/coastal data pipes. Pipe 1 = NOAA CO-OPS verified water levels + residuals (2.5-3M entries, THE MONSTER). Pipe 2 = ERSST v5 global SST 1854-present (163K). Pipe 3 = NDBC deep buoy history 1970-present 150 stations (2.2M). Pipe 4 = Coral Reef Watch satellite SST + DHW (62K). Pipe 5 = storm surge derived from CO-OPS + HURDAT2 (5-10K). Pipe 6 = PSMSL 150-year sea level records (47K). Pipe 7 = Tsunami/DART wildcard (110K). Priority order: 1a/1c > 3 > 2 > 6 > 4 > 5 > 7. Total ~5.5M entries would triple brain from 3.2M to ~8.5M. Key insight: tide RESIDUAL (observed minus predicted) is the pure meteorological signal — the prediction is astronomy, the residual is weather. Generated 2026-04-03.
type: project
---

## Existing Ocean State
- `ocean-buoy`: 36K entries, 27 NDBC stations, 2021-2025, daily SST/waves/pressure/wind. Running cron.
- `noaa-tide`: backfill script for 223 stations, 2021-2026, weekly hi/lo PREDICTIONS only. NOT in orchestrator. NOT a cron.
- Convergence engine Tide domain (weight 10) pulls from noaa-tide.
- GAPS: No verified observations, no residuals, no SST history, no storm surge, no coral watch, no sea level trends, buoys only 5 years.

## 7 Pipes Designed
1. **NOAA CO-OPS Verified Water Levels** — daily_mean + residual (observed - predicted). 223 stations, back to 1920+ for some. ~2.5-3M entries. content_types: noaa-water-level-daily, noaa-water-level-monthly, noaa-tide-residual (or combined).
2. **ERSST v5** — Monthly global SST 1854-present. Extract ~70 US-adjacent grid cells + climate index regions via ERDDAP. ~163K entries.
3. **NDBC Deep History** — Extend existing buoy from 27 stations/5 years to 150+ stations/50+ years. Add wave direction, period, air-sea temp diff. ~2.2M entries.
4. **Coral Reef Watch** — Satellite SST, anomaly, DHW, bleaching alerts. Weekly summaries per 30 coastal zones. ~62K entries.
5. **Storm Surge Derived** — Cross-reference HURDAT2 hurricane tracks with CO-OPS water levels during storm windows. ~5-10K entries. Depends on Pipe 1.
6. **PSMSL Sea Level** — 30 longest US records (100-170 years), monthly. Computed trends, acceleration, deviation. ~47K entries.
7. **Tsunami/DART** — Historical events + deep-ocean pressure buoys. ~110K entries. Wildcard.

## Priority Order
1a/1c > 3 > 2 > 6 > 4 > 5 > 7

## Key APIs
- CO-OPS: `api.tidesandcurrents.noaa.gov/api/prod/datagetter` — no auth, max 31 days/request, 1 req/sec
- NDBC: `ndbc.noaa.gov/data/historical/stdmet/{station}h{year}.txt.gz` — no auth, ~1 req/sec
- ERSST: `coastwatch.pfeg.noaa.gov/erddap/griddap/nceiErsstv5.json` — no auth, batch by decade
- CRW: `coastwatch.pfeg.noaa.gov/erddap/griddap/NOAA_DHW.json` — no auth
- PSMSL: `psmsl.org/data/obtaining/rlr.monthly.data/` — bulk download, no auth
- HURDAT2: `nhc.noaa.gov/data/` — CSV download

## Narrative Examples (saved for builder reference)
- Katrina surge at Pilot Station LA: 7.2ft daily mean, +4.1ft above 30-day avg
- Superstorm Sandy: Battery NYC residual +9.4ft
- 1978 Blizzard: Battery surge 9.8ft
- 1900 Galveston: PSMSL shows 150mm sea level JUMP — island subsided
- Florida 2023 bleaching: DHW 14.2, 3.5x threshold
- Tohoku tsunami: DART 46402 detected wave 10 hours before Crescent City arrival
