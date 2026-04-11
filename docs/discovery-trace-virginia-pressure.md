# Discovery Trace: "Virginia Pressure Surge 10x Normal Range Halts Spring Bird Migration"

> **Date of discovery:** 2026-04-09
> **Trace performed:** 2026-04-10
> **Verdict: The discovery is built on a unit conversion bug. The headline claim is false.**

---

## Layer 1: The Discovery Entry

**Table:** `hunt_knowledge`
**ID:** `cef97fe3-2217-480c-88f1-e7c49b8ae44e`
**Content type:** `daily-discovery`
**Created:** 2026-04-09T11:00:12Z
**State:** VA
**Effective date:** 2026-04-09

**Headline:** "Virginia Pressure Surge 10x Normal Range Halts Spring Bird Migration"

**Full text:**
> On April 8, 2026, weather stations KORF and KRIC in Virginia recorded barometric pressure changes of 57-71 mb over two hours -- roughly 10 times what's considered a strong pressure event -- as a post-frontal surge swept the region. These extreme conditions are suppressing bird migration during one of the most critical northward flight windows of spring, when millions of songbirds typically push through the Mid-Atlantic corridor. The combination of timing and intensity makes this a rare compound disruption: atmospheric physics and biological calendars colliding at the worst possible moment.

**Metadata:**
- `candidates_considered`: 40
- `top_score`: 79.5
- `source_types`: ["ai-synthesis", "anomaly-alert"]
- `domains`: ["meteorology", "wildlife-ecology", "ornithology"]

**How it was generated:** The `hunt-daily-discovery` edge function runs daily at 11:00 UTC. It queries the last 24 hours of `correlation-discovery`, `anomaly-alert`, and `ai-synthesis` entries. It scores them by "interestingness" (anomaly severity, z-score, cross-domain novelty). The top 5 candidates are sent to Claude Sonnet with instructions to "pick the SINGLE most interesting finding" and write a headline + 2-3 sentence discovery. The LLM composed the narrative from the candidate data it was given.

---

## Layer 2: The Raw Weather Data (METAR Realtime)

**Table:** `hunt_knowledge`
**Content type:** `weather-realtime`
**Source:** NWS METAR via aviationweather.gov API
**Stations:** KRIC (Richmond Intl) and KORF (Norfolk Intl)

### April 8 readings (KRIC):

| Timestamp (epoch) | Event | Stored `pressure_change_mb` | Stored `from_mb` | Stored `to_mb` |
|---|---|---|---|---|
| 1775606040 | pressure-rise | 47.4 | 34713.9 | 34761.3 |
| 1775609640 | pressure-rise | 81.3 | 34727.4 | 34808.7 |
| 1775613240 | pressure-rise | 81.3 | 34761.3 | 34842.6 |

### April 8 readings (KORF):

| Timestamp (epoch) | Event | Stored `pressure_change_mb` | Stored `from_mb` | Stored `to_mb` |
|---|---|---|---|---|
| 1775605860 | pressure-rise | 47.4 | 34713.9 | 34761.3 |
| 1775609460 | pressure-rise | 47.4 | 34737.6 | 34785.0 |

### April 9 readings (KRIC):

| Timestamp (epoch) | Event | Stored `pressure_change_mb` | Stored `from_mb` | Stored `to_mb` |
|---|---|---|---|---|
| 1775703240 | pressure-rise | 33.9 | 35025.4 | 35059.3 |
| 1775710440 | pressure-rise | 10.2 | 35059.3 | 35069.5 |

### April 9 readings (KORF):

| Timestamp (epoch) | Event | Stored `pressure_change_mb` | Stored `from_mb` | Stored `to_mb` |
|---|---|---|---|---|
| 1775713860 | pressure-drop | -33.9 | 35059.3 | 35025.4 |

### THE BUG: Double Unit Conversion

The aviationweather.gov METAR API returns `altim` **already in millibars** (e.g., `altim: 1022.4`).

The code in `hunt-weather-realtime/index.ts` line 53 defines:
```typescript
function inHgToMb(inHg: number): number {
  return Math.round(inHg * 33.8639 * 10) / 10;
}
```

This function is applied at line 301-302 to the `altim` value, treating it as inches of mercury when it is already millibars:
```typescript
const recentMb = inHgToMb(recent.altim);  // 1025 mb * 33.8639 = 34,710 mb
const olderMb = inHgToMb(older.altim);    // 1024 mb * 33.8639 = 34,676 mb
```

