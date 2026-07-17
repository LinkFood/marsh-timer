# PRE-REGISTRATION — THE FUSION FORMATION TEST (mine v2.0, board altitude)

**Frozen 2026-07-16. This document is committed BEFORE any implementation runs against production anchors. Any change after the first production run = new registration with version bump and documented diff. Timebox context: this test is gate 2 of the 2026-08-10 timebox (replacing the conjunction mine, James's call 07-16); result ships to THE-WEEK.md the night it runs, win or lose.**

Adversarially reviewed before freeze (spec-breaker agent, 2026-07-16): 5 fatal amendments (A1–A5), 6 knob rulings (B), 6 additions (D) — all incorporated below. The draft's p ≤ 0.005 bar, ≥3y control exclusion, K=2000 sampled null, and 2026 era end are RETIRED; their replacements are marked.

---

## 1. HYPOTHESIS (the owner's thesis, as stated)

"Fusion in unfused data": in the days before MAJOR catastrophes, the board's JOINT state — many instruments deep in their own historical tails simultaneously, and deepening — is elevated relative to matched control windows. This tests the joint distribution across all instruments, which mine v1.0–v1.3 (single-lane threshold rules) never touched.

## 2. SUBSTRATE

- `board_frames`, layout v1711701607 (all 27,956 days live under v2 — verified 2026-07-16). **Slot set = the 142 v1 offsets (0–141) only**; PNA slots 142–143 excluded (append-only law verified; offsets 0–141 byte-identical across layouts).
- Byte semantics: 255 = no reading; else tail-depth pct = byte/254 vs the slot's own doy±15 pool across all years.
- **SUBSTRATE ERA (amendment A5): anchors with onset ≥ 2022-01-01 are excluded a priori** (33 of 392 MAJOR; coverage receipt: reporting slots collapse ~133 → 4–5 on 2022-01-01 — root cause is backfill cache poisoning, `scripts/frames/.frame-cache/series-*.json` truncated at 2021-12-31; the archive itself holds the data). Test 2 scan era = 1990-01-01..2021-12-31. Epoch honesty split = 1990–2005 vs 2006–2021. If the 2022–2026 substrate is re-baked before the run, this clause is re-frozen with a version bump and the era extends; otherwise the run proceeds on 1990–2021.

## 3. PRIMARY METRIC

**Formation score F(d)** = fraction of ELIGIBLE reporting slots with byte ≥ **249** (τ = 0.98 registered as the byte, ruling B(a); Math.round(0.98·254) = 249).

Slot eligibility on day d:
- byte ≠ 255 (reporting), AND
- the slot's LUT pool at d's doy has years ≥ 10 (pools under 10 years were forward-clamped pct ≤ 0.6 at bake time and are structurally incapable of ≥ 0.98 — excluded from numerator AND denominator, ruling B(a)).

Floors (set from reporting-count distributions only, never outcomes — the distribution is cleanly bimodal ~110–135 vs 4–5):
- **Day floor: ≥ 100 of 142 slots reporting**, else the day is excluded from all windows, controls, and scans (ruling B(e)).
- **Window floor: ≥ 10 of 14 eligible days** after episode masking (§5), else the window (anchor or control) is dropped, counted, and listed.
- Both floors apply IDENTICALLY inside every rotation replicate; per-replicate dropped-anchor counts are printed.

Diagnostic τ values {byte 241 (0.95), byte 253 (0.995)} are computed and printed as LABELED DIAGNOSTICS — never promoted, no grid correction.

## 4. ANCHORS (amendment A4)

- Source: `scripts/mine/anchors.ts` effective anchors (4,233 raw → 1,985 effective; loader hard-asserts EXPECTED_RAW = 4233 and zero pre-1990 anchors — drift fails loudly).
- Tier: **MAJOR** (deaths ≥ 10 OR damage ≥ $250M on the merged anchor; tier rule copied from mine.ts).
- **CROSS-FAMILY MERGE for the primary**: effective anchors whose spans overlap or sit within ±7d AND whose state sets intersect are merged transitively into pooled episodes (onset = earliest member span start; tier = max member tier). Receipt printed: 392 MAJOR effective anchors → N merged episodes (the 150/392 cross-family overlaps are the same synoptic systems counted 2–3×; unmerged pooling would put each event's own D0 signature in its siblings' pre-windows).
- Era filter per §2: onset ≤ 2021-12-31.
- Anchor-set fingerprint printed: (raw count, hash of sorted member ids).

## 5. EPISODE MASKING (amendment A4 — the aftermath-detector killer)

When computing W(a), W_far, W_near, M(a), any control window mean, and Test 2's trailing W(d): any day lying inside ANY pooled MAJOR episode's span (other than the episode whose window is being computed) is excluded from the mean. Windows retaining < 10 of 14 eligible days are dropped and counted. M(a)'s full reach-back (to D-28) is masked under the same rule (addition D6). Test 2 scan days are ineligible if the day itself lies inside any pooled MAJOR episode span. (Receipt context: 289/392 unmasked pre-windows overlap another MAJOR's span — contamination is the norm, not the edge case.)

## 6. WINDOWS

