# CAN THE HORSE RIDE — THE SCORECARD

**The test:** 5 famous dates. 49 archive claims web-verified against primary sources (NCEI bulk CSVs, raw NDBC files, USGS ComCat, NOAA CO-OPS API, GHCN-Daily raw).
**The tally: 30 MATCHES, 11 CLOSE, 4 UNVERIFIABLE, 4 CONTRADICTS.**

---

## 1. THE SCORECARD

### KATRINA — 2005-08-29 — 8 MATCHES / 3 CLOSE / 2 UNVERIFIABLE / 0 CONTRADICTS
**What it saw:** The full instrumental symphony — 168 county storm-event rows, both Gulf buoys, the Pensacola surge curve, GHCN rain + station dropout, the FL first landfall, the daily build arc 0→3→4→21→53→168.
**Money quote:** The archive said buoy 42040 hit **55.5 ft waves and a 69.6 kt gust** on landfall day with a cold wake of 87.4°F→83.1°F. The raw NDBC file reproduces every value exactly — and NWS confirms those 55-ft seas matched the largest significant wave height an NDBC buoy has ever measured. All 21 Pensacola tide residuals recomputed from the CO-OPS API within ±0.01 ft. All five county death rows (Orleans 638, Harrison 97, Hancock 56, Jackson 13, Jones 10) match NCEI to the dollar — including correctly booking the catastrophic rows to the 08-28 trap date.
**Drift:** Storm-event counts run 15-25% below the current NCEI file; missing the Storm Surge/Tide event type entirely.

### SANDY — 2012-10-29 — 8 MATCHES / 3 CLOSE / 0 CONTRADICTS
**What it saw:** The rain bomb (NJ max 8.9 in), the WV blizzard flank, the FL→NC approach track, the 5-day monotonic tide ramp at every mid-Atlantic gauge, and it correctly diagnosed the 1,655-row 11-01 "spike" as a drought rollup, not aftermath. Even caught the Snowtober-2011 rhyme.
**Money quote:** The archive said the **M7.8 Haida Gwaii quake of 10-28 is absent (US-only ingest)** while listing 5 small US quakes — USGS confirms all five to the decimal AND confirms the missing M7.8 triggered a Hawaii tsunami warning with ~100,000 evacuated. The archive knew exactly what it didn't know.
**Drift:** Landfall pressure 946 vs 945 mb; "duplicate pairs" are actually triplicates for some rows — which corrupts every row count.

### URI — 2021-02-15 — 5 MATCHES / 1 CLOSE / **1 CONTRADICTS**
**What it saw:** The freeze, decimal-exact. The V-shaped fore/aft arc, the continental scope, the Galveston wind setdown, verbatim NCEI wind-chill narratives.
**Money quote:** The archive said **TX statewide avg high 21.4°F / low 6.2°F / min -19°F across 432 stations**. Recomputed from NOAA's raw GHCN-Daily by-year file: 21.4 / 6.2 / -18.9 (Lipscomb, TX Panhandle). Decimal-exact, station count within one.
**The lie:** Its storm-event layer holds **93 of the real 665** TX rows for the window, claims the events ended Feb-17 (63 real rows run through Feb-20), and zeroes every casualty field while the live NCEI file carries 131 TX deaths and $277M. A 246-death disaster rendered as a clean temperature curve.

### SEPT 11 — 2001-09-11 — 5 MATCHES / 2 CLOSE / 2 UNVERIFIABLE / **1 CONTRADICTS**
**What it saw:** The right story — the environment was a routine post-frontal day and the only signal was human. The 9/10 cold front, the severe-clear setup, the onthisday aftermath week (air traffic 9/13, prayer service 9/14, NYSE 9/17, anthrax 9/18) all dead-on. Even flagged the morning-obs precip-booking subtlety and the ML 2.1/2.3 WTC collapse seismics correctly.
**Money quote:** The archive said buoy 44025 off Long Island ran **13.9 kt avg / 21.2 kt gust / 4.7 ft avg / 5.7 ft max waves** — recomputed from the raw NDBC hourly file: exact to every decimal.
**The lie:** "The only US storm-events that day were 4 Carolinas cells." Real NCEI count: 10. The archive's type filter silently dropped waterspouts, a funnel cloud, an Alaska high wind — and a Delaware rip current driven by the Cat-3 hurricane it never noticed (see Blind Spots).