**Confirmed from live API call (2026-04-11T02:00Z):** KRIC returned `altim: 1022.4` (already millibars). The raw METAR string `A3019` decodes to 30.19 inHg = 1022.4 mb -- the API has already performed the conversion.

### Actual vs. Stored Values

| Stored Change | Inflation Factor | Actual Change | Assessment |
|---|---|---|---|
| 47.4 mb/2h | 33.86x | **1.4 mb/2h** | Normal post-frontal rise |
| 81.3 mb/2h | 33.86x | **2.4 mb/2h** | Moderate, not extreme |
| 33.9 mb/2h | 33.86x | **1.0 mb/2h** | Completely normal |
| 10.2 mb/2h | 33.86x | **0.3 mb/2h** | Trivial |

**For reference:** A "strong" pressure event is 6-8 mb change over a few hours. A "severe" event is 10+ mb. The actual changes (1.0-2.4 mb) are completely normal weather associated with a cold front passage. There was no pressure "surge" of any kind.

The discovery's claim of "57-71 mb" changes maps to **1.7-2.1 mb actual** -- ordinary post-frontal pressure recovery.

### Additional Bad Data: Open-Meteo Forecast Pressure

The `weather-event` content type (from Open-Meteo forecasts) contains entries showing pressure dropping to 0 mb:
- "Pressure drops 1025.3mb: 1025mb -> 0mb" (VA, 2026-04-09)
- "Pressure drops 1015.5mb: 1016mb -> 0mb" (VA, 2026-04-10)

These are bogus forecast artifacts where the forecast horizon runs out and returns 0 instead of null. The system is treating "no data" as "pressure dropped to zero" and recording 1000+ mb drops.

---

## Layer 3: The Migration Data

**Table:** `hunt_knowledge`
**Content types:** `migration-daily`, `migration-spike-extreme`, `migration-report-card`

### Duck Sightings (eBird):

| Date | Sightings | Baseline | Deviation | Assessment |
|---|---|---|---|---|
| Apr 6 | 209 | 0.0 | 0.0% | No baseline established |
| Apr 8 | 76 | 0.0 | 0.0% | No baseline established |
| Apr 9 | 105 | 0.0 | 0.0% | No baseline established |
| Apr 10 | **399** | 130.0 | **206.9%** | SPIKE (extreme) |

**Critical finding:** The April 8-9 migration data shows LOW activity (76-105 sightings). On April 10, there was an EXTREME SPIKE -- 399 sightings at 207% above baseline. This is the exact **opposite** of what the discovery claims. The discovery says pressure "halts spring bird migration." In reality, migration exploded the next day.

### BirdCast Radar Migration:

| Date | Birds Detected | Intensity | Direction |
|---|---|---|---|
| Apr 6 | 6,979 | low | N (0) -- stationary |
| Apr 7 | 42,380 | low | N (0) -- stationary |
| Apr 8 | 28,411 | low | N (0) -- stationary |
| Apr 9 | 288,932 | low | E (93.2 deg) |
| Apr 10 | **1,488,659** | low | NE (37.9 deg) |

BirdCast tells the same story: birds were indeed suppressed April 6-8 (cold front, first freeze), but then activity **exploded** on April 9-10 with nearly 1.5 million birds detected on radar on April 10. The "halt" was temporary and already over by the time the discovery was published.

### Migration Report Cards:

All three report cards (Apr 8, 9, 10) graded the outcome as **"surprise"** -- the convergence score 7 days prior (55-57) did not predict the spike. The brain did not see this coming.

---

## Layer 4: Pattern Links

**Table:** `hunt_pattern_links`
**Result:** EMPTY for VA in the April 6-12 window.

No cross-domain pattern links were created connecting weather to migration for Virginia in this period. The `scanBrainOnWrite` function either didn't fire or didn't find similarity > 0.65 between weather-realtime vectors and migration vectors. **There was no vector-space "discovery" linking pressure to migration.**

---

## Layer 5: Convergence Scores

**Table:** `hunt_convergence_scores`