- **W(a)** (primary) = mean masked F over **D-14..D-1** before episode onset. D0 excluded.
- Declared secondaries (ruling B(b)): **W_far** = D-14..D-4 and **W_near** = D-3..D-1, reported side by side. If the primary passes only through W_near, the headline must say so — "storms precede storm damage" is meteorology, not fusion.
- **M(a)** (declared secondary, motion): mean over D-14..D-1 of (F(d) − mean F over d-14..d-1), masked per §5.
- Outcome window (Test 2): episode onset in **d+1..d+14** (ruling B(c)).

## 7. CONTROLS (amendment A2 — replaces the empty-set draft rule)

Per merged episode: up to **8 control days** at the same doy ± 15, drawn from the NEAREST eligible years to the anchor year (|controlYear − anchorYear| minimized within 1990–2021, seeded tie-break — v1's epoch-matched rule, the trend-confound fix the v1 audit trail paid p=2e-49 to learn). A control day is eligible iff:
1. its D-14..D-1 window, after masking (§5), retains ≥ 10 eligible days;
2. no pooled MAJOR episode span lies within ±30d of the control day;
3. the control day itself lies inside no episode span of any family, any tier.

Honesty lines printed: achieved mean |year gap|; mean reporting-count gap (anchors vs controls). Mean reporting-count gap > 2 slots triggers coverage-matched resampling (ruling B(f)).

## 8. THE NULL (amendment A1 — replaces K=2000 sampling)

**The exhaustive set of all 67 circular whole-year rotations** (offsets 5..71 inclusive, v1.3 canon: the whole frame store's day axis rotates, same month/day mapping, Feb 29 → 28; anchors, episode spans, masks, and floors stay at true dates; F values travel with their frames). Computed deterministically — no sampling, no K parameter.

**PASS bar for each test: the observed statistic strictly exceeds the statistic under ALL 67 rotations** (exact p = 1/68 ≈ 0.0147 — the finest attainable under the canonical structure-preserving null; p ≤ 0.005 is unattainable at this replicate ceiling and is retired). Both tests use the same 67 rotations. The joint pass is NOT claimed as 0.0147²; the tests share substrate and anchors and their dependence is acknowledged in the report.

## 9. THE TWO TESTS

**TEST 1 (primary contrast):** ΔW = mean W(episodes) − mean W(controls). PASS = ΔW strictly exceeds all 67 rotation values of the same statistic (computed with identical floors, masks, and control logic per replicate).

**TEST 2 (dose-response — the near-miss law as the x-axis):** over all eligible scan days 1990–2021, trailing W(d) = mean masked F over the previous 14 days (≥10 eligible). Deciles computed WITHIN month strata. Outcome = pooled MAJOR episode onset in d+1..d+14. **Base rate b = the post-masking follow rate over all eligible scan days, computed and printed BEFORE any W-vs-outcome contrast is examined** (the pre-masking probe value 0.3454 is NOT the bar — masking removes follow-enriched aftermath days, so b will differ; the bar is set off the frozen post-masking number). PASS = top-decile follow rate ≥ **2b** AND the top-decile lift strictly exceeds all 67 rotation values. Curve shape (Spearman ρ across deciles) is printed as DESCRIPTIVE only — struck from PASS semantics (addition D5); the near-miss cliff is read from the published curve, not gated.

## 10. GATES

- **G3 (determinism):** same seed twice → byte-identical payload. No timestamps in payload. Math.random banned. RNG consumption order is part of the contract.
- **G2 (full-pipeline negative control, addition D1):** one seeded outer rotation of the store; the COMPLETE pipeline (both tests, all gates' logic) runs on it; both tests must FAIL on rotated data. Any PASS on rotated data invalidates the run.
- **G0 (positive-control sanity, amendment A3):** roll call = **Feb-2010 (Snowmageddon), Dec-2010 (Christmas blizzard), Uri (Feb-2021), Superstorm (Mar-1993), Jonas (Jan-2016)** — all have ≥125 reporting slots in their pre-windows. Dec-2022 (Elliott) is EXCLUDED with the stated reason: frame store blank 2022+ (coverage receipt in the report). Quantitative pass: each roll-call episode's W(a) must exceed the median W of its own matched controls, and ≥ 4 of 5 must exceed the 75th control percentile. **G0 failure = the metric is invalid and no verdict is read from Tests 1/2.** The registration permits exactly ONE pre-declared metric repair (re-freeze with version bump, documented diff); the timebox clock does not pause.
- **Development firewall:** the implementation is built and debugged against SYNTHETIC fixtures only (planted-signal and null boards). Nobody runs the pipeline against production anchors until the code is verified against this registration; the first production invocation is the run of record (gates first, then tests, one command).

## 11. MANDATORY HONESTY DIAGNOSTICS (printed in every report; never gate, never promoted)

1. **Lane decomposition (addition D2):** F decomposed as F_air (state-temp slots) / F_water (tide) / F_pressure (buoy) / F_climate (needles) over episode pre-windows vs controls, plus lane-balanced **F\*** = mean of per-lane deep-fractions as a declared secondary. 100 of 142 slots are state-temp — one continental airmass can move F alone; the report may NOT claim "fusion in unfused data" if the entire effect is one lane, and the headline must name the carrying lane(s).
2. **Leave-one-family-out (addition D3):** ΔW recomputed with each family's episodes removed (7 lines). If the pooled pass evaporates without one family, the verdict text carries it.
3. W_far vs W_near decomposition (§6).
4. Epoch split 1990–2005 vs 2006–2021.
5. τ diagnostics (bytes 241/253).
6. Per-replicate dropped-window counts; control year-gap and coverage-gap lines; coverage-cliff receipt table.

## 12. VERDICT SEMANTICS (frozen)

- G0 fails → METRIC INVALID; no verdict; one repair permitted per §10.
- Tests 1 AND 2 pass (each beating all 67 rotations, Test 2 also ≥ 2b) → **FUSION CONFIRMED at board altitude** on the 1990–2021 substrate; timebox gate 2 passes; re-hearing earned.
- Either test fails → **the fusion thesis AS STATED is dead at this altitude on this substrate generation**; the timebox default (mothball at 2026-08-10) proceeds.
- The report ships either way, all numbers visible, all secondaries labeled, headline carries the lane/W_near caveats if triggered.

## 13. FROZEN CONSTANTS

| constant | value |
|---|---|
| τ primary | byte ≥ 249 (0.98) |
| τ diagnostics | bytes 241, 253 |
| slot set | v1 offsets 0–141 (PNA excluded) |
| LUT-years slot floor | ≥ 10 years at the slot's doy |
| day floor | ≥ 100/142 reporting slots |
| window floor | ≥ 10/14 eligible days (masked) |
| pre-window | D-14..D-1 (W_far D-14..D-4, W_near D-3..D-1) |
| outcome window | +1..+14 |
| cross-family merge | span overlap or ±7d AND states intersect, transitive |
| control mask radius | ±30d (episode), ±0d (span membership, any tier) |
| controls per episode | ≤ 8, nearest-year, seeded tie-break |
| rotations | exhaustive 5..71 (67 replicates) |
| pass | strictly beat all 67 (p = 1/68); Test 2 also ≥ 2× post-masking base rate |
| anchor era | onset 1990-01-01..2021-12-31 |
| scan era | 1990-01-01..2021-12-31 |
| anchor source assert | EXPECTED_RAW = 4233 |
| seed of record | 42 |

---

## AMENDMENT v2.1 (2026-07-16 — the ONE permitted G0 metric repair, §10; frozen before the repair is implemented)

**G0 FAILED on the v2.0 run of record** (seed 42, pipeline commit deb3130, report scripts/mine/out/FUSION-REPORT.md): 1/5 roll-call events passed; G2/G3 passed; no verdict read. **Diagnosis, from the report's own receipts: the §4 merged-episode construction displaces tested onsets weeks before the famous storms.** Uri was tested at episode onset 2020-12-10 (its winter chain began with December storms; Uri's ground onset is ~2021-02; its own stitched row "February 2021 North American Cold Wave" is dated 2021-02-02). Jonas tested at 2015-12-09, Snowmageddon at 2010-01-17. Season-chains (within-family ±7d union at anchors.ts, extended by cross-family merge) make event-level formation untestable: the famous fusion sat INSIDE its own episode, masked out. This is a test-construction artifact, not evidence about the board.

**THE REPAIR (everything not named here stays frozen):**
1. **Test anchors descend from merged episodes to MAJOR MEMBER ROWS**: the 4,233 raw stitched anchors as loaded by `fetchRawAnchors()`, filtered to rows individually meeting the MAJOR bar (deaths ≥ 10 OR damage ≥ $250M **on the row's own severity fields as anchors.ts loads them** — if raw rows carry no per-row severity, the repair FAILS LOUDLY and stops; no improvisation), era onset 1990-01-01..2021-12-31.
2. **Same-system dedup**: rows whose spans overlap AND state sets intersect group transitively (union-find); keep one tested anchor per group — max severity (deaths×100 + damageUsd/$1M), then earliest d0, then lexicographic id. Receipt printed: raw MAJOR rows → deduped tested anchors.
3. **Windows unchanged** (D-14..D-1 at the tested row's own d0). **Masking now excludes days inside ANY MAJOR row's span (any family) other than the tested row's own** — chain-mates' storm days never count as formation.
4. **Controls**: rules unchanged; eligibility clause (iii) reads "inside no MAJOR row span and no effective-anchor span of any tier."
5. **Test 2**: outcome = deduped tested-anchor onset in +1..+14; scan-day in-span exclusion = any MAJOR row span; b recomputed post-masking before any contrast, bar = 2b.
6. **G0 unchanged** (same 5 events, same quantitative bar), matched to their own MAJOR rows (span-intersect, winter-family preferred).
7. All floors, rotations (exhaustive 67), pass bars, G2, G3, §11 diagnostics, §12 semantics: UNCHANGED.

**This is the final permitted repair. If G0 fails on the v2.1 run of record, the metric is INVALID FINAL for this registration family; the report ships that way and timebox gate 2 is graded on it.**
