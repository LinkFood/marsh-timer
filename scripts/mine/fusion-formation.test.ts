/**
 * fusion-formation.test.ts — synthetic-fixture tests for the fusion formation
 * pipeline (REGISTRATION-FUSION-V2.md INCLUDING the v2.1 amendment: tested
 * anchors = raw MAJOR member rows, same-system dedup, MAJOR-row-span masking).
 * Plain asserts, no framework, exits non-zero on any failure.
 * Run: npx tsx scripts/mine/fusion-formation.test.ts
 *
 * DEVELOPMENT FIREWALL (§10): every board here is SYNTHETIC. Nothing in this
 * file touches the network or the production frame store.
 */

import { Anchor } from "./anchors";
import { SlotDef, Lut } from "./frames";
import { seededRng } from "./stats";
import {
  FusionInputs,
  FusionStore,
  RollCallEvent,
  buildEnv,
  computeDayData,
  dedupeSameSystem,
  isMajorRow,
  makeCal,
  makeRemap,
  makeRep,
  motionM,
  runFusion,
  runFusionOnce,
  selectControls,
  severityScore,
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

/** One raw stitched-event MEMBER ROW (v2.1 anchor path). Defaults are MAJOR. */
let anchorSeq = 0;
function row(
  d0: string,
  family: string,
  opts: { id?: string; states?: string[]; deaths?: number; damageUsd?: number; spanDays?: number } = {}
): Anchor {
  const id = opts.id ?? `m${String(anchorSeq++).padStart(4, "0")}`;
  const states = opts.states ?? ["TX"];
  return {
    id,
    title: `event ${id}`,
    family,
    primaryState: states[0],
    states,
    span: { start: d0, end: addDays(d0, (opts.spanDays ?? 3) - 1) },
    d0,
    nMembers: 1,
    deaths: opts.deaths ?? 20,
    injuries: 0,
    damageUsd: opts.damageUsd ?? 1e9,
  };
}

const FAMILIES = ["flood", "hail", "heat", "tornado", "tropical", "wind", "winter"];

/** n MAJOR rows at seeded random era dates, pairwise ≥ 45 days apart. */
function makeEraAnchors(n: number, pickSeed: number): Anchor[] {
  const eraStart = "1990-03-01";
  const eraDays = Math.round((Date.parse("2021-10-31T00:00:00Z") - Date.parse(`${eraStart}T00:00:00Z`)) / DAY_MS);
  const rng = seededRng(pickSeed);
  const chosen: number[] = [];
  while (chosen.length < n) {
    const idx = Math.floor(rng() * eraDays);
    if (chosen.every((c) => Math.abs(c - idx) >= 45)) chosen.push(idx);
  }
  chosen.sort((a, b) => a - b);
  return chosen.map((c, i) => row(addDays(eraStart, c), FAMILIES[i % 7]));
}

function makeStore(days: string[], frames: Map<string, Uint8Array>, slots: SlotDef[], luts: Map<string, Lut>): FusionStore {
  return { version: 0, slots, days, frames, luts };
}

// ─── (h) same-system dedup (v2.1 clause 2) ──────────────────────────────────────
console.log("(h) same-system dedup — union-find, spans OVERLAP AND states intersect");
{
  // MAJOR bar on the row's own severity fields (clause 1)
  assert(isMajorRow({ deaths: 10, damageUsd: 0 }), "deaths ≥ 10 is MAJOR");
  assert(isMajorRow({ deaths: 0, damageUsd: 250e6 }), "damage ≥ $250M is MAJOR");
  assert(!isMajorRow({ deaths: 9, damageUsd: 249e6 }), "below both bars is not MAJOR");
  approx(severityScore({ deaths: 20, damageUsd: 1e9 }), 3000, 1e-9, "severity = deaths×100 + damageUsd/$1M");

  // keep-max-severity: B (5000) outranks A (3000) despite the later d0
  const A = row("1990-01-01", "flood", { id: "r-flood", states: ["TX"], deaths: 20, damageUsd: 1e9, spanDays: 5 });
  const B = row("1990-01-03", "wind", { id: "r-wind", states: ["TX", "LA"], deaths: 50, damageUsd: 0, spanDays: 3 });
  const g1 = dedupeSameSystem([A, B]);
  assert(g1.length === 1, "overlapping + state-intersecting rows → one group", `${g1.length}`);
  assert(g1[0].keeper.id === "r-wind", "keeper = max severity", g1[0].keeper.id);
  assert(g1[0].keeper.d0 === "1990-01-03", "tested onset = the KEPT ROW's own d0, not group-earliest", g1[0].keeper.d0);
  assert(g1[0].group.length === 2, "group receipt holds both rows", `${g1[0].group.length}`);

  // severity tie → earliest d0
  const C = row("1990-02-03", "hail", { id: "r-c", deaths: 10, damageUsd: 0, spanDays: 3 });
  const D = row("1990-02-01", "wind", { id: "r-d", deaths: 10, damageUsd: 0, spanDays: 4 });
  const g2 = dedupeSameSystem([C, D]);
  assert(g2.length === 1 && g2[0].keeper.id === "r-d", "severity tie → earliest d0 kept", g2[0]?.keeper.id);

  // severity + d0 tie → lexicographic id
  const E = row("1990-03-01", "heat", { id: "r-z", deaths: 10, damageUsd: 0, spanDays: 2 });
  const F = row("1990-03-01", "wind", { id: "r-a", deaths: 10, damageUsd: 0, spanDays: 2 });
  const g3 = dedupeSameSystem([E, F]);
  assert(g3.length === 1 && g3[0].keeper.id === "r-a", "severity + d0 tie → lexicographic id", g3[0]?.keeper.id);

  // OVERLAP only — a ±6d gap does NOT group (the v2.0 season-chain fuse is gone)
  const G = row("1990-04-01", "winter", { spanDays: 3 }); // ends 04-03
  const H = row("1990-04-09", "winter", { spanDays: 3 }); // starts 6d later
  assert(dedupeSameSystem([G, H]).length === 2, "±6d-apart same-family rows do NOT dedup (overlap required)");

  // boundary: sharing a single day IS overlap
  const I = row("1990-05-01", "flood", { spanDays: 3 }); // ends 05-03
  const J = row("1990-05-03", "wind", { spanDays: 2 }); // starts 05-03
  assert(dedupeSameSystem([I, J]).length === 1, "spans sharing one day overlap → one group");

  // state-disjoint overlap stays separate
  const K = row("1990-06-01", "flood", { states: ["TX"], spanDays: 4 });
  const L = row("1990-06-02", "wind", { states: ["MT"], spanDays: 4 });
  assert(dedupeSameSystem([K, L]).length === 2, "overlapping but state-disjoint rows stay separate");

  // transitivity: a bridge row closes a chain into ONE group
  const P = row("1990-07-01", "flood", { id: "r-p", states: ["TX"], deaths: 12, damageUsd: 0, spanDays: 2 }); // 07-01..02
  const Q = row("1990-07-02", "winter", { id: "r-q", states: ["TX", "OK"], deaths: 30, damageUsd: 0, spanDays: 3 }); // 07-02..04
  const R = row("1990-07-04", "wind", { id: "r-r", states: ["OK"], deaths: 11, damageUsd: 0, spanDays: 2 }); // 07-04..05
  const g4 = dedupeSameSystem([P, Q, R]);
  assert(g4.length === 1 && g4[0].group.length === 3, "union-find transitive closure via bridge row", `groups=${g4.length}`);
  assert(g4[0].keeper.id === "r-q", "chain keeper = max severity", g4[0]?.keeper.id);
}

// ─── per-row severity guard (v2.1 clause 1) ─────────────────────────────────────
console.log("(s) per-row severity — missing severity FAILS LOUDLY, no improvisation");
{
  const slots = makeSlots();
  const luts = makeLuts(slots);
  const days = isoDays(1989, 1991);
  const frames = makeFrames(days, 0, 11);
  const store = makeStore(days, frames, slots, luts);
  const good = row("1990-06-15", "flood");

  const badNaN = row("1990-08-01", "wind");
  (badNaN as any).damageUsd = NaN;
  let threw = "";
  try {
    buildEnv({ store, raw: [good, badNaN] }, 42);
  } catch (e: any) {
    threw = String(e?.message ?? e);
  }
  assert(threw.includes("PER-ROW SEVERITY MISSING"), "NaN damageUsd → loud failure", threw || "(no throw)");

  const badAbsent = row("1990-08-01", "wind");
  delete (badAbsent as any).deaths;
  let threw2 = "";
  try {
    buildEnv({ store, raw: [good, badAbsent] }, 42);
  } catch (e: any) {
    threw2 = String(e?.message ?? e);
  }
  assert(threw2.includes("PER-ROW SEVERITY MISSING"), "absent deaths field → loud failure", threw2 || "(no throw)");

  assert(buildEnv({ store, raw: [good] }, 42).tested.length === 1, "clean per-row severity proceeds");
}

// ─── (c) masking (v2.1 clause 3) ────────────────────────────────────────────────
console.log("(c) masking — W(a), M(a) reach-back, Test 2 trailing W, scan days");
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
  const A = row("1990-06-15", "flood", { states: ["TX"], spanDays: 2 });
  const B = row("1990-06-05", "winter", { states: ["NY"], spanDays: 3 });
  const inputs: FusionInputs = { store: makeStore(days, frames, slots, luts), raw: [A, B] };
  const env = buildEnv(inputs, 42);
  assert(env.tested.length === 2, "two tested anchors (disjoint states and dates)", `${env.tested.length}`);
  const eA = env.tested.findIndex((t) => t.d0 === "1990-06-15");
  const rep0 = makeRep(env, null);
  const oA = env.cal.idx("1990-06-15");

  const w = windowStats(env, rep0, oA, 14, 1, env.tested[eA].rowIdx);
  assert(w.total === 14 && w.n === 11, "W(A): B's MAJOR row span days excluded (11 of 14 eligible)", `n=${w.n}`);
  approx(w.mean, 0, 1e-12, "W(A) mean = 0 — B's deep days masked out");

  const m = motionM(env, rep0, oA, env.tested[eA].rowIdx);
  assert(m.M !== null && Math.abs(m.M) < 1e-12 && m.used >= 10,
    "M(A) = 0 — D-28 reach-back masked under the same rule (D6)", `M=${m.M} used=${m.used}`);

  const dT = env.cal.idx("1990-06-21"); // trailing window 06-07..06-20: B day + A span days masked
  assert(rep0.trailCnt[dT] === 11 && rep0.trailF[dT] === 0,
    "Test 2 trailing W: days inside ANY MAJOR row span excluded", `cnt=${rep0.trailCnt[dT]} F=${rep0.trailF[dT]}`);

  assert(env.inMajorSpan[env.cal.idx("1990-06-06")] === 1, "scan day inside a MAJOR row span is ineligible");

  const cw = windowStats(env, rep0, env.cal.idx("1990-06-10"), 14, 1, -1);
  assert(cw.n === 11 && cw.mean === 0, "control-window mean: B-span days excluded (mask-all)", `n=${cw.n} mean=${cw.mean}`);
}