### RIDGECREST — 2019-07-05 — 4 MATCHES / 2 CLOSE / **2 CONTRADICTS**
**What it saw:** Two small quakes, a cool pleasant Friday, flat tides — and then nothing, forever. Zero rows for the largest California earthquake in 20 years and its 1,918 aftershocks. To its credit, its self-audit (0 M7 rows in the entire corpus, only 10 unique M6 events, Landers/Northridge/Hector Mine/Napa all missing) verified 100% real.
**Money quote (dark version):** Every digit of the two events it DOES hold is a perfect ComCat copy — coordinates, depths, felt counts exact. The horse's eyes work perfectly. It just wasn't looking.
**The lie:** It called those two events "the immediate foreshocks, ~30 minutes before the M6.4." ComCat origin times: **5 and 10 minutes AFTER the M6.4.** They're aftershocks of a mainshock the archive doesn't know exists. The archive didn't just miss the story — it inverted it, presenting the first seconds of the aftermath as the omen.

---

## 2. CONTRADICTIONS — WHERE THE ARCHIVE WAS FLAT WRONG

1. **Ridgecrest "foreshocks" are aftershocks.** The archive stores only dates, not origin times, then inferred sequence roles from date order. FIX: store `event_time` (UTC) on every earthquake-event row and never let a reading claim fore/aft within a day without it. Re-ingest ComCat with timestamps.

2. **Uri storm-events: 14% of the record, false ending, zeroed deaths.** 93 of 665 rows; "none after Feb-17" is false; deaths:0 everywhere while upstream NCEI carries 131 deaths / $277M for the same window. FIX: re-ingest NCEI from current bulk CSVs with no per-day cap, and schedule re-pulls of recent years — NCEI backfills casualty data months late, so early snapshots go stale.

