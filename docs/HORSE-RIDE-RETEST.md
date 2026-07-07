# CAN THE HORSE RIDE — THE RETEST

**The test:** Same 5 famous dates, re-run after the re-ingest sprint (ComCat 95 M7s + timestamps, NCEI 2.03M rows all types with casualties, tide roster + daily-max residual, buoy pressure, supersede + filters). 44 claims web-verified against the same primary sources (NCEI bulk CSVs, raw NDBC files, USGS FDSN, NOAA CO-OPS API, ACIS/GHCN).
**Baseline (Saturday):** 30 MATCHES / 11 CLOSE / 4 UNVERIFIABLE / 4 CONTRADICTS — "nails the weather, misses the catastrophe."
**Retest: 29 MATCHES / 11 CLOSE / 0 UNVERIFIABLE / 4 CONTRADICTS.**

---

## 1. THE HEADLINE

| Date | Baseline | Retest | What changed |
|------|----------|--------|--------------|
| Katrina 2005-08-29 | 8M / 3C / 2U / 0X | **6M / 4C / 0X** | Buoy pressure, Storm Surge/Tide type, surge-gauge residuals, casualty ledger — ALL new, all verified. Grade A- |
| Sandy 2012-10-29 | 8M / 3C / 0X | **2M / 3C / 2X** | Empty claim payload + 2x storm-event duplication. Data that arrived is exact; the handoff failed |
| Uri 2021-02-15 | 5M / 1C / **1X** | **12M / 2C / 0X** | The baseline's worst lie (93 rows, deaths:0) fully erased. Grade A- |
| Sept 11 2001-09-11 | 5M / 2C / 2U / **1X** | **5M / 2C / 1X** | Empty claim payload; direct spot-checks near-perfect across 7 domains |
| Ridgecrest 2019-07-05 | 4M / 2C / **2X** | **4M / 0C / 1X** | M6.4 + M7.1 + ~30 aftershocks now present, timestamped, exact. Extractor returned {} anyway |

**Is TRUTH TEST passing? No — 4 CONTRADICTS remain. But read them: not one is the archive lying about the world.** Three are the claim-extraction harness delivering an empty payload (`{}`) for Sandy, Sept 11, and Ridgecrest while the archive sat there holding 995, 152, and ~32 correct rows respectively. One is real re-ingest damage (Sandy 2012 storm-events duplicated ~2x). Every baseline contradiction class — inverted Ridgecrest foreshocks, Uri's zeroed deaths, the 9/11 type filter, missing buoy pressure — is **verifiably dead**. The archive passed the truth test; the pipe that speaks for it did not.

---

## 2. REMAINING CONTRADICTS + NOTABLE MISSES — WITH FIXES

1. **Claim extractor returns `{}` on 3 of 5 dates (Sandy, Sept 11, Ridgecrest).** Root cause proven on Ridgecrest: extractor keys `effective_date = 2019-07-05`, but the archive correctly files events in UTC — the M7.1 lives under 07-06 (03:19:53Z = 8:19pm PDT on the 5th) and the M6.4 under 07-04. A strict same-day filter returns nothing for the most famous California quake in 20 years. FIX: window every event lookup ±1 day (or convert local→UTC before filtering), and make an empty claim set a **hard pipeline error**, never a vacuous pass. This exact failure recurs for every evening-local event near a UTC boundary.

2. **Sandy 2012 storm-events duplicated ~2x.** Archive holds 857 rows for 10-29 vs NCEI's 601 begin-date events; Harlan KY Heavy Snow appears 6x vs 3 real event IDs. The supersede pass that made Uri's 665 rows perfectly unique did not cover d2012. Same disease on 2001: 4 of 10 storm events stored under two competing title schemas, quakes stored 2-3x across `earthquake-event` and `-v2`. FIX: run the source_event_id dedupe across ALL re-ingested years, and retire (or hard-filter) the legacy v1 layers so precedent queries can't double-count.

3. **The silent datum trap.** Tide daily maxima are on STND station datum, nowhere labeled: Grand Isle "11.55 ft" reads as surge but is 5.20 ft MLLW (~6.3 ft silent offset); Battery's "peak 14.67 ft" is STND while the famous record is 14.06 ft **MLLW**. FIX: store the datum on every tide row and convert/display MLLW.

4. **UTC day-binning clips event peaks.** Sandy's record crest (01:24 UTC Oct-30 = 9:24pm EDT Oct-29) falls in the Oct-30 bin, so the landfall-day row understates the benchmark event by ~2.7 ft, and there's no landfall-fix row at all (Brigantine, 945 mb, 70 kt). FIX: store event-window extremes alongside UTC-day stats; ingest NHC best-track landfall fixes.

5. **The v2 quake layer is geographically leaky, not just magnitude-floored.** Uri window: USGS shows 7 US-area M4.5+ events, v2 holds 5 — the missing two are M5.1/M4.9 off Oregon. A layer missing M4.9+ events can't be trusted at any magnitude. FIX: audit ingest geo-bounds vs USGS US-region definition. Also: Antelope Valley WY "quake" is a USGS-classified mining explosion.

6. **Katrina's death toll mirrors a number NOAA retracted.** NCEI's in-archive 1,010 direct deaths (Orleans 638) EXCEED the current NHC reanalysis (~520 direct of ~1,400 total, Rappaport 2014/2016) by ~2x — two NOAA products disagree by a factor of two and the archive carries the stale one without a flag. FIX: reanalysis overlay row + caveat, not a rewrite of the NCEI record.