// ─── (c2) masking excludes chain-mate spans (v2.1 clauses 2+3 together) ─────────
console.log("(c2) masking — chain-mate MAJOR row spans never count as formation");
{
  const slots = makeSlots();
  const luts = makeLuts(slots);
  const days = isoDays(1989, 1991);
  const frames = makeFrames(days, 0, 12); // F = 0 everywhere
  // deep bytes on the chain-mate's pre-keeper span days — a leak makes W(K) nonzero
  for (const d of ["1990-06-01", "1990-06-02"]) {
    const f = frames.get(d)!;
    for (let off = 0; off < 142; off += 2) f[off] = 250;
  }
  const J = row("1990-06-01", "winter", { id: "r-j", states: ["TX"], deaths: 15, damageUsd: 0, spanDays: 3 }); // 06-01..03, chain-mate
  const K = row("1990-06-03", "winter", { id: "r-k", states: ["TX"], deaths: 40, damageUsd: 0, spanDays: 4 }); // 06-03..06, keeper
  const L = row("1990-06-20", "flood", { id: "r-l", states: ["TX"], spanDays: 2 }); // separate system
  const inputs: FusionInputs = { store: makeStore(days, frames, slots, luts), raw: [J, K, L] };
  const env = buildEnv(inputs, 42);
  assert(env.tested.length === 2, "chain dedups to one tested anchor + L", `${env.tested.length}`);
  const eK = env.tested.findIndex((t) => t.id === "r-k");
  assert(eK >= 0 && env.tested[eK].d0 === "1990-06-03" && env.tested[eK].groupSize === 2,
    "keeper = r-k at its OWN d0, dedup group of 2", JSON.stringify(env.tested.map((t) => [t.id, t.d0, t.groupSize])));
  assert(env.receipts.majorRows === 3 && env.receipts.tested === 2,
    "receipt: 3 raw MAJOR rows → 2 deduped tested anchors", JSON.stringify(env.receipts));

  const rep0 = makeRep(env, null);
  const wK = windowStats(env, rep0, env.cal.idx("1990-06-03"), 14, 1, env.tested[eK].rowIdx);
  assert(wK.total === 14 && wK.n === 12, "W(K): chain-mate span days 06-01/06-02 masked (12 of 14)", `n=${wK.n}`);
  approx(wK.mean, 0, 1e-12, "W(K) mean = 0 — chain-mate deep days never count as formation");

  // self-exemption covers ONLY days where the own row is the sole cover:
  // window 05-27..06-09 with self=K → 06-01/02 (J) and 06-03 (J∩K overlap) masked, 06-04..06 (K only) kept
  const wMid = windowStats(env, rep0, env.cal.idx("1990-06-10"), 14, 1, env.tested[eK].rowIdx);
  assert(wMid.n === 11, "overlap day 06-03 masked even for the keeper; own-only days kept", `n=${wMid.n}`);

  // another tested anchor's window masks the keeper's span day
  const eL = env.tested.findIndex((t) => t.id === "r-l");
  const wL = windowStats(env, rep0, env.cal.idx("1990-06-20"), 14, 1, env.tested[eL].rowIdx);
  assert(wL.n === 13, "W(L): other tested row's span day (06-06) masked", `n=${wL.n}`);
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
  const A = row("1990-07-20", "flood", { states: ["TX"], spanDays: 2 });
  const inputs: FusionInputs = { store: makeStore(days, frames, slots, luts), raw: [A] };
  const env = buildEnv(inputs, 42);
  const { dd, cal } = env;

  const dBad = cal.idx("1990-07-07");
  assert(dd.rep[dBad] === 99 && dd.ok[dBad] === 0, "day with 99/142 reporting excluded (floor 100)", `rep=${dd.rep[dBad]}`);

  const dThin = cal.idx("1990-05-01");
  assert(dd.elig[dThin] === 140 && dd.f249[dThin] === 0,
    "LUT pool years < 10 → slot excluded from numerator AND denominator", `elig=${dd.elig[dThin]} F=${dd.f249[dThin]}`);

  const rep0 = makeRep(env, null);
  const w = windowStats(env, rep0, cal.idx("1990-07-20"), 14, 1, env.tested[0].rowIdx);
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
  const A = row("2020-06-15", "flood", { states: ["TX"], spanDays: 2 });
  const inputs: FusionInputs = { store: makeStore(days, frames, slots, luts), raw: [A] };
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
  const A = row("1991-06-15", "flood", { states: ["TX"], spanDays: 2 }); // the tested row
  const X = row("1990-06-05", "hail", { states: ["NY"], deaths: 0, damageUsd: 1e6, spanDays: 8 }); // any-tier span (not MAJOR)
  const B = row("1992-06-20", "wind", { states: ["LA"], spanDays: 2 }); // MAJOR → ±30d mask
  const C = row("1990-10-10", "heat", { states: ["TX"], spanDays: 2 }); // MAJOR, no traps nearby
  const inputs: FusionInputs = { store: makeStore(days, frames, slots, luts), raw: [A, X, B, C] };
  const env = buildEnv(inputs, 42);
  assert(env.tested.length === 3, "3 tested MAJOR rows (X fails the per-row MAJOR bar)", `${env.tested.length}`);
  const rep0 = makeRep(env, null);

  const eA = env.tested.findIndex((t) => t.d0 === "1991-06-15");
  const selA = selectControls(env, rep0, eA, false, null);
  assert(selA.chosen.length === 8, "up to 8 controls drawn", `${selA.chosen.length}`);
  assert(selA.chosen.every((c) => env.cal.year[c] === 1990), "all controls from the only eligible year (1990)");
  assert(
    selA.chosen.every((c) => env.cal.iso[c] < "1990-06-05" || env.cal.iso[c] > "1990-06-12"),
    "rule iii: no control inside ANY-tier effective-anchor span"
  );
  assert(selA.eligible === 23, "eligible candidate count (31 − 8 any-tier span days)", `${selA.eligible}`);
  assert(
    selA.rejected.rule1 === 31 && selA.rejected.rule2 === 58 && selA.rejected.rule3 === 12,
    "rule tallies exact: i=31 (window floor), ii=58 (±30d of MAJOR row span), iii=12 (span membership)",
    JSON.stringify(selA.rejected)
  );
  const selA2 = selectControls(env, rep0, eA, false, null);
  assert(JSON.stringify(selA.chosen) === JSON.stringify(selA2.chosen), "seeded tie-break is stable across calls");

  const eC = env.tested.findIndex((t) => t.d0 === "1990-10-10");
  const selC = selectControls(env, rep0, eC, false, null);
  assert(
    selC.chosen.length === 8 && selC.chosen.every((c) => env.cal.year[c] === 1991),
    "nearest-year selection: 8 of 8 from the gap-1 year despite gap-2/gap-3 candidates",
    JSON.stringify(selC.chosen.map((c) => env.cal.iso[c]))
  );
}

