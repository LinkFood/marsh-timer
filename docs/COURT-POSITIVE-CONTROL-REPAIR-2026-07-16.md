# Court positive-control repair — 2026-07-16

Registration record for the repair of the claim court's failing positive control
(fresh-eyes audit finding: `overcast-collapse-flood` at 0-for-2, lift 0.00,
unnoticed). Prerequisite of Fresh-Eyes box item 2 (conjunction mine by 07-27).
All changes are docket rows in `hunt_claims` — **no grader code changed, no
function deployed** (the grader was verified correct; see verdict).

## Verdict: the machinery worked, the yardstick was invalid

Root cause is **claim formation** (the benchmark is not valid known physics as
encoded), not a grader bug. Both fired evaluations were re-checked by hand
against ground truth and both MISS grades were **correct**:

1. **MA fire 2026-07-07** (outcome window 07-08..07-10, hit=false, controls
   1/10). Ground truth: the flood signal existed but was **concurrent with the
   trigger** — Flood Watch issued 07-06, 11.8 mm rain + diurnal collapse
   (66.2/61.5 °F, 96% cloud) on 07-07, clear by 07-08. The court's outcome
   window deliberately starts the day AFTER the fire (anti-tautology rule), so
   a same-day flood can never confirm. At statewide daily granularity,
   diurnal-range collapse *accompanies* the flood-producing storm; it does not
   lead it by 1–3 days.
2. **CA fire 2026-07-05** (outcome window 07-06..07-08, hit=false, controls
   0/10). Ground truth: the "collapse" was a warm humid night (low 71.4 °F
   against ~55 °F neighbors) in a week with **0.0 mm precipitation** — no flood
   risk existed. The trigger also fires on non-storm overcast: AK summer
   stratus fired it 4× on 07-14/15.
3. **Two of the claim's three outcome lanes are structurally dead in the live
   era**: `weather-event` has never emitted a flood-titled row (the detector
   has no flood type), and `storm-event` (NCEI) publishes with months of lag,
   so rows cannot exist when a 3-day window is graded days after close. Only
   `nws-alert` is live.

Grader verification: the exact outcome queries (content_type + state_abbr +
effective_date window + case-insensitive "flood" text match) were replicated
against `hunt_knowledge` and correctly find flood rows when they exist in a
window (e.g. the MA 07-06 Flood Watch rows) and correctly find none in the two
fire windows.

## Actions taken (2026-07-16, via REST — history preserved)

- `overcast-collapse-flood` (id `33158acb-c4ee-4ede-9925-46f0f1a565b9`):
  `status` → `retired`, diagnosis appended to `notes`. Row and its 6 fires kept.
  The 4 pending unevaluated fires (AK/TX 07-14 and 07-15) will still be graded —
  the court grades fires of retired claims — and honest misses are the expected
  result. The two existing MISS grades stand: they were correct and need no
  re-grade.
- Registered replacement positive control `nws-flood-watch-verifies`
  (id `4f05c8ca-b9b4-48a8-a147-2039d7af88d7`), status active.

## The replacement: `nws-flood-watch-verifies`

**Hypothesis:** When NWS issues a Flood Watch for a state, a Flood Warning
follows in that state within 3 days.

- Trigger: presence of `nws-alert` containing "flood watch" (lookback 1 day),
  scope = 13 states: AK WI AL KY NC MI GA PA TN NE VA CT NJ.
- Outcome: presence of `nws-alert` containing "flood warning" within 3 days.
- Machinery yardstick, **not a discovery** — never cite as forecasting skill.

**Retrodiction (exact court semantics — outcome window D+1..D+3, per-state
3-day matched control windows, live era 2026-03-15..07-12):**

| population | fires | hits | hit rate | mean control rate |
|---|---|---|---|---|
| all 41 watch states | 324 | 256 | 79% | 0.43 |
| 13-state scope | 91 | 75 | **82%** | **0.28** |

Scope was restricted **in-sample** to states with base-rate headroom
(per-state 3-day control rate ≤ 0.40, ≥ 2 fires, hit rate ≥ 0.6). Saturated
states (TX ctrl 0.71, IL 0.66, MO 0.60, …) are excluded because near-daily
warnings push control windows toward 10/10 and lift toward 1.0 even on hits —
the benchmark would be non-diagnostic there. In-sample scope selection is
legitimate for a positive control (the case is constructed to be detectable);
it would be damning for a discovery.

**Expected behavior / health check:**

- Fires ~0.5–1 per day across the scope during convective season; first fire
  on the next scoped-state Flood Watch (none on 07-16 — that day's watches
  were AZ/TX/UT/WY, all out of scope), first grade 4 days after.
- HEALTHY = majority of fires HIT with lift > 1 (typical 2.5–4 given ctrl≈0.28).
- INDICTMENT = 0-for-5+ fires, or hits stuck at lift ≈ 1.0 → suspect the
  grading machinery, not the physics.
- Verified live 2026-07-17T02:41Z: manual court run, 5 active claims,
  213 fire evals including the new scope, 0 errors.

Note for the record: the second seeded benchmark `tide-surge-coastal-flood`
has **never fired once** since 07-03 (trigger too strict or noaa-tide z never
reaches +1.5 weekly) — it validates nothing either. Left untouched here; flag
for the next court session.
