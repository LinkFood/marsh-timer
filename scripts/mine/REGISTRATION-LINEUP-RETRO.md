# PRE-REGISTRATION — THE LINEUP RETRODICTION TEST (timebox gate 1, due 2026-07-20)

**Frozen 2026-07-16. Committed BEFORE any implementation runs against production data. Any
change after the first production run = new registration with version bump and documented
diff. Timebox context: gate 1 of the 2026-08-10 timebox (FRESH-EYES-VERDICT-2026-07-16):
result ships to THE-WEEK.md the night it runs, win or lose. No entry by 07-20 = FAIL.**

Adversarially reviewed before freeze (spec-breaker pass, findings A1–A10 incorporated below).

---

## 1. HYPOTHESIS (the product's claim, as published)

The Morning Line's lineup sentence — "The last time the moon, the tide, and the temperature
lined up like this here: <date> — it cooled X°F within Y days" — implies the lineup-selected
precedent's outcome transfers to today. The test: does lineup-matching (the moon and tide
clauses) carry ANY information about what follows, beyond what season + anomaly depth
already predict? If not, the lineup claim lane dies.

## 2. SUBSTRATE (verified live 2026-07-16, read-only REST)

- **Temperature/outcome ground**: `hunt_knowledge` `content_type='ghcn-daily'`, per-state
  daily rows, `metadata.avg_high_f`. VERIFIED: floor 1950-01-01; edge 2025-12-31 (2026-01-15
  returns 0 rows); completeness 365/366 rows per state-year on every probe (WY/AK/MD/TX ×
  1955/1990/2021); metadata.avg_high_f ≡ the content-regex value the product parses (probes
  exact; a seeded 500-row parity check runs at load time and aborts on any mismatch > 0.05°F).
- **Tide**: `hunt_knowledge` `content_type='tide-gauge'`, `metadata.residual_ft` — **the ONLY
  key the product's tidePool reads.** VERIFIED: the v1 daily lane carries residual_ft ≥1985→
  2025-12 across ~13 states (AK CA FL HI MA ME MS NC PA RI TX VA WA + intermittent others);
  the v2 roster/Chesapeake backfill rows (Baltimore 1902+, Battery, Gulf) carry residual_max_ft
  etc. but NO residual_ft and are **invisible to the lineup as implemented** (live receipt: MD
  runs mode=moon_temp despite 4 gauges on file; FL runs moon_tide_temp via Key West). The test
  runs the rule as implemented; full coverage receipts (station-days with residual_ft per
  state × decade) print in the report.
- **Moon**: computed astronomy — the Schlyter low-precision implementation copied VERBATIM
  from `supabase/functions/hunt-atlas-spot/index.ts` (moonLonEcl/sunLongitude/moonAgeOnDate/
  moonAgeDist). NOT `scripts/mine/frames.ts` moonPhase (a different approximation).
- **ERA: the full GHCN era, index days 1950-01-01..2025-12-31, all 50 states** (~1,387,950
  state-days). Justification: substrate completeness verified above; this test reads ghcn rows
  directly and does NOT touch `board_frames` — the 2022+ frame-cache poisoning (fusion reg §2)
  cannot bite here.
- hunt_weather_history (2020-09+) is NOT used: for archived dates the recorded ground IS the
  GHCN row; day-0 = the index day's own avg_high_f (documented deviation D3, §5).

## 3. THE RULE AS IMPLEMENTED (predicate copied verbatim-faithful from hunt-atlas-spot)

For index day d in state S ("as-if-live" reconstruction — see deviations, §11):

- **Pool**: every recorded day at day-of-year offset |off| ≤ 3 of d, across all years ≠
  year(d), with avg_high_f present and a per-offset mean computable (≥ 5 years); when tide is
  in use, the day must also have a residual_ft reading at the chosen station. **Anti-leakage
  guard (A2): pool days within ±10 calendar days of d are excluded** (affects only Dec/Jan
  index days; the unguarded verbatim variant prints as diagnostic S7).
- **Baselines**: offMean(off) = mean avg_high_f at that offset over all years ≠ year(d)
  (leave-index-year-out; deviation D2). anomToday = high(d) − offMean(0).
