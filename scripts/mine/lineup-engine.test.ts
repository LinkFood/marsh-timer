/**
 * lineup-engine.test.ts — synthetic-fixture tests for the lineup retrodiction
 * pipeline (REGISTRATION-LINEUP-RETRO.md, frozen 2026-07-16 commit c135065).
 * Plain asserts, no framework, exits non-zero on any failure.
 * Run: npx tsx scripts/mine/lineup-engine.test.ts
 *
 * DEVELOPMENT FIREWALL (§8): every store here is SYNTHETIC. Nothing in this
 * file touches the network or the production archive. The parity gate's unit
 * half (§8(a)) lives here: every predicate branch at its boundary values
 * (±2°F / ±5°F / ±0.5ft / ±2d, the near-normal branch, the 60-joint-day
 * floor, the date-desc precedent pick); the live half (the 10 seeded probes)
 * runs on the production path only.
 */

import { seededRng } from "./stats";
import { parseOutcomeString } from "../../supabase/functions/_shared/morningLine";
import {
  GUARD_DAYS, LINEUP_MIN_TIDE_DAYS, MIN_YEARS, N_ROTATIONS, ROTATION_OFFSETS,
  Env, LineupStore, TideStationData,
  aftermathOutcome, buildEnv, composeRemap, evalReplicate, fnv, gradeClaim,
  makeCal, makeRemap, mcnemarOneSided, moonAgeDist, moonAgeOnDate, moonMatchFn,
  spotLiveLineup, tempMatchFn, tideChoiceFor, tideMatchFn,
} from "./lineup-engine";
import { runLineupRetro } from "./lineup-retro";

let passed = 0;
let failed = 0;