3. **9/11 "only 4 US storm-events" — real count 10.** The ingest keeps tornado/hail/t-storm-wind and silently drops other types. FIX: ingest ALL NCEI event types (this same filter is why Sandy's date has zero Hurricane/High Wind/Storm Surge rows).

4. **Duplication is worse than self-reported.** Katrina/9/11/Ridgecrest quakes duplicated 2x; Sandy storm-events found in TRIPLICATE on live re-query — every row count in the archive is inflated by an unknown multiple. (And one "duplicate" — Cass County IN — turned out to be two genuinely distinct NCEI events, so title-based dedup is wrong in both directions.) FIX: dedup on NCEI `event_id` / USGS event ID, unique-constraint the ingest.

5. **Katrina pressure misdiagnosis.** The archive said the pressure signature "doesn't exist here" as if it were a source gap. The raw NDBC file carries BAR the whole time (bottoming 979.3 mb at 42040). FIX: the buoy ingest drops the pressure column — add it. One-line fix, recovers a whole physical dimension.

6. **9/11 interpretive miss: Hurricane Erin.** The archive credited its buoy's wave doubling to "post-frontal flow." The raw file shows 12.5-14.3 s swell from the ESE while wind blew NW — that's Cat-3 hurricane swell from Erin, 500 miles offshore, unmentioned anywhere in the archive's read. Lesson for the product: the map must show raw directional/period data, not narrative glosses.

---

## 3. BLIND SPOTS — THE NEXT INGEST LIST, RANKED

1. **The earthquake magnitude inversion (worst bug in the corpus).** 45,378 M3 rows, 20 M6 rows, ZERO M7 rows ever. The ingest pattern (per-day cap + ordering) systematically keeps small events and drops big ones and high-volume days — the exact opposite of what a "days like today" product needs. Re-ingest ComCat fully; if anything must be capped, cap ascending by magnitude, never descending.

2. **Storm-event re-ingest: all types, all rows, casualties intact, current file versions.** Fixes the Sandy NY/CT hole (real NCEI has 82 NY events incl. Storm Surge/Tide with $17M+ damage, and NJ's ~$24.96B that this archive recorded as '0K'), the Uri 7x undercount, and the 9/11 type filter in one job. Also: parse `property_damage` text ('750M', '8K') to numeric at ingest — it currently can't be sorted or summed.

3. **Tide-gauge roster + daily-max residual.** No NY/NJ/CT gauge (Sandy's record 9.40-ft Battery surge exists here as a 2.68-ft ripple at Newport), no LA/MS/AL gauge (Katrina's 27.8-ft record surge exists as 3.47 ft at Pensacola). And daily-MEAN residuals structurally cannot show surge peaks even where gauges exist. Add Battery/Sandy Hook/Kings Point/New London/Grand Isle/Bay Waveland/Dauphin Island; store daily max residual alongside mean.

4. **Barometric pressure — currently zero, anywhere.** Katrina's 902 mb, Sandy's 945 mb, Uri's Arctic high: none recorded. Half comes free with fix #5 above (buoy BAR column); the rest needs a station-pressure source.

5. **The human-impact layer is a single Wikipedia sentence.** nws-alert doesn't reach before ~2026, historical-newspaper is empty at every probe (2005, 1927, 1900, 1935), onthisday is one row per date and skipped Uri entirely for a Congo boat. Every disaster's death toll lives outside the metadata. Backfill NWS alert archive (reaches to ~1986 via IEM), decide whether historical-newspaper is real or dead weight.

6. **Aftermath silence.** NCEI logs event windows, not consequences: zero LA/MS rows for the week New Orleans was underwater. The instruments partially cover this (cold wake, station dropout, residual decay) — surface those as first-class aftermath signals in the product, because the event layer will always go dark exactly when the story peaks.

7. **GHCN is state-aggregate only, no wind/sky/visibility.** City-level readings unrecoverable; "severe clear" only inferable. Station-level GHCN for at least the top-200 metro stations would transform date reads.

8. **US-only quakes, no infrastructure/outage layer.** Haida Gwaii M7.8 invisible; ERCOT collapse invisible. Lower priority — know the boundary and label it.

---

## 4. THE RIDE VERDICT

The horse rides — on instruments. Anything this archive actually holds is startlingly true: 30 of 49 claims matched primary sources exactly, most to the decimal, several recomputed from raw NDBC/GHCN/CO-OPS files, and only 4 contradicted. Rarer and more valuable: the archive is honest about itself — every self-declared blind spot verified real, and it correctly refused bait like the 11-01 drought rollup. But it limps in one specific leg, and it's the leg the product stands on: every one of the five dates, the archive nailed the weather and missed the catastrophe — the surge, the 65-of-72 deaths in its three-state gauge hole, the 246-death freeze rendered as deaths:0, the M7.1 that simply never happened — and twice it crossed from missing into WRONG (inverted foreshocks, false "only"s), which for a fact-only map is the mortal sin. The single fix that raises the score most: **kill the capped/type-filtered ingest pattern and re-pull NCEI Storm Events + USGS ComCat from current bulk files — uncapped, all types, casualty fields intact, timestamps stored, deduped on source event IDs.** That one sprint erases 3 of 4 contradictions and blind spots 1, 2, and half of 6. Until then, one product law derived directly from this test: the map may say "the archive holds N" — it may never say "there were only N."

## Per-date tallies
- Hurricane Katrina landfall: 8 MATCH / 3 CLOSE / 0 CONTRADICT
- Superstorm Sandy landfall: 8 MATCH / 3 CLOSE / 0 CONTRADICT
- Texas freeze / Winter Storm Uri: 5 MATCH / 1 CLOSE / 1 CONTRADICT
- September 11 attacks: 5 MATCH / 2 CLOSE / 1 CONTRADICT
- Ridgecrest M7.1 earthquake: 4 MATCH / 2 CLOSE / 2 CONTRADICT
