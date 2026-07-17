/**
 * fusion-formation.test.ts — synthetic-fixture tests for the fusion formation
 * pipeline (REGISTRATION-FUSION-V2.md). Plain asserts, no framework, exits
 * non-zero on any failure. Run: npx tsx scripts/mine/fusion-formation.test.ts
 *
 * DEVELOPMENT FIREWALL (§10): every board here is SYNTHETIC. Nothing in this
 * file touches the network or the production frame store.
 */

import { EffectiveAnchor } from "./anchors";
import { SlotDef, Lut } from "./frames";
import { seededRng } from "./stats";
import {
  FusionInputs,
  FusionStore,
  RollCallEvent,
  buildEnv,
  computeDayData,
  makeCal,
  makeRemap,
  makeRep,
  mergeCrossFamily,
  motionM,
  runFusion,
  runFusionOnce,
  selectControls,
  windowStats,
} from "./fusion-formation";

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

function approx(actual: number | null, expected: number, tol: number, name: string): void {
  assert(
    actual !== null && Number.isFinite(actual) && Math.abs(actual - expected) <= tol,
    name,
    `expected ${expected} ± ${tol}, got ${actual}`
  );
}

// ─── fixture builders ───────────────────────────────────────────────────────────

const DAY_MS = 864e5;
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