- **tempMatch(o)** (verbatim): if |anomToday| < 2°F → |anom(o)| < 2°F; else sign(anom(o)) ==
  sign(anomToday) AND |anom(o) − anomToday| ≤ 5°F.
- **Tide**: station = the gauge with the most residual_ft days in d's window (argmax, ties by
  station id asc — determinized); tide_today = residual_ft on d, else the most recent reading
  in [d−3, d]; useTide = joint tide-days ≥ 60 AND tide_today ≠ null.
  **tideMatch(o)** (verbatim): if |tide_today| < 0.5 ft → |res(o)| < 0.5 ft; else sign(res(o))
  == sign(tide_today) AND |res(o)| ≥ 0.5 ft.
- **moonMatch(o)** (verbatim): circular moon-age distance(age(o), age(d)) ≤ 2 days.
- **Mode**: moon_tide_temp when useTide, else moon_temp — exactly the product's fallback.
- **A(d)** = pool ∩ tempMatch (anomaly-matched). **L(d)** = A(d) ∩ moonMatch (∩ tideMatch when
  useTide) — the product's lineup matches. **N(d)** = A(d) \ L(d) — anomaly-matched, NOT
  lineup-matched. N(d) carries the full season + anomaly-band information: the contrast
  isolates exactly the moon/tide clauses' marginal value.