7. **Small drifts to log, not fix sprints:** buoy 42040's row title invents "Luke Island MS" (real name: Luke Offshore Test Platform); Grand Isle transmitted 2h into 09-04 before dying; Bay Waveland data resumes 11-11 not 11-16; GHCN morning-ob shift still credits Sept-10 rain to 9/11 (Central Park: 0.00" on the severe-clear day).

---

## 3. THE MONEY QUOTES — NEWLY TRUE, VERIFIED AGAINST RECORD

- **Katrina's pressure signature exists now.** Baseline: "doesn't exist here." Retest: buoy 42040 bottomed **979.3 mb at 10:00Z on landfall day, 69.6 kt gust, 55.5 ft max seas** — every value exact to the decimal against the raw NDBC file. 42001's full 5-day pressure arc (1008.5 → 981.3 → 1004.2) reproduces hour-for-hour.
- **The catastrophe has a ledger.** Storm Surge/Tide — the event type the baseline archive didn't have — now carries 31 rows: **Orleans $17.9B, Harrison $5.63B, Hancock $3.38B, LA+MS surge $42.563B across 13 rows, exact to the dollar** against the current NCEI file, with every CST→UTC conversion correct. Window deaths 1,010, county by county, event ID by event ID.
- **The surge itself, recomputed.** Grand Isle residual **+3.76 ft at 09:00Z**, Dauphin Island **+5.37 ft at 17:00Z** — all 13 claimed daily residuals reproduce from CO-OPS hourly-minus-predictions to 0.01 ft. And Bay Waveland's zero rows Aug-Sep verify as the gauge the storm destroyed.
- **Uri's dead are back on the books.** Baseline: 93 of 665 rows, deaths:0. Retest: **665 rows / 131 deaths (83 direct, 48 indirect) / 103 injuries / $736,788,420 — exact to the dollar**, zero duplicate event IDs. The deadliest row (Inland Harris, 40 deaths), the I-35W pileup (101 injuries), the $308M Hidalgo freeze — every spot-checked ID matches NCEI on type, zone, casualties, and timezone math. GHCN still decimal-exact (21.4°F / 6.2°F / -19°F / 432 stations), and the new buoy layer matches to 0.1 mb and 0.1°F across three stations and 13 days, including Viola's 02-17 pressure dip and the 7.8°F cold wake.
- **Ridgecrest exists.** Baseline: archive inverted aftershocks into foreshocks. Retest: **M6.4 (2019-07-04 17:33:49Z), M7.1 (07-06 03:19:53Z), M5.4 Searles Valley, both M5.5/M5.4 Little Lake aftershocks — 5/5 spot-checks exact vs USGS to the second**, sequence in correct order, ~30 M4.5+ aftershocks present.
- **The Battery, to the hundredth.** 9/11: mean 5.83 ft, peak 7.85 ft, residual -0.40 ft, residual peak -0.02 ft at 15:00Z — all four exact. Sandy: mean 9.93 ft, hourly max 14.67 ft, peak residual 7.42 ft — exact. And the seismic rows now correctly type four mining blasts as **explosions**, not earthquakes.
- **The self-audit is honest.** The archive flagged its own Galveston gap in the v2 tide roster; CO-OPS confirms the source data is complete, so the flag correctly blames the ingest — and the v1 fallback numbers it offered were right to 0.01 ft.

---

## 4. WHAT THE ARCHIVE STILL CAN'T SEE

Two kinds of blindness remain, and they should never be confused again. **Fixable with ingest:** the consequence layer — TPWD's 3.8M-fish freeze kill and 12,000 cold-stunned turtles that would turn Uri's buoy cold-wake from inference into fact-chain; the ERCOT/grid collapse; NHC TCR reanalysis numbers so death tolls don't mirror retracted figures; NHC best-track landfall fixes so Sandy's defining moment isn't just county impact rows plus one Wikipedia sentence; LDEO's WTC collapse seismics (ML 2.1/2.3), which live outside the FDSN feed; and station-level sky/visibility so "severe clear" is a reading, not a deduction. **Structural, accept and label:** NCEI books event windows, not aftermaths — LA/MS goes to zero rows the week New Orleans is underwater, and no re-ingest fixes that; the instruments (residual decay, station dropout, cold wake) are the aftermath signal and the product must surface them as such. The retest's real lesson sits above both lists: the archive is now more truthful than the pipeline that queries it — three of five dates returned empty claim sets off a one-day UTC filter while perfect data sat in the table. The horse's legs are fixed. The reins are the bug.

## Per-date tallies (retest)
- Hurricane Katrina landfall: 6 MATCH / 4 CLOSE / 0 CONTRADICT
- Superstorm Sandy landfall: 2 MATCH / 3 CLOSE / 2 CONTRADICT (1 = empty payload, 1 = dupe rows)
- Texas freeze / Winter Storm Uri: 12 MATCH / 2 CLOSE / 0 CONTRADICT
- September 11 attacks: 5 MATCH / 2 CLOSE / 1 CONTRADICT (empty payload)
- Ridgecrest M7.1 earthquake: 4 MATCH / 0 CLOSE / 1 CONTRADICT (empty payload)
