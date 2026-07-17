# VALIDATED LEADS REGISTRY — Formation Layer v2 (backtested 2026-07-17)

> James's order: "actual triggers being live, weather-based on everything we know today… back test everything." Method = the court's validated retrodiction pattern (docs/COURT-POSITIVE-CONTROL-REPAIR-2026-07-16.md). Honesty bars frozen before any run: named mechanism or not a candidate; n_fires ≥ 30; WORTHY = lift ≥ 1.5 at base ≤ 0.5. Every candidate printed, worthy or not — no silent drops. 7 agents, ~408k tokens, all numbers from real archive queries.

## Every lead tested

| # | Lead | Mechanism | n_fires | hit | base | lift | med lead | verdict |
|---|---|---|---|---|---|---|---|---|
| B1 | 2-day AQI ramp into the 100s → AQI ≥ 150 | smoke advection / stagnation PM2.5 loading | 353 | 6.2% | 0.9% | **7.0** | 1–2d | **WORTHY** |
| A2 | 3-day antecedent precip ≥ state-month p90 → flood | saturated soil + full channels → runoff | 29,070 | 24.7% | 12.8% | **1.93** | 1–2d | **WORTHY** (18/18 states ≥ 1.5) |
| C1 | drought-class expansion → wildfire (30d) | fuel desiccation → lower ignition threshold | 161 | 47.8% | 29.3% | **1.63** | ~7d+ | **WORTHY (marginal, scoped MT/WA/ID/OR + NM watch)** |
| A3 | saturated topsoil p90 → flood | runoff amplifier | 7,429 | 19.9% | 15.4% | 1.29 | 1d | UNWORTHY standalone (context chip) |
| A1 | elevated river discharge → flood | reduced channel capacity | 6,321 | 18.7% | 15.1% | 1.23 | 1d | UNWORTHY standalone (context chip) |
| C2 | flash-drought intensification → heat | energy-balance shift | 534–1,114 | ~11–13% | 10.7% | ≤1.2 (month-matched <1.0) | UNWORTHY — dead, inverse dose-response |
| D1 | buoy pressure drop → coastal severe | frontal passage | 3,153 | 20.8% | 26.6% | **0.78** | — | UNWORTHY — ANTI-predicts; same concurrent-not-leading family as the retired overcast benchmark |
| D2 | tide surge residual → coastal flood | surge piling | 0 | — | — | — | — | NO-DATA: tide fire lanes dead since 03–06/2026; also retire/repair never-fired court benchmark `tide-surge-coastal-flood` |
| B2 | upwind wildfire + AQI rise (attribution) | smoke source | not run | — | — | — | — | NOT BACKTESTED — perimeter/fire-activity crons dormant |

Existing validated lead (already registered): **watch→warning flood escalation, 82% vs 28% base, 13 scoped states** — the court's own positive control.

## The three to ship first

1. **B1 — strict AQI ramp** (lift 7.0, live today, zero new ingest). Trigger: per state, max_aqi rise ≥ +15/day two consecutive days AND day-D max in [100,150). The strict band is load-bearing — "forming" never renders on already-arrived smoke (119/472 loose-spec fires were persistence contamination). Copy: multiplier-led, absolute odds stated ("about 7× the everyday odds; absolute odds stay low"). **Scope: all states EXCEPT MD** until its chronic-≥150 feed outlier (9.2% vs <1% elsewhere) is audited. Confounds to harden at first court review: fire-season month-matched base; **fix the air-quality ingest idempotency bug (~45% duplicate state-day rows) before live firing**.
2. **C1 — drought expansion → wildfire, scoped hard** (the only weeks-scale leg — the doctrine's "drought = weeks-months" calibration made real). Trigger: weekly, (D2+D3+D4)% ≥ 20 AND deepening, MT/WA/ID/OR only, NM watch-tier; AZ/NV hard-excluded (lift 0.73/0.00), TX/CO/CA excluded (outcome-saturated). Copy must carry the seasonality line (about a third of the lift is fire-season timing; month-matched lift 1.39). Grades settle quarter-late on NCEI — register anyway, mark pending-settlement, swap to Red Flag/perimeter outcome lanes when revived.
3. **A2 — antecedent precip → flood.** **CORRECTION TO THE BACKTEST'S BLOCKER (verified live 2026-07-17): the live lane already exists** — `hunt_weather_history.precipitation_total_mm`, daily per state, cron-fed current through yesterday. No ingest job needed; recompute the p90 thresholds on THIS field (the A3 lesson: archive thresholds don't transfer across fields) and fire. Direct answer to "we should have seen the rivers rising." Confound on record: part of the lift is storm-system persistence — mechanism still real; harden with next-day-precip-conditioned controls at first review.

## Missing lanes worth ingesting (lead each unlocks)

| Lane fix | Effort | Unlocks |
|---|---|---|
| ~~Live daily precip~~ — **exists** (hunt_weather_history.precipitation_total_mm) | none | A2 now; A2×A3 conjunction later (pre-register fresh — its both-conditions backtest hint: lift 2.34) |
| hunt-nws-monitor EVENT_BATCHES expansion (index.ts:12-17): add Heat, Red Flag/Fire Weather, Severe Tstm/Tornado, Coastal Flood/Surge | small, config-shaped | the whole watch→warning family (court-validated method) for heat/fire/severe/coastal + a live wildfire outcome lane for C1 |
| Revive wildfire-perimeter + fire-activity crons (dormant 2025-10 / 2026-03) | medium | B2 smoke source-attribution — B1 currently fires blind to the fire |
| Revive tide/pressure-tendency crons (dead 03–06/2026) | medium | D2 retrodiction against the 755k-row tide history + repairs the never-fired court benchmark |
| air-quality ingest idempotency (45% dupes) | small | B1 hygiene |

## Dead ends on the record — do not revisit as triggers

D1 raw pressure-drop (well-powered anti-predictor, n=3,153), C2 flash-drought→heat (month-matched ≤ 1.0), A1/A3 standalone (state-centroid granularity can't resolve formation — context chips only).