// ─── (i) G0 — matched to own MAJOR rows (v2.1 clause 6) ─────────────────────────
console.log("(i) G0 — span-intersect matching, winter-family preferred, own-d0 onsets");
{
  const slots = makeSlots();
  const luts = makeLuts(slots);
  const days = isoDays(1995, 2005);
  const frames = makeFrames(days, 0.02, 13);
  // season chain: two winter rows 6 days apart — v2.0's ±7d fuse would have merged
  // them and tested the famous storm at 12-01; v2.1 keeps both rows separate.
  const chainA = row("2000-12-01", "winter", { id: "r-chain", states: ["NY"], deaths: 60, damageUsd: 0, spanDays: 3 }); // 12-01..03
  const famous = row("2000-12-09", "winter", { id: "r-famous", states: ["NY"], deaths: 30, damageUsd: 0, spanDays: 3 }); // 12-09..11
  const decoy = row("2000-12-12", "flood", { id: "r-decoy", states: ["NY"], deaths: 90, damageUsd: 0, spanDays: 2 }); // 12-12..13, higher severity, non-winter
  const inputs: FusionInputs = { store: makeStore(days, frames, slots, luts), raw: [chainA, famous, decoy] };
  const rollCall: RollCallEvent[] = [
    { name: "famous-event", lo: "2000-12-08", hi: "2000-12-12" },
    { name: "ghost", lo: "1997-05-01", hi: "1997-05-10" },
  ];
  const core = runFusionOnce(inputs, { seed: 42, rollCall });
  assert(core.receipts.testedAnchors.dedupedTested === 3,
    "season chain (±6d gap) NOT fused — 3 tested anchors", `${core.receipts.testedAnchors.dedupedTested}`);
  const r0 = core.g0.rows[0];
  assert(r0.found, "G0 finds a tested MAJOR row by span-intersect");
  assert(r0.onset === "2000-12-09",
    "winter-family preferred over higher-severity non-winter; onset = the row's OWN d0",
    `${r0.onset}`);
  assert(!core.g0.rows[1].found && core.g0.rows[1].onset === null,
    "roll-call window with no intersecting tested row → NOT FOUND", JSON.stringify(core.g0.rows[1]));
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
    raw: E2E_ANCHORS,
  };
  const t0 = Date.now();
  const res = runFusion(inputs, { seed: 42, rollCall: E2E_ROLLCALL });
  const p = res.payload;
  console.log(`  (planted end-to-end run: ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  assert(p.receipts.testedAnchors.majorRows === 60 && p.receipts.testedAnchors.dedupedTested === 60,
    "60 raw MAJOR rows → 60 deduped tested anchors (no overlaps)", JSON.stringify(p.receipts.testedAnchors));
  assert(p.g0.pass, "G0 roll call passes on planted signal", JSON.stringify(p.g0.rows.map((r) => [r.name, r.beatsMedian, r.beatsP75])));
  assert(p.g2.pass, "G2: both tests FAIL on the outer-rotated store", JSON.stringify({ t1: p.g2.test1PassOnRotated, t2: p.g2.test2PassOnRotated }));
  assert(p.g3.pass, "G3: two in-process recomputes byte-identical");
  assert(p.test1.pass, "TEST 1 passes — ΔW beats all 67 rotations",
    `dW=${p.test1.dW} maxRot=${p.test1.maxRotationDW}`);
  assert(p.test2.pass, "TEST 2 passes — top decile ≥ 2b and lift beats all 67 rotations",
    `top=${p.test2.topDecileRate} 2b=${p.test2.topDecileBar} lift=${p.test2.lift} maxRot=${p.test2.maxRotationLift}`);
  assert(p.verdict.final.startsWith("FUSION CONFIRMED"), "verdict: FUSION CONFIRMED", p.verdict.final);
  assert(p.test1.dW !== null && p.test1.dW > 0.2, "planted effect size visible (ΔW > 0.2)", `${p.test1.dW}`);
  assert(p.anchors.every((a, i) => a.onset === E2E_ANCHORS[i].d0), "payload anchors carry their OWN row onsets");
}

console.log("(b) NULL BOARD — no planted signal: both tests must FAIL");
{
  const frames = makeFrames(E2E_DAYS, 0.02, 5); // same noise, no planting
  const inputs: FusionInputs = {
    store: makeStore(E2E_DAYS, frames, SLOTS, LUTS),
    raw: E2E_ANCHORS,
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
    return { store: makeStore(days, frames, makeSlots(), makeLuts(makeSlots())), raw: anchors };
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