| Date | Score | Weather | Migration | BirdCast | Solunar | Water | Pattern | Photoperiod | Tide |
|---|---|---|---|---|---|---|---|---|---|
| Apr 6 | 47 | 25 | 0 | 10 | 15 | 5 | 0 | 5 | 4 |
| Apr 7 | 42 | 25 | 0 | 3 | 15 | 5 | 0 | 5 | 4 |
| Apr 8 | 40 | 25 | 0 | 0 | 15 | 5 | 0 | 5 | 4 |
| Apr 9 | 37 | 18 | 0 | 0 | 15 | 5 | 0 | 5 | 7 |
| Apr 10 | **59** | 25 | **25** | 1 | 15 | 5 | 0 | 5 | 4 |

**Key finding:** The convergence score was **declining** from Apr 6-9 (47 -> 37). Migration component was **zero** for 4 straight days. The score only spiked on Apr 10 when the migration SPIKE arrived -- the opposite of the "halt" narrative. The brain was watching weather pile up with zero biological response.

---

## Layer 6: State Arcs

**Table:** `hunt_state_arcs`

### Active Arc (ID: `0f47d847-a87f-4c9b-83e3-12c153f9c79a`)
- **Opened:** 2026-04-01
- **Current act:** outcome (POST-DEADLINE DAY 9)
- **Claim:** "5 domains converging in VA" (compound-risk)
- **Opening convergence score:** 55
- **Grade:** NULL (not yet graded)
- **Outcome signals:** 26 pressure_drop events, 3 cold_front, 2 first_freeze across 9 cycles (Apr 2-10)

**The arc's own narrative is brutally honest** (emphasis mine):

> "the atmospheric signal density is *increasing* while the composite score *decreases*, which is a structural inversion... migration remains at **0**, birdcast at **0**, pattern at **0** -- the cold front and first freeze tags, which in a functioning compound-risk arc should trigger waterfowl displacement and BirdCast flight activity, have produced no downstream domain response across 9 consecutive cycles... the compound-risk claim should be treated as **structurally unconfirmed**."

### Prior Closed Arc (ID: `6222c405-69fd-4754-9333-f8d33e5c72b1`)
- **Opened:** 2026-03-27, **Closed:** 2026-04-01
- **Grade:** CONFIRMED
- **But the post-mortem notes:** "atmospheric loading -- full confirmation; compound-risk outcome -- not confirmed; the VA signature is a well-instrumented near-miss where weather domain over-weighted the convergence score relative to the biological domains"

---

## Layer 7: Alert Outcomes

**Table:** `hunt_alert_outcomes`

Nine alerts active for VA in this window:
- 4x `anomaly-alert` (convergence score drops, z-scores of -2.39 and -2.05)
- 4x `compound-risk` (5-domain convergence)
- 1x `convergence-alert` (NWS severe weather)

**None have been graded.** All `outcome_checked: false`.

The anomaly alerts are interesting -- they flagged that VA's convergence score was **dropping below normal** (z-score -2.39, "below" direction). The anomaly was that conditions were LESS convergent than usual, not more.

---

## Layer 8: Convergence Alerts

**Table:** `hunt_convergence_alerts`

One alert on April 7:
- **Type:** `nws_severe`
- **Score:** 42 (down from 47)
- **Reasoning:** "Severe weather alert issued. Score 42/100. Weather active: cold front, pressure drop, first freeze, NWS freeze warning."

This is the NWS freeze warning, not a pressure anomaly. The score was declining.

---

## Timeline Reconstruction

| Time | Event | Source |
|---|---|---|
| Mar 25-29 | Open-Meteo forecasts ingested, including bogus 0mb entries | weather-event cron |
| Apr 1 | State arc opens for VA compound-risk (5-domain convergence at 55) | hunt-arc-reactor |
| Apr 6 | Cold front arrives VA: 80F->62F, heavy precip. Convergence: 47 | weather-watchdog |
| Apr 7 | NWS freeze warnings. Convergence drops to 42. Anomaly detector fires (z=-2.39, score BELOW normal) | anomaly-detector |
| Apr 8 00:01Z | METAR cron runs, KRIC/KORF observations ingested. Bug inflates 1.4mb change to 47.4mb, 2.4mb to 81.3mb. All events flagged "high" severity | hunt-weather-realtime |
| Apr 8 | First freeze in VA (low 27F). Duck sightings: 76 (low). BirdCast: 28K birds (low). Convergence: 40 | Multiple crons |
| Apr 8 09:32Z | Anomaly detector fires again for Apr 8 (z=-2.05, score still BELOW normal) | anomaly-detector |
| Apr 9 03:31-06:32Z | More METAR observations with inflated pressure values (33.9mb stored = 1.0mb actual) | hunt-weather-realtime |
| Apr 9 07:20Z | Duck sightings: 105 (still low). BirdCast: 289K birds (increasing) | migration-monitor, birdcast |
| Apr 9 11:00Z | **Daily discovery generated.** Sonnet picks the inflated pressure data + anomaly alerts as most interesting. Writes "57-71 mb" headline. Claims migration is "halted." | hunt-daily-discovery |
| Apr 10 07:20Z | Migration EXPLODES: 399 sightings (207% above baseline). BirdCast: 1.49M birds. | migration-monitor |
| Apr 10 08:08Z | Convergence jumps to 59 (migration component goes from 0 to 25) | convergence-engine |