- **The quoted precedent** (verbatim: matches sorted date-desc, matches[0]): each arm's
  precedent = its most-recent member. Its claim = aftermathFor(member) parsed by
  `parseOutcomeString` (_shared/morningLine.ts): "cooled X°F within N days" / "warmed …" /
  "held steady through the week (within X°F)" / thin ("only N recorded days follow"). A thin
  or unparseable precedent = that arm makes NO claim (the product's NO_CLAIM path).
- **aftermathFor** (verbatim): next 7 recorded days; n<3 → thin; maxDrop ≥5 AND maxDrop ≥
  maxRise → "cooled round(maxDrop) within days-to-low"; elif maxRise ≥5 → warmed; else held.

## 4. POPULATION AND PAIRING

Index day d is **pair-eligible** iff: high(d) present; offMean(0) computable; BOTH L(d) and
N(d) are non-empty AND both arms' precedents parse to a claim verb; and d's own grade (§5) is
not UNGRADEABLE for either claim. Every eligibility stage's count prints (the funnel receipt).
Expected paired n ~10⁵–10⁶; the exact number is a report output, never tuned.

## 5. OUTCOME = THE PRODUCT'S OWN CLAIM BAR (hunt-morning-grader semantics, copied)

Grade each arm's claim against index day d's own recorded aftermath, day0 = high(d):
- verb cooled/warmed: HIT iff any recorded day at days_out ≤ claim.window_days moved ≥ 5°F
  (OUTCOME_BAR_F — the control line's own bar) in the claim direction; window holes with no
  hit → UNGRADEABLE (drop pair, count printed; substrate is complete so ≈0).
- verb held: MISS iff any recorded day in +1..+7 has |move| ≥ 5°F; else HIT (grader verbatim:
  held ignores the precedent window and uses the full 7).
- Full magnitude echo is recorded as evidence, never required (grader law).

## 6. PRIMARY METRIC

**Δ = mean over paired index days of [Hit_L(d) − Hit_N(d)]** — the paired transfer-accuracy
difference between the lineup-selected precedent and the anomaly-matched-only precedent.
Both arms share the day, the season, the anomaly band, the pool, the recency rule, and the
grading bar; only moon/tide membership differs. Δ > 0 = the lineup clause adds information.

## 7. THE NULL (structure-preserving, per the v1.3 canon — permutation is retired)

**Circular whole-year rotation of the moon+tide world against the fixed ground.** For offset
k: moon ages and tide residuals (values, coverage, station choice, useTide/mode — the whole
tide store) are read at date+k years (calendar-mapped, Feb 29→28, wrapping 2025→1950 on the
76-year axis); temperature, pools, baselines, aftermaths, grading stay at true dates. This
preserves every internal structure of moon (synodic autocorrelation) and tide (sea-level
trend, gauge eras, datum steps) and destroys ONLY their alignment with the ground — which is
exactly the null hypothesis. tempMatch and A(d) are untouched by rotation, so the null Δ
distribution carries all pool-size, recency-vintage, verb-mix, and serial-correlation
artifacts of the real statistic.

**Offsets: 5..71 minus the Metonic ghosts {19, 38, 57} = 64 replicates.** (At k≡0 mod 19 the
moon reproduces itself within hours — those rotations are near-identity for the dominant
component and would let a real moon signal fail against its own echoes.)

**PASS bar: Δ_obs strictly exceeds Δ_k for ALL 64 rotations** (exact p = 1/65 ≈ 0.0154, the
finest attainable) **AND Δ_obs ≥ +2.0 percentage points** (the importance floor: below 2pp
the moon/tide clause changes ~1 claim in 50 — decoration by decree, mirroring the mine's
anti-"statistically-detectable-but-tiny" doctrine; same currency as the G0 bar). Fisher/
McNemar p-values print as DESCRIPTIVE ONLY — serial correlation across index days makes them
anti-conservative; inference lives in the rotations alone.

## 8. GATES

- **G3 (determinism)**: same command twice → byte-identical report. No timestamps in payload.
  Math.random banned; seed 42 (used only for fixture generation and parity-probe selection).
- **G2 (full-pipeline negative control)**: the complete pipeline runs once at rotation offset
  3 (outside the null set): the primary must NOT certify on rotated data, and G0 must still
  PASS under it (the positive control is temp-only — invariance receipt). Any certification
  on rotated data invalidates the run.
- **G0 (positive control — the harness must detect a rule KNOWN to carry information)**:
  identical machinery, one predicate swap: treatment = most-recent A(d) member (anomaly-
  matched), control = most-recent member of pool \ A(d) (season-matched only). Regression to
  the mean guarantees anomaly-matched precedents transfer better. PASS: Δ_pos ≥ +2.0pp with
  descriptive McNemar p ≤ 1e-6. **G0 failure = HARNESS INVALID, no verdict is read from the
  primary.** One pre-declared repair permitted (version bump, documented diff); the timebox
  clock does not pause.
- **Parity gate (verbatim-faithfulness)**: (a) unit fixtures for every predicate branch,
  boundary values included (±2°F/±5°F/±0.5ft/±2d, near-normal branch, 60-joint-day floor,
  date-desc tie-break); (b) 10 seeded live probes against deployed hunt-atlas-spot on current
  dates, engine fed the spot's own day-0 inputs (spot's live bookkeeping mode): n_matches,
  last_date, mode, n_days_searched, control.all_n/all_outcome_n must match EXACTLY. Parity
  failure stops the run (code gate, fix and rerun).
- **Development firewall**: built and debugged on SYNTHETIC fixtures only — a planted
  moon-aligned-cooling archive must certify; a null archive must not. First production
  invocation is the run of record (gates first, then the test, one command).

## 9. SECONDARIES AND MANDATORY DIAGNOSTICS (printed; never gate; never promoted)

- S1 argmax subpopulation: Δ restricted to each date's largest-|z| state with n_years ≥ 10 —
  the state the Morning Line actually quotes.
- S2 mode split: moon_tide_temp vs moon_temp (does the tide clause matter at all?).
- S3 verb-stratified Δ (cooled / warmed / held) + per-arm verb-mix table (A4).
- S4 per-state Δ_s with empirical rotation p_s = (1+#{k: Δ_s,k ≥ Δ_s})/65.
- S5 epoch split: 1950–1987 vs 1988–2025 (coverage drift).
- S6 member-level pooled 2×2 (the control line's own altitude): P(cooled ≥5°F | L) vs
  P(cooled ≥5°F | N) across all pool days, rotation-calibrated.
- S7 unguarded verbatim Δ (no ±10d exclusion — the leakage diagnostic).
- S8 guard sensitivity: Δ at ±7d and ±14d.
- Multiple comparisons: ONE pooled primary. All secondary p-values (50 states + 2 modes +
  3 verbs + 2 epochs = 57) are BH-corrected at q=0.05 as ONE family (the one-family law).
- Diagnostics: eligibility funnel; n distinct precedent days per arm (cluster receipt);
  precedent-vintage (median year) per arm; hit rates with Wilson intervals (the product-copy
  interval); all 64 rotation Δs printed; UNGRADEABLE counts; coverage receipts (§2).

## 10. VERDICT SEMANTICS (frozen, wired to the timebox)

- Parity/G2/G3 fail → code bug; fix code (never the registration), rerun.
- G0 fails → HARNESS INVALID; one repair; if the repair fails, gate 1 is graded on that.
- **CERTIFIED LIFT** (Δ_obs > all 64 rotations AND Δ_obs ≥ +2.0pp) → the lineup lane
  survives; gate 1 PASS; documented re-hearing per the timebox.
- **Anything else → NO LIFT: the lineup claim lane dies in THE-WEEK.md the same night.**
  Named trigger scope: the Morning Line's lineup sentence and precedent-claim lane
  (hunt-atlas-spot lineup block, hunt-morning-line lineup_sentence, the grader's precedent
  path) are retired or demoted to control-line-only copy — the surgery list executes by main
  session, the trigger is this registration. 0 < Δ < 2pp that beats all rotations prints as
  "detectable but below the registered importance floor" — the lane still dies as registered.
- The report ships either way, all numbers visible, all secondaries labeled.

## 11. DOCUMENTED DEVIATIONS FROM THE DEPLOYED CODE (each is a ruling, not an accident)

- **D1 (as-if-live semantics)**: the deployed spot anchors DATED requests to the most recent
  archived year (a 1980 request quotes 2025's temperature — the known 07-09 structural wart).
  Retrodicting that quirk would test 2025's weather 1.4M times. The registration tests the
  rule's LIVE semantics — day-0 = the index day itself — which is what every published
  Morning Line actually runs.
- **D2 (leave-index-year-out bookkeeping)**: live mode excludes the latest archived year from
  the pool but keeps it in the baseline (edge-of-archive bookkeeping). The registered rule is
  the symmetric version: baseline AND pool both exclude year(d). Tolerances, signs, and
  branch structure are verbatim.
- **D3 (grading substrate)**: live grades use hunt_weather_history (exists 2020-09+ only);
  archived ground truth = the GHCN rows themselves, same bar, same hole semantics.
- **D4 (±10d anti-leakage guard)**: the deployed pool admits calendar-adjacent days across
  the Dec/Jan year boundary whose aftermaths overlap the index day's own (A2). Guarded in the
  primary; verbatim variant printed (S7).

## 12. FROZEN CONSTANTS

| constant | value | source |
|---|---|---|
| window | ±3 day-of-year | WINDOW_DAYS, hunt-atlas-spot |
| aftermath | next 7 recorded days | AFTERMATH_DAYS |
| moon tolerance | ±2 days circular | MOON_TOL_DAYS |
| temp tolerance / near-normal | 5°F / 2°F | TEMP_TOL_F / TEMP_NEAR_F |
| tide threshold | 0.5 ft | TIDE_ELEV_FT |
| tide joint-day floor | ≥ 60 | LINEUP_MIN_TIDE_DAYS |
| baseline floor | ≥ 5 years | MIN_YEARS |
| outcome bar | ≥ 5°F same direction, in claim window | COOL_OUTCOME_F / OUTCOME_BAR_F |
| held bar | |move| < 5°F through 7 days | grader verbatim |
| precedent pick | most-recent match (date desc) | matches[0] verbatim |
| moon math | Schlyter, copied from hunt-atlas-spot | never frames.ts moonPhase |
| era | index days 1950-01-01..2025-12-31, 50 states | verified §2 |
| anti-leakage guard | ±10 calendar days | D4 (S7/S8 sensitivity) |
| rotations | 5..71 minus {19,38,57} = 64 | Metonic exclusion |
| pass | Δ > all 64 AND Δ ≥ +2.0pp | §7 |
| G2 offset | 3 | §8 |
| G0 bar | Δ_pos ≥ +2.0pp, McNemar ≤ 1e-6 | §8 |
| BH | q = 0.05, one 57-test family | §9 |
| seed of record | 42 | fixtures + parity probes only |