function isoDays(startYear: number, endYear: number): string[] {
  const days: string[] = [];
  const end = Date.UTC(endYear, 11, 31);
  for (let t = Date.UTC(startYear, 0, 1); t <= end; t += DAY_MS) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

/** 142 v1-shaped slots across all four lanes: 100 air, 20 water, 12 pressure, 10 climate. */
function makeSlots(): SlotDef[] {
  const slots: SlotDef[] = [];
  let off = 0;
  const push = (inst: string, metric: string) => {
    slots.push({ offset: off++, inst_id: inst, metric, side: "low" });
    slots.push({ offset: off++, inst_id: inst, metric, side: "high" });
  };
  for (let i = 0; i < 50; i++) push(`ghcn-s${String(i).padStart(2, "0")}`, "avg_high_f");
  for (let i = 0; i < 10; i++) push(`tide-t${i}`, "residual_max_ft");
  for (let i = 0; i < 6; i++) push(`buoy-b${i}`, "pressure_mb");
  for (let i = 0; i < 5; i++) push(`needle-n${i}`, "value");
  return slots; // 142
}

function makeLuts(slots: SlotDef[], years = 30): Map<string, Lut> {
  const luts = new Map<string, Lut>();
  const seen = new Set<string>();
  for (const s of slots) {
    const key = `${s.inst_id}|${s.metric}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (let doy = 1; doy <= 366; doy++) {
      luts.set(`${key}|${doy}`, { vals: [], below: [], n: 0, years });
    }
  }
  return luts;
}

/** Baseline frames: byte 100 everywhere, plus seeded deep noise (byte 250) at deepProb. */
function makeFrames(days: string[], deepProb: number, noiseSeed: number): Map<string, Uint8Array> {
  const rng = seededRng(noiseSeed);
  const frames = new Map<string, Uint8Array>();
  for (const day of days) {
    const f = new Uint8Array(142).fill(100);
    if (deepProb > 0) {
      for (let off = 0; off < 142; off++) if (rng() < deepProb) f[off] = 250;
    }
    frames.set(day, f);
  }
  return frames;
}

/** Plant elevated deep-fractions on the 14 pre-onset days (every 3rd slot → F ≈ 0.34). */
function plantSignal(frames: Map<string, Uint8Array>, onset: string): void {
  for (let k = 1; k <= 14; k++) {
    const f = frames.get(addDays(onset, -k));
    if (!f) continue;
    for (let off = 0; off < 142; off += 3) f[off] = 250;
  }
}

let anchorSeq = 0;
function anchor(
  d0: string,
  family: string,
  opts: { states?: string[]; deaths?: number; damageUsd?: number; spanDays?: number } = {}
): EffectiveAnchor {
  const id = `m${anchorSeq++}`;
  const states = opts.states ?? ["TX"];
  return {
    family,
    span: { start: d0, end: addDays(d0, (opts.spanDays ?? 3) - 1) },
    d0,
    states,
    primaryState: states[0],
    memberIds: [id],
    titles: [`event ${id}`],
    rawCount: 1,
    nMembers: 1,
    deaths: opts.deaths ?? 20,
    injuries: 0,
    damageUsd: opts.damageUsd ?? 1e9,
  };
}

const FAMILIES = ["flood", "hail", "heat", "tornado", "tropical", "wind", "winter"];

/** 60 MAJOR anchors at seeded random era dates, pairwise ≥ 45 days apart. */
function makeEraAnchors(n: number, pickSeed: number): EffectiveAnchor[] {
  const eraStart = "1990-03-01";
  const eraDays = Math.round((Date.parse("2021-10-31T00:00:00Z") - Date.parse(`${eraStart}T00:00:00Z`)) / DAY_MS);
  const rng = seededRng(pickSeed);
  const chosen: number[] = [];
  while (chosen.length < n) {
    const idx = Math.floor(rng() * eraDays);
    if (chosen.every((c) => Math.abs(c - idx) >= 45)) chosen.push(idx);
  }
  chosen.sort((a, b) => a - b);
  return chosen.map((c, i) => anchor(addDays(eraStart, c), FAMILIES[i % 7]));
}

function makeStore(days: string[], frames: Map<string, Uint8Array>, slots: SlotDef[], luts: Map<string, Lut>): FusionStore {
  return { version: 0, slots, days, frames, luts };
}

// ─── (h) cross-family merge ─────────────────────────────────────────────────────
console.log("(h) cross-family merge");
{
  const A = anchor("1990-01-01", "flood", { states: ["TX"], deaths: 20 });
  const B = anchor("1990-01-08", "wind", { states: ["TX", "LA"], deaths: 2, damageUsd: 60e6, spanDays: 2 });
  const C = anchor("1990-01-14", "heat", { states: ["LA"], deaths: 0, damageUsd: 1e6, spanDays: 2 });
  const D = anchor("1990-01-10", "tornado", { states: ["MT"], deaths: 12, spanDays: 2 });
  const eps = mergeCrossFamily([A, B, C, D]);
  assert(eps.length === 2, "transitive merge → 2 episodes", `got ${eps.length}`);
  assert(eps[0].onset === "1990-01-01", "onset = earliest member span start", eps[0].onset);
  assert(eps[0].span.end === "1990-01-15", "union span end", eps[0].span.end);
  assert(eps[0].tier === "MAJOR", "tier = max member tier (MAJOR beats SEVERE/ALL)", eps[0].tier);
  assert(
    JSON.stringify(eps[0].families) === JSON.stringify(["flood", "heat", "wind"]),
    "families union sorted",
    JSON.stringify(eps[0].families)
  );
  assert(eps[0].memberIds.length === 3, "3 members merged", `${eps[0].memberIds.length}`);
  assert(
    JSON.stringify(eps[1].families) === JSON.stringify(["tornado"]),
    "state-disjoint anchor stays separate",
    JSON.stringify(eps[1].families)
  );
}

// ─── (c) episode masking (§5) ───────────────────────────────────────────────────
console.log("(c) episode masking — W(a), M(a) reach-back, Test 2 trailing W, scan days");
{
  const slots = makeSlots();
  const luts = makeLuts(slots);
  const days = isoDays(1989, 1991);
  const frames = makeFrames(days, 0, 1); // F = 0 everywhere
  // B's span days carry F ≈ 0.5 — if masking leaks, means go nonzero.
  for (const d of ["1990-06-05", "1990-06-06", "1990-06-07"]) {
    const f = frames.get(d)!;
    for (let off = 0; off < 142; off += 2) f[off] = 250;
  }
  const A = anchor("1990-06-15", "flood", { states: ["TX"], spanDays: 2 });
  const B = anchor("1990-06-05", "winter", { states: ["NY"], spanDays: 3 });
  const inputs: FusionInputs = { store: makeStore(days, frames, slots, luts), rawCount: 2, effective: [A, B] };
  const env = buildEnv(inputs, 42);
  assert(env.episodes.length === 2, "two pooled episodes (disjoint states, gap > 7d)", `${env.episodes.length}`);
  const epA = env.episodes.findIndex((e) => e.onset === "1990-06-15");
  const rep0 = makeRep(env, null);
  const oA = env.cal.idx("1990-06-15");

  const w = windowStats(env, rep0, oA, 14, 1, epA);
  assert(w.total === 14 && w.n === 11, "W(A): B-span days excluded (11 of 14 eligible)", `n=${w.n}`);
  approx(w.mean, 0, 1e-12, "W(A) mean = 0 — B's deep days masked out");

  const m = motionM(env, rep0, oA, epA);
  assert(m.M !== null && Math.abs(m.M) < 1e-12 && m.used >= 10,
    "M(A) = 0 — D-28 reach-back masked under the same rule (D6)", `M=${m.M} used=${m.used}`);

  const dT = env.cal.idx("1990-06-21"); // trailing window 06-07..06-20: B day + A span days masked
  assert(rep0.trailCnt[dT] === 11 && rep0.trailF[dT] === 0,
    "Test 2 trailing W: days inside ANY episode span excluded", `cnt=${rep0.trailCnt[dT]} F=${rep0.trailF[dT]}`);

  assert(env.inMajorSpan[env.cal.idx("1990-06-06")] === 1, "scan day inside an episode span is ineligible");

  const cw = windowStats(env, rep0, env.cal.idx("1990-06-10"), 14, 1, -1);
  assert(cw.n === 11 && cw.mean === 0, "control-window mean: B-span days excluded (mask-all)", `n=${cw.n} mean=${cw.mean}`);
}

// ─── (d) floors (day + window + LUT-years), incl. inside a rotation replicate ───
console.log("(d) floors — day 100/142, window 10/14, LUT years ≥ 10, under rotation");
{
  const slots = makeSlots();
  const luts = makeLuts(slots);
  // slot 0's instrument pool is thin: years 5 → both sides excluded num AND denom
  for (let doy = 1; doy <= 366; doy++) {
    luts.set(`ghcn-s00|avg_high_f|${doy}`, { vals: [], below: [], n: 0, years: 5 });
  }
  const days = isoDays(1989, 1991);
  const frames = makeFrames(days, 0, 2);
  // day floor: 1990-07-06..07-10 report only 99 slots
  for (let k = 0; k < 5; k++) {
    const f = frames.get(addDays("1990-07-06", k))!;
    for (let off = 99; off < 142; off++) f[off] = 255;
  }
  // slot-eligibility: deep byte on the thin-pool slot must not move F
  frames.get("1990-05-01")![0] = 250;
  const A = anchor("1990-07-20", "flood", { states: ["TX"], spanDays: 2 });
  const inputs: FusionInputs = { store: makeStore(days, frames, slots, luts), rawCount: 1, effective: [A] };
  const env = buildEnv(inputs, 42);
  const { dd, cal } = env;

  const dBad = cal.idx("1990-07-07");
  assert(dd.rep[dBad] === 99 && dd.ok[dBad] === 0, "day with 99/142 reporting excluded (floor 100)", `rep=${dd.rep[dBad]}`);

  const dThin = cal.idx("1990-05-01");
  assert(dd.elig[dThin] === 140 && dd.f249[dThin] === 0,
    "LUT pool years < 10 → slot excluded from numerator AND denominator", `elig=${dd.elig[dThin]} F=${dd.f249[dThin]}`);

  const rep0 = makeRep(env, null);
  const w = windowStats(env, rep0, cal.idx("1990-07-20"), 14, 1, 0);
  assert(w.n === 9, "window retains 9 of 14 eligible → below the 10-day floor", `n=${w.n}`);

  const core = runFusionOnce(inputs, { seed: 42, rollCall: [] });
  assert(
    core.test1.episodesDropped === 1 && core.test1.droppedOnsets.includes("1990-07-20"),
    "dropped window is counted AND listed",
    JSON.stringify(core.test1.droppedOnsets)
  );

  // floors inside a rotation replicate: offset 1 on the 3-year store maps 1989 → 1990
  const rm = makeRemap(cal, 1);
  const repR = makeRep(env, rm);
  assert(repR.usable[cal.idx("1989-07-07")] === 0, "day floor enforced on ROTATED frames (floors travel with frames)");
  const wR = windowStats(env, repR, cal.idx("1989-07-20"), 14, 1, -1);
  assert(wR.n === 9, "window floor evaluated identically inside the replicate", `n=${wR.n}`);
}

// ─── (e) rotation — 67 replicates, offsets 5..71 once each, F remap correctness ──
console.log("(e) rotation — exhaustive 67, offsets 5..71, remap correctness on a 3-year store");
{
  const slots = makeSlots();
  const luts = makeLuts(slots);
  const days = isoDays(2019, 2021);
  const frames = makeFrames(days, 0, 3);
  for (const day of days) {
    const y = Number(day.slice(0, 4));
    const f = frames.get(day)!;
    if (y === 2020) for (let off = 0; off < 20; off++) f[off] = 250;
    if (y === 2021) for (let off = 0; off < 40; off++) f[off] = 250;
  }
  const A = anchor("2020-06-15", "flood", { states: ["TX"], spanDays: 2 });
  const inputs: FusionInputs = { store: makeStore(days, frames, slots, luts), rawCount: 1, effective: [A] };
  const env = buildEnv(inputs, 42);
  const { cal, dd } = env;

  const rm1 = makeRemap(cal, 1);
  const d0 = cal.idx("2019-03-05");
  assert(rm1[d0] === cal.idx("2020-03-05"), "offset 1: 2019-03-05 reads 2020-03-05");
  approx(dd.f249[rm1[d0]], 20 / 142, 1e-12, "rotated F value = source year's F (F travels with frames)");
  assert(rm1[cal.idx("2020-02-29")] === cal.idx("2021-02-28"), "Feb 29 → Feb 28 in non-leap target");
  const rm3 = makeRemap(cal, 3);
  assert(rm3[d0] === d0, "offset ≡ 0 (mod yearSpan) is the identity remap");

  const core = runFusionOnce(inputs, { seed: 42, rollCall: [] });
  const offsets = core.test1.rotations.map((r) => r.offset);
  const expect = Array.from({ length: 67 }, (_, i) => i + 5);
  assert(offsets.length === 67, "exactly 67 rotation replicates", `${offsets.length}`);
  assert(JSON.stringify(offsets) === JSON.stringify(expect), "offsets 5..71 each used exactly once");
  const off2 = core.test2.rotations.map((r) => r.offset);
  assert(JSON.stringify(off2) === JSON.stringify(expect), "Test 2 uses the same 67 rotations");
}

// ─── (g) controls — §7 rules i–iii, nearest-year, seeded tie-break stability ────
console.log("(g) controls — eligibility rules, nearest-year selection, tie-break stability");
{
  const slots = makeSlots();
  const luts = makeLuts(slots);
  const days = isoDays(1989, 1993);
  const frames = makeFrames(days, 0, 4);
  // rule i trap: 1993-05-15..1993-06-30 report only 99 slots
  for (let d = "1993-05-15"; d <= "1993-06-30"; d = addDays(d, 1)) {
    const f = frames.get(d)!;
    for (let off = 99; off < 142; off++) f[off] = 255;
  }
  const A = anchor("1991-06-15", "flood", { states: ["TX"], spanDays: 2 }); // the episode under test
  const X = anchor("1990-06-05", "hail", { states: ["NY"], deaths: 0, damageUsd: 1e6, spanDays: 8 }); // any-tier span (not MAJOR)
  const B = anchor("1992-06-20", "wind", { states: ["LA"], spanDays: 2 }); // MAJOR → ±30d mask
  const C = anchor("1990-10-10", "heat", { states: ["TX"], spanDays: 2 }); // MAJOR, no traps nearby
  const inputs: FusionInputs = { store: makeStore(days, frames, slots, luts), rawCount: 4, effective: [A, X, B, C] };
  const env = buildEnv(inputs, 42);
  assert(env.episodes.length === 3, "3 pooled MAJOR episodes (X is not MAJOR)", `${env.episodes.length}`);
  const rep0 = makeRep(env, null);

  const epA = env.episodes.findIndex((e) => e.onset === "1991-06-15");
  const selA = selectControls(env, rep0, epA, false, null);
  assert(selA.chosen.length === 8, "up to 8 controls drawn", `${selA.chosen.length}`);
  assert(selA.chosen.every((c) => env.cal.year[c] === 1990), "all controls from the only eligible year (1990)");
  assert(
    selA.chosen.every((c) => env.cal.iso[c] < "1990-06-05" || env.cal.iso[c] > "1990-06-12"),
    "rule iii: no control inside ANY-tier anchor span"
  );
  assert(selA.eligible === 23, "eligible candidate count (31 − 8 any-tier span days)", `${selA.eligible}`);
  assert(
    selA.rejected.rule1 === 31 && selA.rejected.rule2 === 58 && selA.rejected.rule3 === 12,
    "rule tallies exact: i=31 (window floor), ii=58 (±30d of MAJOR span), iii=12 (span membership)",
    JSON.stringify(selA.rejected)
  );
  const selA2 = selectControls(env, rep0, epA, false, null);
  assert(JSON.stringify(selA.chosen) === JSON.stringify(selA2.chosen), "seeded tie-break is stable across calls");

  const epC = env.episodes.findIndex((e) => e.onset === "1990-10-10");
  const selC = selectControls(env, rep0, epC, false, null);
  assert(
    selC.chosen.length === 8 && selC.chosen.every((c) => env.cal.year[c] === 1991),
    "nearest-year selection: 8 of 8 from the gap-1 year despite gap-2/gap-3 candidates",
    JSON.stringify(selC.chosen.map((c) => env.cal.iso[c]))
  );
}

// ─── shared end-to-end fixtures (74-year store — offsets 5..71 all non-identity) ─
console.log("(a) PLANTED SIGNAL — full pipeline end-to-end must pass BOTH tests");
const SLOTS = makeSlots();
const LUTS = makeLuts(SLOTS);
const E2E_DAYS = isoDays(1950, 2023);
const E2E_ANCHORS = makeEraAnchors(60, 777);
const E2E_ROLLCALL: RollCallEvent[] = [5, 15, 25, 35, 45].map((i) => ({
  name: `planted-${i}`,
  lo: addDays(E2E_ANCHORS[i].d0, -2),
  hi: addDays(E2E_ANCHORS[i].d0, 2),
}));
{
  const frames = makeFrames(E2E_DAYS, 0.02, 5);
  for (const a of E2E_ANCHORS) plantSignal(frames, a.d0);
  const inputs: FusionInputs = {
    store: makeStore(E2E_DAYS, frames, SLOTS, LUTS),
    rawCount: E2E_ANCHORS.length,
    effective: E2E_ANCHORS,
  };
  const t0 = Date.now();
  const res = runFusion(inputs, { seed: 42, rollCall: E2E_ROLLCALL });
  const p = res.payload;
  console.log(`  (planted end-to-end run: ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  assert(p.receipts.mergedEpisodes.pooledEpisodes === 60, "60 pooled episodes", `${p.receipts.mergedEpisodes.pooledEpisodes}`);
  assert(p.g0.pass, "G0 roll call passes on planted signal", JSON.stringify(p.g0.rows.map((r) => [r.name, r.beatsMedian, r.beatsP75])));
  assert(p.g2.pass, "G2: both tests FAIL on the outer-rotated store", JSON.stringify({ t1: p.g2.test1PassOnRotated, t2: p.g2.test2PassOnRotated }));
  assert(p.g3.pass, "G3: two in-process recomputes byte-identical");
  assert(p.test1.pass, "TEST 1 passes — ΔW beats all 67 rotations",
    `dW=${p.test1.dW} maxRot=${p.test1.maxRotationDW}`);
  assert(p.test2.pass, "TEST 2 passes — top decile ≥ 2b and lift beats all 67 rotations",
    `top=${p.test2.topDecileRate} 2b=${p.test2.topDecileBar} lift=${p.test2.lift} maxRot=${p.test2.maxRotationLift}`);
  assert(p.verdict.final.startsWith("FUSION CONFIRMED"), "verdict: FUSION CONFIRMED", p.verdict.final);
  assert(p.test1.dW !== null && p.test1.dW > 0.2, "planted effect size visible (ΔW > 0.2)", `${p.test1.dW}`);
}

console.log("(b) NULL BOARD — no planted signal: both tests must FAIL");
{
  const frames = makeFrames(E2E_DAYS, 0.02, 5); // same noise, no planting
  const inputs: FusionInputs = {
    store: makeStore(E2E_DAYS, frames, SLOTS, LUTS),
    rawCount: E2E_ANCHORS.length,
    effective: E2E_ANCHORS,
  };
  const t0 = Date.now();
  const res = runFusion(inputs, { seed: 42, rollCall: E2E_ROLLCALL });
  const p = res.payload;
  console.log(`  (null end-to-end run: ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  assert(!p.test1.pass, "TEST 1 fails on the null board", `dW=${p.test1.dW} maxRot=${p.test1.maxRotationDW}`);
  assert(!p.test2.pass, "TEST 2 fails on the null board", `top=${p.test2.topDecileRate} 2b=${p.test2.topDecileBar}`);
  assert(!p.verdict.final.startsWith("FUSION CONFIRMED"), "verdict is not FUSION CONFIRMED", p.verdict.final);
}

// ─── (f) determinism — two runs, same seed, fresh inputs → identical JSON ───────
console.log("(f) determinism — same seed twice → byte-identical canonical JSON");
{
  const days = isoDays(1988, 2023);
  const anchors = makeEraAnchors(10, 999);
  const rollCall: RollCallEvent[] = [
    { name: "rc-0", lo: addDays(anchors[0].d0, -2), hi: addDays(anchors[0].d0, 2) },
  ];
  const build = (): FusionInputs => {
    const frames = makeFrames(days, 0.02, 6);
    for (const a of anchors) plantSignal(frames, a.d0);
    return { store: makeStore(days, frames, makeSlots(), makeLuts(makeSlots())), rawCount: 10, effective: anchors };
  };
  const r1 = runFusion(build(), { seed: 42, rollCall });
  const r2 = runFusion(build(), { seed: 42, rollCall });
  assert(r1.json === r2.json, "two runs, same seed, fresh inputs → identical JSON", `${r1.json.length} vs ${r2.json.length} bytes`);
  assert(r1.payload.g3.pass && r2.payload.g3.pass, "internal G3 passes in both runs");
  assert(!r1.report.includes("undefined") && !/\d{4}-\d{2}-\d{2}T/.test(r1.report), "report has no undefined and no timestamps");
}

// ─── summary ────────────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? "ALL GREEN" : "FAILURES"} — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