---

## Honest Assessment

### Was this a real cross-domain discovery?

**No.** This discovery is built on three layers of failure:

1. **A unit conversion bug inflated pressure readings by 33.86x.** The code treats METAR `altim` values (already in millibars) as inches of mercury and multiplies by 33.8639 again. A routine 1.4 mb post-frontal pressure rise became "47.4 mb." A 2.4 mb change became "81.3 mb." The "10x normal range" claim is entirely a product of this bug. The actual pressure changes were completely ordinary.

2. **The AI narrative fabricated a causal link.** When Sonnet was given candidates that included inflated pressure numbers and anomaly alerts (which were actually flagging scores BELOW normal), it composed a narrative connecting "extreme pressure" to "halted migration." But:
   - The anomaly alerts were flagging LOW convergence, not high pressure
   - No pattern links exist between weather and migration vectors for VA in this window
   - The convergence engine showed migration component at ZERO for 4 straight days
   - The brain's own state arc narrative explicitly says the compound-risk claim is "structurally unconfirmed"

3. **The migration claim is factually wrong.** The discovery says pressure "halts spring bird migration." On April 10, the very next day after the discovery was published, migration SPIKED to 207% above baseline with 1.49 million birds on radar. The temporary suppression (April 6-8) was a normal response to a cold front/freeze event -- textbook meteorology, not a discovery.

### What the brain actually knew vs. what it claimed

The brain's internal systems were honest. The state arc narrative correctly identified "structural inversion" -- increasing weather signals with zero biological response. The convergence scores were declining. The anomaly detector was flagging BELOW-normal activity. The migration report cards graded outcomes as "surprise" because the system didn't predict what happened.

But the daily discovery generator doesn't read arcs, convergence trends, or grades. It just takes the last 24 hours of anomaly alerts and syntheses, scores them by surface-level "interestingness," and asks an LLM to write a headline. The LLM received inflated numbers from a unit bug and wrote a compelling but false narrative.

### The deeper problem

Even without the unit bug, this would not have been a discovery. A cold front suppresses migration. That's meteorology 101. A real discovery would be: "the brain predicted migration suppression 48 hours before it happened based on pressure patterns that historically correlate with migration halts in the Mid-Atlantic corridor." That did not happen. The brain detected weather after the fact, failed to connect it to migration (pattern_links empty, migration component zero), and then an LLM dressed up the non-connection as a connection.

### What needs fixing

1. **Fix the unit conversion bug** in `hunt-weather-realtime/index.ts`. The `altim` field from aviationweather.gov is already in millibars. Remove the `inHgToMb()` call on lines 301-302. Use the values directly.

2. **Fix the 0mb forecast data** in the weather-watchdog. Open-Meteo returns 0 when forecast data is unavailable. These need to be filtered as null, not treated as "pressure dropped to zero."

3. **Add fact-checking to the discovery generator.** Before publishing, cross-check claims against actual convergence scores, migration data, and arc status. If the arc says "structurally unconfirmed," the discovery shouldn't claim a confirmed cross-domain event.

4. **Deduplicate METAR realtime entries.** The same observation is being stored 4-8 times (the cron runs every 15 minutes and re-ingests the same 3-hour window without effective dedup). The delete query targets `realtime-weather-event` but inserts use `weather-realtime` -- the content type doesn't match.

5. **The pressure change thresholds are wrong** even after fixing the unit bug. The code flags any rise > 3mb as an event (line 313). In real millibars, that's roughly correct for 2 hours, but the current threshold was calibrated against 33.86x-inflated values, so it's actually triggering on changes > 0.09 mb (3 / 33.86). Every station, every cycle, is firing "high severity" pressure events. This floods the system with false positives.