function assert(cond: boolean, name: string, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function approx(actual: number | null | undefined, expected: number, tol: number, name: string): void {
  assert(
    actual !== null && actual !== undefined && Number.isFinite(actual) && Math.abs(actual - expected) <= tol,
    name,
    `expected ${expected} ± ${tol}, got ${actual}`
  );
}

// ─── fixture builders ───────────────────────────────────────────────────────────

const DAY_MS = 864e5;
const isoOf = (y0: number, d: number): string =>
  new Date(Date.UTC(y0, 0, 1) + d * DAY_MS).toISOString().slice(0, 10);
const totalDays = (y0: number, y1: number): number =>
  Math.round((Date.UTC(y1, 11, 31) - Date.UTC(y0, 0, 1)) / DAY_MS) + 1;

/** Flat store: every day = `level` °F for every state; optional tide stations. */
function flatStore(
  y0: number, y1: number, states: string[], level = 70,
  tide: Record<string, TideStationData[]> = {},
): LineupStore {
  const T = totalDays(y0, y1);
  const high = new Map<string, Float64Array>();
  for (const s of states) high.set(s, new Float64Array(T).fill(level));
  return {
    startIso: `${y0}-01-01`, endIso: `${y1}-12-31`, states, high,
    tide: new Map(Object.entries(tide)),
  };
}

function station(id: string, T: number, fill: number | ((d: number) => number)): TideStationData {
  const res = new Float64Array(T).fill(NaN);
  for (let d = 0; d < T; d++) res[d] = typeof fill === "number" ? fill : fill(d);
  return { id, name: id, res };
}

/**
 * Signal store (the e2e fixture family). Temperature = seasonal + seeded
 * AR(1) anomaly (regression to the mean — G0's food) + an optional PLANTED
 * moon-coupled cold pulse: −`dipF` on every day whose TRUE moon age sits in
 * [16, 20]. A day at age ~13–15 therefore reliably cools within a few days,
 * and a day inside the dip reliably warms out of it — outcomes are carried by
 * the moon, which is exactly what the lineup clause claims to read. Rotating
 * the moon world against this ground (§7) destroys the coupling.
 */
function signalStore(
  y0: number, y1: number, states: string[],
  opts: { dipF: number; arSd: number; seed: number; tideStates?: string[] },
): LineupStore {
  const T = totalDays(y0, y1);
  const ages = new Float64Array(T);
  for (let d = 0; d < T; d++) ages[d] = moonAgeOnDate(isoOf(y0, d));
  const high = new Map<string, Float64Array>();
  for (const s of states) {
    const rng = seededRng(fnv(`${opts.seed}|${s}`));
    const gauss = () => {
      // Box-Muller (deterministic, seeded)
      const u = Math.max(rng(), 1e-12);
      const v = rng();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    const arr = new Float64Array(T);
    let ar = 0;
    for (let d = 0; d < T; d++) {
      const doy = (Date.parse(isoOf(y0, d) + "T00:00:00Z") - Date.UTC(Number(isoOf(y0, d).slice(0, 4)), 0, 1)) / DAY_MS;
      const seasonal = 70 + 15 * Math.sin((2 * Math.PI * (doy - 100)) / 365.25);
      ar = 0.75 * ar + gauss() * opts.arSd;
      const dip = opts.dipF > 0 && ages[d] >= 16 && ages[d] <= 20 ? -opts.dipF : 0;
      arr[d] = seasonal + ar + dip;
    }
    high.set(s, arr);
  }
  const tide = new Map<string, TideStationData[]>();
  for (const s of opts.tideStates ?? []) {
    const rng = seededRng(fnv(`${opts.seed}|tide|${s}`));
    tide.set(s, [station("gauge-1", T, () => (rng() - 0.5) * 2)]);
  }
  return { startIso: `${y0}-01-01`, endIso: `${y1}-12-31`, states, high, tide };
}

// ─── (a) predicate boundaries (parity gate (a): every branch, boundary values) ──
console.log("(a) predicate boundaries — tempMatch / tideMatch / moonMatch verbatim");
{
  // near-normal branch: |anomToday| < 2 → |anom| < 2 (both strict)
  assert(tempMatchFn(1.99, 0.5), "near-normal: anom 1.99 matches anomToday 0.5");
  assert(!tempMatchFn(2.0, 0.5), "near-normal: anom 2.0 does NOT match (strict <)");
  assert(tempMatchFn(-1.99, 1.99), "near-normal: sign-free inside the band");
  // else branch: same sign AND |anom − anomToday| ≤ 5 (inclusive)
  assert(tempMatchFn(8, 3), "warm branch: |8−3| = 5 matches (inclusive ≤)");
  assert(!tempMatchFn(8.01, 3), "warm branch: |8.01−3| > 5 does not match");
  assert(!tempMatchFn(-3, 3), "warm branch: sign mismatch never matches");
  assert(tempMatchFn(-8, -3), "cold branch symmetric");
  assert(tempMatchFn(1.5, 3), "warm branch: anom 1.5 vs anomToday 3 matches (same sign, |diff| ≤ 5)");

  // tideMatch: near-predicted branch |tide_today| < 0.5 → |res| < 0.5 (strict)
  assert(tideMatchFn(0.49, 0.3), "tide near: 0.49 < 0.5 matches");
  assert(!tideMatchFn(0.5, 0.3), "tide near: 0.5 does NOT match (strict <)");
  // else: same sign AND |res| ≥ 0.5 (inclusive)
  assert(tideMatchFn(0.5, 0.8), "tide off-predicted: |0.5| ≥ 0.5 matches (inclusive)");
  assert(!tideMatchFn(0.49, 0.8), "tide off-predicted: 0.49 below threshold");
  assert(!tideMatchFn(-0.6, 0.8), "tide off-predicted: sign mismatch");
  assert(tideMatchFn(-0.6, -0.8), "tide off-predicted: negative side symmetric");

  // moonMatch: circular distance ≤ 2 (inclusive), synodic wraparound
  assert(moonMatchFn(5, 7), "moon: distance exactly 2 matches (inclusive ≤)");
  assert(!moonMatchFn(5, 7.01), "moon: 2.01 does not match");
  assert(moonMatchFn(29.0, 1.0), "moon: wraparound 29.0 vs 1.0 = 1.53 days matches");
  approx(moonAgeDist(29.0, 1.0), 29.530588853 - 28.0, 1e-9, "moonAgeDist wraps on the synodic cycle");

  // Schlyter sanity (the verbatim copy, never frames.ts moonPhase)
  const newMoon = moonAgeOnDate("2000-01-06");
  assert(newMoon < 1.5 || newMoon > 28.0, "2000-01-06 reads as new moon", `${newMoon}`);
  const fullMoon = moonAgeOnDate("2000-01-21");
  assert(fullMoon > 13.5 && fullMoon < 16.5, "2000-01-21 reads as full moon", `${fullMoon}`);
}

// ─── (b) aftermathFor → parseOutcomeString round-trip (§3, the product's parser) ─
console.log("(b) aftermath outcome strings — verbatim shapes, product parser round-trip");
{
  const T = 20;
  const mk = (vals: (number | null)[]): Float64Array => {
    const h = new Float64Array(T).fill(NaN);
    vals.forEach((v, i) => { if (v !== null) h[i] = v; });
    return h;
  };
  // cooled: low 63 on day 2 → drop 7; rise never ≥ drop
  let s = aftermathOutcome(mk([70, 68, 63, 64, 65, 66, 67, 68]), 0, T);
  assert(s === "cooled 7°F within 2 days", "cooled string verbatim", `${s}`);
  let c = parseOutcomeString(s);
  assert(c.verb === "cooled" && c.magnitude_f === 7 && c.window_days === 2 && !c.thin, "cooled parses");

  // warmed
  s = aftermathOutcome(mk([70, 72, 76, 75, 74, 73, 72, 71]), 0, T);
  assert(s === "warmed 6°F within 2 days", "warmed string verbatim", `${s}`);
  c = parseOutcomeString(s);
  assert(c.verb === "warmed" && c.window_days === 2, "warmed parses");

  // held (within round(max, 1))
  s = aftermathOutcome(mk([70, 71, 72, 69, 70, 71, 72, 71]), 0, T);
  assert(s === "held steady through the week (within 2°F)", "held string verbatim", `${s}`);
  c = parseOutcomeString(s);
  assert(c.verb === "held" && c.window_days === 7, "held parses with window 7 (full-week rule)");

  // tie precedence: maxDrop 6 = maxRise 6 → cooled wins (maxDrop ≥ maxRise)
  s = aftermathOutcome(mk([70, 64, 76, 70, 70, 70, 70, 70]), 0, T);
  assert(s !== null && s.startsWith("cooled 6°F"), "drop/rise tie → cooled (maxDrop ≥ maxRise)", `${s}`);

  // thin: n < 3 recorded followers
  s = aftermathOutcome(mk([70, 68, 66]), 0, T);
  assert(s === "only 2 recorded days follow on file", "thin string verbatim", `${s}`);
  c = parseOutcomeString(s);
  assert(c.verb === null && c.thin, "thin parses to NO claim");

  // first-occurrence day count: min hit twice, lowDays = first (strict <)
  s = aftermathOutcome(mk([70, 63, 65, 63, 70, 70, 70, 70]), 0, T);
  assert(s === "cooled 7°F within 1 day", "days-to-low = FIRST day at the minimum; singular 'day'", `${s}`);

  // n = 0 followers → null outcome (no claim)
  s = aftermathOutcome(mk([70]), 0, 1);
  assert(s === null, "no recorded followers → null outcome");
}

// ─── (c) grading (§5 — hunt-morning-grader semantics) ───────────────────────────
console.log("(c) grading — cooled/warmed windows, held full-7, UNGRADEABLE semantics");
{
  // 8-year flat store, single state; poke aftermath shapes onto specific days
  const store = flatStore(1950, 1957, ["MT"]);
  const h = store.high.get("MT")!;
  const cal = makeCal(store.startIso, store.endIso);
  const d0 = cal.idx("1953-06-15");
  // day d0: cooled 6°F on day +2, then recovery
  h[d0 + 2] = 64;
  // day dMiss: nothing moves (flat)
  const dMiss = cal.idx("1953-07-15");
  // day dHole: hole at +1..+3 (no hit in window 3)
  const dHole = cal.idx("1953-08-15");
  h[dHole + 1] = NaN; h[dHole + 2] = NaN; h[dHole + 3] = NaN;
  // day dHitHole: hit at +1 AND a hole at +2 — a hit stands (grader verbatim)
  const dHitHole = cal.idx("1953-09-15");
  h[dHitHole + 1] = 63; h[dHitHole + 2] = NaN;
  // day dBreach: held-breach on day +6
  const dBreach = cal.idx("1953-10-15");
  h[dBreach + 6] = 78;
  // day dHeldHole: no breach, hole at +5
  const dHeldHole = cal.idx("1954-03-15");
  h[dHeldHole + 5] = NaN;

  const env = buildEnv(store);
  const S = env.st[0];
  assert(gradeClaim(S, d0, 1, 3) === 1, "cooled claim window 3: drop 6 at +2 → HIT");
  assert(gradeClaim(S, d0, 1, 1) === 0, "cooled claim window 1: no drop at +1, no holes → MISS");
  assert(gradeClaim(S, d0, 2, 7) === 0, "warmed claim: the ground cooled → MISS");
  assert(gradeClaim(S, dMiss, 1, 7) === 0, "cooled claim on flat week, no holes → MISS");
  assert(gradeClaim(S, dHole, 1, 3) === 2, "cooled claim: window all holes, no hit → UNGRADEABLE");
  assert(gradeClaim(S, dHole, 1, 7) === 2, "cooled claim window 7: holes inside, no hit → UNGRADEABLE");
  assert(gradeClaim(S, dHitHole, 1, 3) === 1, "a hit stands even with window holes (grader verbatim)");
  assert(gradeClaim(S, dBreach, 3, 3) === 0, "held ignores the claim window: breach on day 6 → MISS (full-7 rule)");
  assert(gradeClaim(S, dMiss, 3, 7) === 1, "held on a flat clean week → HIT");
  assert(gradeClaim(S, dHeldHole, 3, 7) === 2, "held with no breach but a week hole → UNGRADEABLE");
  // era edge: last days of the store have holes beyond the edge
  const dEdge = env.T - 3;
  assert(gradeClaim(S, dEdge, 1, 7) === 2, "era edge: missing trailing days → UNGRADEABLE (counted, dropped)");
}

// ─── (d) LOYO baselines (D2) and the 5-year floor ───────────────────────────────
console.log("(d) LOYO baseline — symmetric leave-index-year-out, MIN_YEARS floor");
{
  // 6 whole years: LOYO count = 5 = MIN_YEARS → baselines computable
  const store6 = flatStore(1950, 1955, ["MT"]);
  const env6 = buildEnv(store6);
  const r6 = evalReplicate(env6, null, { predicate: "lineup", guardDays: GUARD_DAYS, detail: true });
  assert(r6.funnel.withBaseline > 0, "6 years → LOYO count 5 meets the ≥5-year floor", JSON.stringify(r6.funnel));

  // 5 whole years: LOYO count = 4 < 5 → NO index day has a computable baseline
  const store5 = flatStore(1950, 1954, ["MT"]);
  const env5 = buildEnv(store5);
  const r5 = evalReplicate(env5, null, { predicate: "lineup", guardDays: GUARD_DAYS });
  assert(r5.funnel.withHigh > 0 && r5.funnel.withBaseline === 0,
    "5 years → LOYO count 4 fails the floor everywhere (D2 excludes the index year)", JSON.stringify(r5.funnel));

  // LOYO mean excludes the index year's own value: poke one hot index day —
  // near-normal anomaly must be computed against the OTHER years only.
  const store = flatStore(1950, 1957, ["MT"]);
  const cal = makeCal(store.startIso, store.endIso);
  const d = cal.idx("1953-06-15");
  store.high.get("MT")![d] = 71.4; // LOYO mean stays 70 → anomToday = +1.4 (near-normal branch)
  const env = buildEnv(store);
  const one = evalReplicate(env, null, { predicate: "lineup", guardDays: GUARD_DAYS, detail: true, only: { state: 0, day: d } });
  assert(one.funnel.withBaseline === 1, "poked day still baseline-eligible");
  // all pool days are anom 0 (< 2) and anomToday 1.4 (< 2) → near-normal branch matches ALL pool
  assert(one.s6.lN + one.s6.nN === 7 * 7, "pool = 7 other years × 7 offsets, all anomaly-matched (near-normal)",
    `${one.s6.lN}+${one.s6.nN}`);
}

// ─── (e) tide: 60-joint-day floor, argmax + id-asc tie-break, mode fallback ─────
console.log("(e) tide — useTide floor 60, argmax station (ties id asc), mode fallback");
{
  const y0 = 1950, y1 = 1957;
  const T = totalDays(y0, y1);
  // station b-full covers every day; a-thin covers nothing → argmax = b-full
  const stThin = station("a-thin", T, () => NaN);
  const stFull = station("b-full", T, 0.1);
  const store = flatStore(y0, y1, ["TX"], 70, { TX: [stFull, stThin] });
  const env = buildEnv(store);
  const tc = tideChoiceFor(env, 0, null)!;
  const q0 = env.mdOfDay[env.cal.idx("1953-06-15")];
  assert(env.st[0].stations[tc.st[q0]].id === "b-full", "argmax: fuller station chosen",
    env.st[0].stations[tc.st[q0]]?.id);
  assert(tc.cnt[q0] === 8 * 14, "window count = 8 years × 14 days (−3..+10)", `${tc.cnt[q0]}`);

  // tie-break: equal coverage → station id asc
  const stA = station("a-st", T, 0.1);
  const stB = station("b-st", T, 0.1);
  const store2 = flatStore(y0, y1, ["TX"], 70, { TX: [stB, stA] });
  const env2 = buildEnv(store2);
  const tc2 = tideChoiceFor(env2, 0, null)!;
  assert(env2.st[0].stations[tc2.st[q0]].id === "a-st", "coverage tie → station id asc",
    env2.st[0].stations[tc2.st[q0]]?.id);

  // mode: full-coverage gauge → moon_tide_temp on every paired day
  const d = env.cal.idx("1953-06-15");
  const one = evalReplicate(env, null, { predicate: "lineup", guardDays: GUARD_DAYS, detail: true, only: { state: 0, day: d } });
  assert(one.detail!.modePaired[0] === one.paired && one.paired === 1,
    "full gauge → mode moon_tide_temp", JSON.stringify(one.detail!.modePaired));

  // floor: gauge with < 60 window days → moon_temp fallback
  const sparse = station("c-sparse", T, (dd) => (dd % 97 === 0 ? 0.1 : NaN)); // ~3-4 days per md window
  const store3 = flatStore(y0, y1, ["TX"], 70, { TX: [sparse] });
  const env3 = buildEnv(store3);
  const one3 = evalReplicate(env3, null, { predicate: "lineup", guardDays: GUARD_DAYS, detail: true, only: { state: 0, day: d } });
  assert(one3.detail!.modePaired[1] === one3.paired && one3.paired === 1,
    "sparse gauge (< 60 joint days) → moon_temp fallback", JSON.stringify(one3.detail!.modePaired));

  // floor: ≥ 60 window days but NO reading in [d−3, d] → tide_today null → moon_temp
  const oldOnly = station("d-old", T, (dd) => (dd < totalDays(y0, y0 + 4) ? 0.1 : NaN)); // 1950–54 only (5y × 14d = 70 ≥ 60)
  const store4 = flatStore(y0, y1, ["TX"], 70, { TX: [oldOnly] });
  const env4 = buildEnv(store4);
  const d4 = env4.cal.idx("1956-06-15"); // index day past the gauge's era: coverage yes, tide_today no
  const one4 = evalReplicate(env4, null, { predicate: "lineup", guardDays: GUARD_DAYS, detail: true, only: { state: 0, day: d4 } });
  const tc4 = tideChoiceFor(env4, 0, null)!;
  assert(tc4.cnt[q0] >= LINEUP_MIN_TIDE_DAYS, "window coverage clears 60 (old years hold readings)", `${tc4.cnt[q0]}`);
  assert(one4.detail!.modePaired[1] === one4.paired && one4.paired === 1,
    "no reading in [d−3, d] → tide_today null → moon_temp despite coverage", JSON.stringify(one4.detail!.modePaired));

  // pool tide-presence: when useTide, pool days need a reading at the chosen
  // station — 1953 index day with gauge live only in 1950–51: not useTide,
  // so the pool is NOT tide-filtered (verified by the near-normal count)
  assert(one4.s6.lN + one4.s6.nN === 7 * 7, "moon_temp pool is not tide-filtered", `${one4.s6.lN + one4.s6.nN}`);
  // and with the full gauge: useTide, every pool day has a reading → same size
  assert(one.s6.lN + one.s6.nN === 7 * 7, "full-gauge pool: every day carries a reading", `${one.s6.lN + one.s6.nN}`);
}

// ─── (f) pool-year semantics (§3) + the ±10d anti-leakage guard (D4) ────────────
console.log("(f) pool — calendar year(d) excluded; guard bites Dec/Jan cross-boundary days");
{
  const store = flatStore(1950, 1957, ["MT"]);
  const env = buildEnv(store);
  const d = env.cal.idx("1953-12-31");
  // Registered pool for d = 1953-12-31 (flat store: near-normal matches all,
  // so pool size = s6.lN + s6.nN). Per anchor-year window (md 12-31 ± 3):
  //   1950/1951/1954/1955/1956 → 7 days each (their cross-boundary Jan 1–3
  //     days belong to years ≠ 1953 and sit ~1yr from d — admitted);
  //   1952 → 4 (Dec 28–31 1952; Jan 1–3 1953 are year(d) days — excluded);
  //   1953 → Dec 28–31 1953 excluded (year(d)); Jan 1–3 1954 admitted by the
  //     year rule but 1–3 calendar days from d: GUARDED in the primary,
  //     ADMITTED in S7 (guard 0) — the A2 leakage the guard exists to remove;
  //   1957 → 4 (Jan 1–3 1958 are off-store).
  const poolAt = (guardDays: number): number => {
    const s6 = evalReplicate(env, null, { predicate: "lineup", guardDays, only: { state: 0, day: d } }).s6;
    return s6.lN + s6.nN;
  };
  assert(poolAt(GUARD_DAYS) === 43, "guarded pool = 43 (year(d) days out, Dec/Jan adjacents guarded)", `${poolAt(GUARD_DAYS)}`);
  assert(poolAt(0) === 46, "S7 (guard 0) admits the 3 leaky Jan 1–3 year(d)+1 days — S7 ≠ primary", `${poolAt(0)}`);
  assert(poolAt(7) === 43 && poolAt(14) === 43,
    "S8 ±7/±14 ≡ ±10 here — every cross-boundary adjacent sits ≤ 4 calendar days out (structural, not dead code)");

  // mid-year day: no boundary in reach → all guards identical, pool 7y × 7d
  const dMid = env.cal.idx("1953-06-15");
  const poolMid = (g: number): number => {
    const s6 = evalReplicate(env, null, { predicate: "lineup", guardDays: g, only: { state: 0, day: dMid } }).s6;
    return s6.lN + s6.nN;
  };
  assert(poolMid(GUARD_DAYS) === 49 && poolMid(0) === 49, "mid-year pool = 7 other years × 7 offsets, guard moot");

  // LOYO baseline (D2) excludes year(d)-CALENDAR values per offset: for
  // d = 1953-12-31 the offset +3 column's year(d) value is Jan 3 1953
  // (reached only from the 1952 anchor). Poke it hot — the baseline must not
  // move, so the offset +3 candidates stay near-normal-matched and the pool
  // stays 43. (If the code subtracted the yi-window's Jan 3 1954 instead, the
  // 170°F value would drag the mean to ~84°F and drop all 5 offset-+3
  // candidates from the pool.)
  const poked = flatStore(1950, 1957, ["MT"]);
  poked.high.get("MT")![env.cal.idx("1953-01-03")] = 170;
  const envP = buildEnv(poked);
  const s6P = evalReplicate(envP, null, { predicate: "lineup", guardDays: GUARD_DAYS, only: { state: 0, day: d } }).s6;
  assert(s6P.lN + s6P.nN === 43,
    "poked Jan 3 1953 (a year(d) value) is excluded from the offset baseline — pool unchanged",
    `${s6P.lN + s6P.nN}`);
}

// ─── (g) precedent = most-recent match (matches[0] verbatim, date desc) ─────────
console.log("(g) precedent pick — most recent per arm drives the quoted claim");
{
  const y0 = 1950, y1 = 1957;
  const store = flatStore(y0, y1, ["MT"]);
  const cal = makeCal(store.startIso, store.endIso);
  // Scan June–August 1953 index days for a clean construction: the most
  // recent moon-matched candidate p* (year Y*), at least one matched candidate
  // in an OLDER year (so quoting the wrong year is detectable), and the most
  // recent NON-matched candidate pN comfortably later than every poke.
  let d = -1, pStar = -1, pN = -1, pStarYear = 0;
  outer: for (let doy = 0; doy < 92; doy++) {
    const cand = cal.idx("1953-06-01") + doy;
    const ageD = moonAgeOnDate(isoOf(y0, cand));
    let best = -1, bestN = -1;
    let matchedYears = new Set<number>();
    for (let y = y0; y <= y1; y++) {
      if (y === 1953) continue;
      const base = cal.idx(isoOf(y0, cand).replace("1953", String(y)));
      for (let off = -3; off <= 3; off++) {
        const p = base + off;
        const ok = moonAgeDist(moonAgeOnDate(isoOf(y0, p)), ageD) <= 2;
        if (ok) { matchedYears.add(y); if (p > best) best = p; }
        else if (p > bestN) bestN = p;
      }
    }
    if (best >= 0 && bestN > best + 9 && matchedYears.size >= 2) {
      d = cand; pStar = best; pN = bestN;
      pStarYear = Number(isoOf(y0, best).slice(0, 4));
      break outer;
    }
  }
  assert(d >= 0, "found a clean construction day", `d=${d}`);
  const h = store.high.get("MT")!;
  h[pStar + 2] = 64; // p* (and only same-run neighbors) claims "cooled 6°F within 2 days"; older-year L members claim held
  h[d + 2] = 64;     // the index day itself cooled — only a recent-run pick HITs
  const env = buildEnv(store);
  const one = evalReplicate(env, null, { predicate: "lineup", guardDays: GUARD_DAYS, detail: true, only: { state: 0, day: d } });
  assert(one.paired === 1, "the constructed day pairs", JSON.stringify(one.funnel));
  assert(one.detail!.verbMixL[0] === 1, "L quotes the MOST RECENT match (cooled), not an older-year held",
    JSON.stringify(one.detail!.verbMixL));
  assert(one.detail!.vintageMedianYearL === pStarYear, "L precedent vintage = the most recent matched year",
    `${one.detail!.vintageMedianYearL} vs ${pStarYear}`);
  assert(one.hitL === 1, "cooled precedent verified against the index day's own week");
  assert(one.detail!.verbMixN[2] === 1 && one.hitN === 0,
    "N quotes its own most-recent (held) and MISSes the 6°F move", JSON.stringify(one.detail!.verbMixN));
  approx(one.delta, 1.0, 1e-12, "paired Δ contribution = Hit_L − Hit_N = 1");
}

// ─── (h) rotations (§7) — offsets, calendar mapping, composition ────────────────
console.log("(h) rotations — 64 offsets (Metonic ghosts out), Feb 29 → 28, wrap, compose");
{
  assert(ROTATION_OFFSETS.length === 64 && N_ROTATIONS === 64, "exactly 64 rotation replicates");
  assert(ROTATION_OFFSETS[0] === 5 && ROTATION_OFFSETS[ROTATION_OFFSETS.length - 1] === 71, "offsets span 5..71");
  assert(!ROTATION_OFFSETS.includes(19) && !ROTATION_OFFSETS.includes(38) && !ROTATION_OFFSETS.includes(57),
    "Metonic ghosts {19, 38, 57} excluded");
  assert(ROTATION_OFFSETS.includes(20) && ROTATION_OFFSETS.includes(37), "neighbors of the ghosts stay in");

  const cal = makeCal("1950-01-01", "1957-12-31");
  const rm3 = makeRemap(cal, 3);
  assert(rm3[cal.idx("1950-06-15")] === cal.idx("1953-06-15"), "offset 3: 1950-06-15 reads 1953-06-15");
  assert(rm3[cal.idx("1956-06-15")] === cal.idx("1951-06-15"), "wrap on the year axis: 1956 + 3 → 1951");
  const rm1 = makeRemap(cal, 1);
  assert(rm1[cal.idx("1952-02-29")] === cal.idx("1953-02-28"), "Feb 29 → Feb 28 in a non-leap target");
  const rm8 = makeRemap(cal, 8);
  let identity = true;
  for (let i = 0; i < cal.total; i++) if (rm8[i] !== i) { identity = false; break; }
  assert(identity, "offset ≡ 0 (mod yearSpan) is the identity remap");
  const composed = composeRemap(rm3, rm1);
  assert(composed[cal.idx("1950-06-15")] === cal.idx("1954-06-15"), "composeRemap stacks the G2 shift");

  // rotation ≡ identity reproduces the observed statistic byte-for-byte
  const store = flatStore(1950, 1957, ["MT"]);
  const env = buildEnv(store);
  const obs = evalReplicate(env, null, { predicate: "lineup", guardDays: GUARD_DAYS });
  const rotId = evalReplicate(env, rm8, { predicate: "lineup", guardDays: GUARD_DAYS });
  assert(JSON.stringify(obs) === JSON.stringify(rotId), "identity rotation ≡ observed (ground fixed, worlds aligned)");
}

// ─── (i) spot-live bookkeeping (parity mode ≠ retro semantics) ──────────────────
console.log("(i) spotLiveLineup — deployed bookkeeping: defendant exclusion, counts");
{
  const y0 = 1950, y1 = 1957;
  const store = flatStore(y0, y1, ["MT"]);
  const env = buildEnv(store);
  const target = "2026-06-15"; // a CURRENT date — beyond the store, spot's own mode
  const r = spotLiveLineup(env, 0, target, 70);
  assert(r.computable, "flat store computes a lineup", r.reason ?? "");
  assert(r.mode === "moon_temp", "inland state falls back to moon_temp", `${r.mode}`);
  assert(r.n_days_searched === 7 * 7, "searched = 7 non-defendant years × 7 offsets (defendant year excluded from the POOL)",
    `${r.n_days_searched}`);
  assert(r.n_years === 7, "n_years counts non-defendant years", `${r.n_years}`);
  // expected matches: near-normal (anom 0 everywhere) → every moon-matched day
  const ageT = moonAgeOnDate(target);
  let expMatches = 0, expLast = -1;
  for (let y = y0; y <= y1 - 1; y++) { // defendant = 1957 (most recent recorded 06-15)
    const base = env.cal.idx(`${y}-06-15`);
    for (let off = -3; off <= 3; off++) {
      const p = base + off;
      if (moonAgeDist(moonAgeOnDate(isoOf(y0, p)), ageT) <= 2) { expMatches++; if (p > expLast) expLast = p; }
    }
  }
  assert(r.n_matches === expMatches, "n_matches = moon-matched pool days (near-normal temp matches all)",
    `${r.n_matches} vs ${expMatches}`);
  assert(r.last_date === (expLast >= 0 ? isoOf(y0, expLast) : null), "last_date = most recent match", `${r.last_date}`);
  assert(r.all_n === 7 && r.all_outcome_n === 0,
    "control: 7 comparable exact days (defendant year excluded), 0 cooled on a flat store",
    `${r.all_n}/${r.all_outcome_n}`);

  // a tide state with a full gauge runs moon_tide_temp in spot-live mode too
  const T = totalDays(y0, y1);
  const store2 = flatStore(y0, y1, ["TX"], 70, { TX: [station("g1", T, 0.1)] });
  const env2 = buildEnv(store2);
  const r2 = spotLiveLineup(env2, 0, target, 70);
  assert(r2.mode === "moon_tide_temp" && r2.tide_station_id === "g1", "gauge state runs moon_tide_temp", `${r2.mode}`);
}

// ─── (j) McNemar helper (descriptive) ───────────────────────────────────────────
console.log("(j) McNemar — descriptive one-sided normal approximation");
{
  approx(mcnemarOneSided(100, 100), 0.5, 1e-9, "b = c → p = 0.5");
  assert(mcnemarOneSided(0, 0) === 1, "no discordant pairs → p = 1");
  assert(mcnemarOneSided(750, 250) < 1e-6, "strong asymmetry crushes the 1e-6 bar");
  assert(mcnemarOneSided(250, 750) > 0.999, "deficit direction goes to 1");
  const p1 = mcnemarOneSided(60, 30);
  assert(p1 > 1e-6 && p1 < 0.01, "moderate asymmetry in the sane range", `${p1}`);
}

// ─── (k) G0 predicate swap — regression to the mean is detectable ───────────────
console.log("(k) G0 — anomaly-matched precedents transfer on an AR(1) ground");
{
  const store = signalStore(1950, 1969, ["MT"], { dipF: 0, arSd: 4, seed: 11 });
  const env = buildEnv(store);
  const g0 = evalReplicate(env, null, { predicate: "g0", guardDays: GUARD_DAYS });
  const p = mcnemarOneSided(g0.disc.b, g0.disc.c);
  assert(g0.paired > 3000, "G0 pairs in bulk", `${g0.paired}`);
  assert(g0.delta !== null && g0.delta >= 0.02, "Δ_pos ≥ +2.0pp (regression to the mean detected)", `${g0.delta}`);
  assert(p <= 1e-6, "descriptive McNemar p ≤ 1e-6", `${p}`);
}

// ─── (l) E2E: PLANTED moon-coupled archive must CERTIFY (§8 firewall) ───────────
console.log("(l) E2E planted — moon-coupled cooling certifies through the full pipeline");
{
  // 74-year store: offsets 5..71 are ALL non-identity (a shorter span would
  // hand the null its own echo — the same law as the fusion sibling's fixture)
  const store = signalStore(1950, 2023, ["MT", "TX"], { dipF: 12, arSd: 3, seed: 7, tideStates: ["TX"] });
  const t0 = Date.now();
  const res = runLineupRetro(store, { seed: 42, parity: null, loadReceipts: null });
  const p = res.payload;
  console.log(`  (planted end-to-end run: ${((Date.now() - t0) / 1000).toFixed(1)}s; paired ${p.primary.paired}; delta ${p.primary.delta})`);
  assert(p.g0.pass, "G0 passes on the planted archive", `delta=${p.g0.delta} p=${p.g0.mcnemarP}`);
  assert(p.g2.pass, "G2: the primary does NOT certify at rotation offset 3; G0 invariant",
    JSON.stringify({ cert: p.g2.certifiedOnRotated, g0: p.g2.g0UnderRotation.pass }));
  assert(p.g3.pass, "G3: two in-process recomputes byte-identical");
  assert(p.primary.beatsAllRotations, "planted Δ beats all 64 rotations",
    `delta=${p.primary.delta} maxRot=${p.primary.maxRotationDelta}`);
  assert(p.primary.importanceFloorMet && p.primary.delta !== null && p.primary.delta > 0.05,
    "planted effect clears the +2.0pp floor with room", `${p.primary.delta}`);
  assert(p.verdict.certified && p.verdict.final.startsWith("CERTIFIED LIFT"), "verdict: CERTIFIED LIFT", p.verdict.final);
  assert(p.primary.funnel.paired === p.primary.paired, "funnel bottom equals paired n");
  assert(p.diagnostics.pairedByMode[0] > 0 && p.diagnostics.pairedByMode[1] > 0,
    "both modes exercised (TX gauge, MT inland)", JSON.stringify(p.diagnostics.pairedByMode));
  assert(p.primary.rotations.length === 64, "64 rotation rows in the payload");
  assert(p.secondaries.family.length === 2 + 2 + 3 + 2, "BH family = states + modes + verbs + epochs on this fixture",
    `${p.secondaries.family.length}`);
  assert(!res.report.includes("undefined") && !/\d{4}-\d{2}-\d{2}T\d{2}/.test(res.report),
    "report has no undefined and no timestamps");
}

// ─── (m) E2E: NULL archive must NOT certify ─────────────────────────────────────
console.log("(m) E2E null — no moon coupling: the lineup lane must die");
{
  const store = signalStore(1950, 2023, ["MT"], { dipF: 0, arSd: 3, seed: 7 });
  const t0 = Date.now();
  const res = runLineupRetro(store, { seed: 42, parity: null, loadReceipts: null });
  const p = res.payload;
  console.log(`  (null end-to-end run: ${((Date.now() - t0) / 1000).toFixed(1)}s; paired ${p.primary.paired}; delta ${p.primary.delta})`);
  assert(p.g0.pass, "G0 still passes on the null archive (the harness is valid)", `delta=${p.g0.delta}`);
  assert(!p.verdict.certified, "null archive does NOT certify",
    `delta=${p.primary.delta} beatsAll=${p.primary.beatsAllRotations} floor=${p.primary.importanceFloorMet}`);
  assert(p.verdict.final.startsWith("NO LIFT") || p.verdict.final.startsWith("RUN INVALID") === false,
    "verdict reads NO LIFT", p.verdict.final);
  assert(!p.primary.importanceFloorMet, "null Δ sits under the +2.0pp importance floor", `${p.primary.delta}`);
}

// ─── (n) determinism — same seed, fresh stores → byte-identical JSON ────────────
console.log("(n) determinism — two full runs on fresh stores, identical bytes");
{
  const build = () => signalStore(1950, 1961, ["MT"], { dipF: 12, arSd: 3, seed: 5 });
  const r1 = runLineupRetro(build(), { seed: 42, parity: null, loadReceipts: null });
  const r2 = runLineupRetro(build(), { seed: 42, parity: null, loadReceipts: null });
  assert(r1.json === r2.json, "two runs, same seed, fresh stores → identical JSON",
    `${r1.json.length} vs ${r2.json.length} bytes`);
  assert(r1.payload.g3.pass && r2.payload.g3.pass, "internal G3 passes in both runs");
}

// ─── summary ────────────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? "ALL GREEN" : "FAILURES"} — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
