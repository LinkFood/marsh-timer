/**
 * fusion-formation.ts — THE FUSION FORMATION TEST (mine v2.0, board altitude).
 *
 * Implements scripts/mine/REGISTRATION-FUSION-V2.md (frozen 2026-07-16, commit
 * 0e61db9). The registration is THE LAW; where this file and the registration
 * disagree, the registration wins and this file is wrong.
 *
 * Run-of-record order inside one invocation (§10, §12):
 *   substrate receipts (frame count, coverage-cliff table, anchor fingerprint,
 *   merged-episode receipt, post-masking base rate b BEFORE any W-vs-outcome
 *   contrast) → G0 → G2 → G3 → Test 1 → Test 2 → honesty diagnostics (§11)
 *   → verdict (§12). Outputs: out/fusion-v2.json + out/FUSION-REPORT.md.
 *
 * DEVELOPMENT FIREWALL (§10): built and debugged against SYNTHETIC fixtures
 * only (fusion-formation.test.ts). The pipeline core takes a FrameStore-shaped
 * object + an anchor list so fixtures can inject synthetic boards; the first
 * production invocation is the run of record, fired by the main session.
 *
 * mine.ts is NEVER imported (it auto-runs main() at module top level). The
 * tier rule, calendar machinery, fnv, the v1.3 rotation remap, and the
 * epoch-matched control machinery are COPIED and adapted to the registration.
 *
 * Determinism (G3): no timestamps anywhere; Math.random banned; all RNG is
 * seeded mulberry32 via fnv-derived seeds; rng consumption order is part of
 * the contract. F(d), day-floor flags, and slot eligibility travel WITH frames
 * under rotation (bytes are doy-pool percentiles; rotation preserves
 * month/day) — per-day F is precomputed once and rotations are index remaps;
 * masks, episode spans, and window floors stay at true dates.
 *
 * Usage: npx tsx scripts/mine/fusion-formation.ts [--seed 42] [--json-only]
 */

import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { loadAnchors, EffectiveAnchor, DateSpan } from "./anchors";
import { loadFrameStore, SlotDef, Lut, doyOfIso } from "./frames";
import { seededRng } from "./stats";

// ─── frozen constants (registration §13 — do not touch without a version bump) ──
const TAU_PRIMARY_BYTE = 249; // τ = 0.98 registered as the byte (ruling B(a))
const TAU_DIAG_BYTES: [number, number] = [241, 253]; // 0.95 / 0.995 — labeled diagnostics, never promoted
const NSLOT_V1 = 142; // v1 offsets 0–141 only; PNA slots 142–143 excluded (§2)
const LUT_YEARS_FLOOR = 10; // pools under 10 years were forward-clamped ≤0.6 — excluded num AND denom
const DAY_FLOOR = 100; // ≥100 of 142 slots reporting, else day excluded everywhere (ruling B(e))
const WINDOW_FLOOR = 10; // ≥10 of 14 eligible days after masking, else window dropped + counted
const WIN_LO = 14; // pre-window D-14..D-1 (D0 excluded)
const WIN_HI = 1;
const FAR_LO = 14, FAR_HI = 4; // W_far = D-14..D-4 (declared secondary)
const NEAR_LO = 3, NEAR_HI = 1; // W_near = D-3..D-1 (declared secondary)
const OUTCOME_LO = 1, OUTCOME_HI = 14; // Test 2 outcome window +1..+14
const MERGE_GAP_DAYS = 7; // cross-family merge: overlap or ±7d AND states intersect, transitive
const CONTROL_EP_RADIUS = 30; // §7 rule ii: no pooled MAJOR episode span within ±30d of a control day
const MAX_CONTROLS = 8;
const CONTROL_DOY_HALF = 15; // control candidates at the same doy ± 15
const SHIFT_MIN = 5, SHIFT_MAX = 71; // exhaustive 67 rotations — no sampling, no K (§8)
const N_ROTATIONS = SHIFT_MAX - SHIFT_MIN + 1; // 67; exact p = 1/68
const ERA_START = "1990-01-01"; // §2/§4: anchor + scan era
const ERA_END = "2021-12-31"; // onset ≥ 2022-01-01 excluded a priori (amendment A5)
const EPOCH_SPLIT = "2006-01-01"; // honesty split 1990–2005 vs 2006–2021
const COVERAGE_GAP_TOLERANCE = 2; // mean reporting-count gap > 2 slots → coverage-matched resampling (B(f))
const SEED_DEFAULT = 42; // seed of record
// §2 substrate pins (production path only — the injectable core stays fixture-friendly):
const LAYOUT_VERSION_PINNED = 1711701607; // re-baked substrate ⇒ re-freeze + registration version bump
const MIN_FRAME_DAYS = 27956; // 27,956 days verified 2026-07-16; the store only grows

// ─── tier rule — COPIED from mine.ts:103-109 (never import mine.ts: top-level main) ─
export type Tier = "ALL" | "SEVERE" | "MAJOR";
const TIER_RULE: Record<Tier, (e: EffectiveAnchor) => boolean> = {
  ALL: () => true,
  SEVERE: (e) => e.deaths >= 1 || e.damageUsd >= 50e6,
  MAJOR: (e) => e.deaths >= 10 || e.damageUsd >= 250e6,
};
function tierOf(e: EffectiveAnchor): Tier {
  return TIER_RULE.MAJOR(e) ? "MAJOR" : TIER_RULE.SEVERE(e) ? "SEVERE" : "ALL";
}
const TIER_ORD: Record<Tier, number> = { ALL: 0, SEVERE: 1, MAJOR: 2 };

// ─── G0 roll call (amendment A3) ────────────────────────────────────────────────
export interface RollCallEvent { name: string; lo: string; hi: string; }
export const PRODUCTION_ROLLCALL: RollCallEvent[] = [
  { name: "Feb-2010 (Snowmageddon)", lo: "2010-01-20", hi: "2010-03-10" },
  { name: "Dec-2010 (Christmas blizzard)", lo: "2010-11-20", hi: "2011-01-10" },
  { name: "Feb-2021 (Uri)", lo: "2021-01-01", hi: "2021-03-01" },
  { name: "Mar-1993 (Superstorm)", lo: "1993-02-20", hi: "1993-04-01" },
  { name: "Jan-2016 (Jonas)", lo: "2016-01-01", hi: "2016-02-15" },
];
const ELLIOTT_EXCLUSION =
  "Dec-2022 (Elliott) EXCLUDED from the roll call: frame store blank 2022-01-01 → present " +
  "(coverage-cliff receipt above; registration §10/A3)";

// ─── fnv — COPIED from mine.ts:214-221 ─────────────────────────────────────────
function fnv(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const pad2 = (n: number) => String(n).padStart(2, "0");
const DAY_MS = 864e5;

// ─── calendar (adapted from mine.ts initCalendar — an object, not module globals,
//     so fixtures can hold several stores at once) ─────────────────────────────
export interface Cal {
  ts0: number;
  total: number;
  iso: string[];
  doy: Uint16Array;
  year: Uint16Array;
  month: Uint8Array;
  year0: number;
  yearSpan: number;
  idx(iso: string): number;
  /** index of year-month-day (Feb 29 → 28 in non-leap years); −1 if outside store. */
  mdLookup(y: number, m: number, d: number): number;
}

export function makeCal(days: string[]): Cal {
  const ts0 = Date.parse(`${days[0]}T00:00:00Z`);
  const tsN = Date.parse(`${days[days.length - 1]}T00:00:00Z`);
  const total = Math.round((tsN - ts0) / DAY_MS) + 1;
  const iso = new Array<string>(total);
  const doy = new Uint16Array(total);
  const year = new Uint16Array(total);
  const month = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const s = new Date(ts0 + i * DAY_MS).toISOString().slice(0, 10);
    iso[i] = s;
    doy[i] = doyOfIso(s);
    year[i] = Number(s.slice(0, 4));
    month[i] = Number(s.slice(5, 7));
  }
  const year0 = year[0];
  const yearSpan = year[total - 1] - year0 + 1;
  // O(1) (year, month, day) → index (rotation remaps run 27k × 134 replicates)
  const MD = 1332;
  const mdIdx = new Int32Array(yearSpan * MD).fill(-1);
  for (let i = 0; i < total; i++) {
    mdIdx[(year[i] - year0) * MD + month[i] * 100 + Number(iso[i].slice(8, 10))] = i;
  }
  return {
    ts0, total, iso, doy, year, month, year0, yearSpan,
    idx: (s: string) => Math.round((Date.parse(`${s}T00:00:00Z`) - ts0) / DAY_MS),
    mdLookup(y: number, m: number, d: number): number {
      if (y < year0 || y >= year0 + yearSpan) return -1;
      const dd = m === 2 && d === 29 && !isLeap(y) ? 28 : d;
      return mdIdx[(y - year0) * MD + m * 100 + dd];
    },
  };
}

// ─── cross-family merge (§4) — adapted from anchors.dedupeAnchors, family-blind ─
export interface PooledEpisode {
  onset: string; // = earliest member span start
  span: DateSpan; // union of member spans
  families: string[]; // sorted union
  states: string[]; // sorted union
  memberIds: string[];
  tier: Tier; // max member tier
  nEffMembers: number;
  deaths: number;
  damageUsd: number;
}

const toTs = (s: string) => Date.parse(`${s}T00:00:00Z`);
const minIso = (a: string, b: string) => (a <= b ? a : b);
const maxIso = (a: string, b: string) => (a >= b ? a : b);

export function mergeCrossFamily(anchors: EffectiveAnchor[]): PooledEpisode[] {
  const sorted = [...anchors].sort(
    (a, b) => (a.span.start < b.span.start ? -1 : a.span.start > b.span.start ? 1 :
      a.family < b.family ? -1 : a.family > b.family ? 1 :
      a.memberIds[0] < b.memberIds[0] ? -1 : 1)
  );
  // Union-find over the PAIRWISE anchor relation (§4/§13: spans overlap or within
  // ±7d AND state sets intersect), transitively closed. First-match greedy
  // clustering is NOT transitive — a later anchor can relate to two existing
  // clusters (or turn two earlier state-disjoint anchors into one component) and
  // greedy joins only the first, splitting one synoptic system into two episodes.
  const n = sorted.length;
  const stateSets = sorted.map((a) => new Set(a.states));
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  for (let i = 0; i < n; i++) {
    const endI = toTs(sorted[i].span.end);
    for (let j = i + 1; j < n; j++) {
      // start-sorted ⇒ for j > i the pairwise span gap is start_j − end_i (≤0 =
      // overlap); once it exceeds the merge gap, no later j can relate to i.
      if (toTs(sorted[j].span.start) - endI > MERGE_GAP_DAYS * DAY_MS) break;
      if (!sorted[j].states.some((s) => stateSets[i].has(s))) continue;
      const ri = find(i), rj = find(j);
      if (ri !== rj) parent[ri] = rj;
    }
  }
  const byRoot = new Map<number, EffectiveAnchor[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const c = byRoot.get(r);
    if (c) c.push(sorted[i]);
    else byRoot.set(r, [sorted[i]]);
  }
  const clusters = [...byRoot.values()];
  const eps: PooledEpisode[] = clusters.map((c) => {
    const start = c.reduce((s, x) => minIso(s, x.span.start), c[0].span.start);
    const end = c.reduce((e, x) => maxIso(e, x.span.end), c[0].span.end);
    let tier: Tier = "ALL";
    for (const x of c) if (TIER_ORD[tierOf(x)] > TIER_ORD[tier]) tier = tierOf(x);
    return {
      onset: start,
      span: { start, end },
      families: [...new Set(c.map((x) => x.family))].sort(),
      states: [...new Set(c.flatMap((x) => x.states))].sort(),
      memberIds: c.flatMap((x) => x.memberIds).sort(),
      tier,
      nEffMembers: c.length,
      deaths: c.reduce((n, x) => n + x.deaths, 0),
      damageUsd: c.reduce((n, x) => n + x.damageUsd, 0),
    };
  });
  eps.sort((a, b) => (a.onset < b.onset ? -1 : a.onset > b.onset ? 1 : a.memberIds[0] < b.memberIds[0] ? -1 : 1));
  return eps;
}

// ─── the injectable substrate (FrameStore-shaped; §10 firewall) ─────────────────
export interface FusionStore {
  version: number;
  slots: SlotDef[]; // ≥142; only offsets 0..141 are read (§2)
  days: string[]; // sorted ISO
  frames: Map<string, Uint8Array>;
  luts: Map<string, Lut>; // keyed `${inst_id}|${metric}|${doy}` — only .years is read
}

export interface FusionInputs {
  store: FusionStore;
  rawCount: number; // stitched rows (4233 in production — loader asserts)
  effective: EffectiveAnchor[]; // the FULL effective set, all tiers (§7 rule iii needs any-tier spans)
}

export interface FusionOpts {
  seed: number;
  rollCall?: RollCallEvent[]; // default PRODUCTION_ROLLCALL — injectable for synthetic fixtures
}

// ─── lanes (§11.1) ──────────────────────────────────────────────────────────────
export const LANES = ["air", "water", "pressure", "climate"] as const;
export function laneOf(instId: string): number {
  if (instId.startsWith("needle-")) return 3; // climate
  if (instId.startsWith("buoy-")) return 2; // pressure
  if (instId.startsWith("tide-")) return 1; // water
  return 0; // air (state-temp / ghcn)
}

// ─── per-day F precompute (§3) — travels with frames under rotation ─────────────
export interface DayData {
  rep: Uint16Array; // reporting slots (byte ≠ 255) of the 142
  elig: Uint16Array; // reporting AND lut-years ≥ 10 at the day's doy
  f249: Float64Array; // F(d) at τ byte 249; −1 = undefined (no frame / no eligible slots)
  f241: Float64Array;
  f253: Float64Array;
  laneF: Float64Array[]; // [4] per-lane deep fraction at 249; −1 = lane has no eligible slot
  laneBal: Float64Array; // F* = mean of per-lane deep fractions; −1 = no lane eligible
  ok: Uint8Array; // frame present AND rep ≥ DAY_FLOOR AND elig > 0
}

export function computeDayData(store: FusionStore, cal: Cal): DayData {
  const T = cal.total;
  const rep = new Uint16Array(T);
  const elig = new Uint16Array(T);
  const f249 = new Float64Array(T).fill(-1);
  const f241 = new Float64Array(T).fill(-1);
  const f253 = new Float64Array(T).fill(-1);
  const laneF = [0, 1, 2, 3].map(() => new Float64Array(T).fill(-1));
  const laneBal = new Float64Array(T).fill(-1);
  const ok = new Uint8Array(T);

  // per-slot per-doy LUT-years eligibility (shared by both sides of a metric)
  const lutOk: Uint8Array[] = [];
  const slotLane = new Uint8Array(NSLOT_V1);
  for (let off = 0; off < NSLOT_V1; off++) {
    const s = store.slots[off];
    if (!s) throw new Error(`slot manifest missing offset ${off} — need the 142 v1 slots`);
    slotLane[off] = laneOf(s.inst_id);
    const okArr = new Uint8Array(367);
    for (let doy = 1; doy <= 366; doy++) {
      const lut = store.luts.get(`${s.inst_id}|${s.metric}|${doy}`);
      okArr[doy] = lut && lut.years >= LUT_YEARS_FLOOR ? 1 : 0;
    }
    lutOk.push(okArr);
  }

  for (const day of store.days) {
    const d = cal.idx(day);
    if (d < 0 || d >= T) continue;
    const bytes = store.frames.get(day);
    if (!bytes) continue;
    const doy = cal.doy[d];
    let r = 0, e = 0, d249 = 0, d241 = 0, d253 = 0;
    const lE = [0, 0, 0, 0], lD = [0, 0, 0, 0];
    for (let off = 0; off < NSLOT_V1; off++) {
      const b = bytes[off];
      if (b === 255) continue;
      r++;
      if (!lutOk[off][doy]) continue; // excluded from numerator AND denominator (B(a))
      e++;
      lE[slotLane[off]]++;
      if (b >= TAU_DIAG_BYTES[0]) d241++;
      if (b >= TAU_PRIMARY_BYTE) {
        d249++;
        lD[slotLane[off]]++;
        if (b >= TAU_DIAG_BYTES[1]) d253++;
      }
    }
    rep[d] = r;
    elig[d] = e;
    if (e > 0) {
      f249[d] = d249 / e;
      f241[d] = d241 / e;
      f253[d] = d253 / e;
      let lsum = 0, ln = 0;
      for (let L = 0; L < 4; L++) {
        if (lE[L] > 0) {
          laneF[L][d] = lD[L] / lE[L];
          lsum += lD[L] / lE[L];
          ln++;
        }
      }
      if (ln > 0) laneBal[d] = lsum / ln;
    }
    ok[d] = r >= DAY_FLOOR && e > 0 ? 1 : 0;
  }
  return { rep, elig, f249, f241, f253, laneF, laneBal, ok };
}

// ─── rotation remap (§8) — the v1.3 canon, copied from mine.ts shiftColumns ─────
// The whole frame axis rotates by integer years, same month/day, Feb 29 → 28;
// out-of-store targets → −1 (read as null, absorbed by floors).
export function makeRemap(cal: Cal, offsetYears: number): Int32Array {
  const remap = new Int32Array(cal.total);
  for (let d = 0; d < cal.total; d++) {
    const m = cal.month[d];
    const dd = Number(cal.iso[d].slice(8, 10));
    const y2 = cal.year0 + ((cal.year[d] - cal.year0 + offsetYears) % cal.yearSpan);
    remap[d] = cal.mdLookup(y2, m, dd);
  }
  return remap;
}

/** G2 stacking: reading through `inner` then `outer` (both map day→source day). */
export function composeRemap(outer: Int32Array, inner: Int32Array): Int32Array {
  const out = new Int32Array(inner.length);
  for (let d = 0; d < inner.length; d++) out[d] = inner[d] >= 0 ? outer[inner[d]] : -1;
  return out;
}

// ─── the environment: everything at TRUE dates (masks, episodes, floors-on-windows) ─
export interface Env {
  cal: Cal;
  dd: DayData;
  episodes: PooledEpisode[]; // pooled MAJOR, era-filtered, onset-sorted
  epOnsetIdx: Int32Array;
  coverCnt: Uint8Array; // pooled MAJOR episode spans covering each day
  coverSingle: Int32Array; // episode index when coverCnt == 1, else −1
  inMajorSpan: Uint8Array; // coverCnt > 0
  majorNear30: Uint8Array; // §7 rule ii: within ±30d of any pooled MAJOR span
  anyTierSpan: Uint8Array; // §7 rule iii: inside ANY effective anchor's span, any family, any tier
  followed: Uint8Array; // pooled MAJOR onset in d+1..d+14
  eraStartIdx: number;
  eraEndIdx: number;
  eraY0: number;
  eraY1: number;
  seed: number;
  receipts: {
    majorEffective: number;
    excludedPost2021: number;
    inEra: number;
    episodes: number;
    fingerprint: string; // fnv hex of sorted member ids
    rawCount: number;
  };
}

export function buildEnv(inputs: FusionInputs, seed: number): Env {
  const cal = makeCal(inputs.store.days);
  const dd = computeDayData(inputs.store, cal);
  const major = inputs.effective.filter(TIER_RULE.MAJOR);
  // §2/§13 anchor era: onset ≥ 2022-01-01 excluded a priori; the ≥1990 lower bound
  // is loadAnchors' hard assert on the production path, re-enforced here so the
  // injectable core cannot pool a pre-era anchor.
  const inEra = major.filter((a) => a.d0 >= ERA_START && a.d0 <= ERA_END);
  const episodes = mergeCrossFamily(inEra);

  const T = cal.total;
  const coverCnt = new Uint8Array(T);
  const coverSingle = new Int32Array(T).fill(-1);
  const majorNear30 = new Uint8Array(T);
  const epOnsetIdx = new Int32Array(episodes.length);
  const followed = new Uint8Array(T);
  const clamp = (x: number) => Math.max(0, Math.min(T - 1, x));
  for (let e = 0; e < episodes.length; e++) {
    const ep = episodes[e];
    const s = cal.idx(ep.span.start);
    const en = cal.idx(ep.span.end);
    epOnsetIdx[e] = cal.idx(ep.onset);
    for (let d = clamp(s); d <= clamp(en); d++) {
      if (d < s || d > en) continue;
      if (coverCnt[d] < 255) coverCnt[d]++;
      coverSingle[d] = coverCnt[d] === 1 ? e : -1;
    }
    if (en >= 0 && s < T) majorNear30.fill(1, clamp(s - CONTROL_EP_RADIUS), clamp(en + CONTROL_EP_RADIUS) + 1);
    // outcome flag: onset o follows day d iff o ∈ [d+1, d+14] ⟺ d ∈ [o−14, o−1];
    // an onset at index < OUTCOME_LO has an EMPTY flag range — no clamp-to-0 fill
    const o = epOnsetIdx[e];
    if (o - OUTCOME_LO >= 0) followed.fill(1, clamp(o - OUTCOME_HI), o - OUTCOME_LO + 1);
  }
  const inMajorSpan = new Uint8Array(T);
  for (let d = 0; d < T; d++) inMajorSpan[d] = coverCnt[d] > 0 ? 1 : 0;

  const anyTierSpan = new Uint8Array(T);
  for (const a of inputs.effective) {
    const s = cal.idx(a.span.start);
    const en = cal.idx(a.span.end);
    if (en < 0 || s >= T) continue;
    anyTierSpan.fill(1, clamp(s), clamp(en) + 1);
  }

  const allIds = inEra.flatMap((a) => a.memberIds).sort();
  return {
    cal, dd, episodes, epOnsetIdx, coverCnt, coverSingle, inMajorSpan, majorNear30,
    anyTierSpan, followed,
    eraStartIdx: Math.max(0, cal.idx(ERA_START)),
    eraEndIdx: Math.min(T - 1, cal.idx(ERA_END)),
    eraY0: Math.max(cal.year0, 1990),
    eraY1: Math.min(cal.year0 + cal.yearSpan - 1, 2021),
    seed,
    receipts: {
      majorEffective: major.length,
      excludedPost2021: major.length - inEra.length,
      inEra: inEra.length,
      episodes: episodes.length,
      fingerprint: fnv(allIds.join("|")).toString(16),
      rawCount: inputs.rawCount,
    },
  };
}

// ─── replicate view: one remap (or null = observed) over the same true-date env ──
export interface Rep {
  srcOf: Int32Array; // day → source day in DayData (−1 = off-store)
  usable: Uint8Array; // source frame present + day floor + elig > 0 (floors travel with frames)
  // mask-all trailing D-14..D-1 sliding sums (control windows / Test 2 trailing W —
  // "any pooled MAJOR episode span" masks; identical to windowStats(selfEp = −1))
  trailCnt: Int16Array;
  trailF: Float64Array;
  trailRep: Float64Array;
}

export function makeRep(env: Env, remap: Int32Array | null): Rep {
  const { cal, dd } = env;
  const T = cal.total;
  const srcOf = new Int32Array(T);
  const usable = new Uint8Array(T);
  for (let d = 0; d < T; d++) {
    const sd = remap ? remap[d] : d;
    srcOf[d] = sd;
    usable[d] = sd >= 0 && dd.ok[sd] ? 1 : 0;
  }
  const trailCnt = new Int16Array(T);
  const trailF = new Float64Array(T);
  const trailRep = new Float64Array(T);
  let cnt = 0, sf = 0, sr = 0;
  for (let d = 0; d < T; d++) {
    const add = d - 1, rem = d - WIN_LO - 1;
    if (add >= 0 && usable[add] && !env.inMajorSpan[add]) {
      cnt++; sf += dd.f249[srcOf[add]]; sr += dd.rep[srcOf[add]];
    }
    if (rem >= 0 && usable[rem] && !env.inMajorSpan[rem]) {
      cnt--; sf -= dd.f249[srcOf[rem]]; sr -= dd.rep[srcOf[rem]];
    }
    trailCnt[d] = cnt; trailF[d] = sf; trailRep[d] = sr;
  }
  return { srcOf, usable, trailCnt, trailF, trailRep };
}

/** §5 masking: day usable for a window iff covered by no episode span other than self. */
function coverOk(env: Env, d: number, selfEp: number): boolean {
  const c = env.coverCnt[d];
  return c === 0 || (c === 1 && selfEp >= 0 && env.coverSingle[d] === selfEp);
}

export interface WinStats { total: number; n: number; mean: number | null; repMean: number | null; }

/** Masked window mean of F over centerIdx−lo .. centerIdx−hi (selfEp = −1 → mask all). */
export function windowStats(env: Env, rep: Rep, centerIdx: number, lo: number, hi: number, selfEp: number): WinStats {
  let n = 0, total = 0, s = 0, sr = 0;
  for (let k = lo; k >= hi; k--) {
    const d = centerIdx - k;
    total++;
    if (d < 0 || d >= env.cal.total) continue;
    if (!rep.usable[d]) continue;
    if (!coverOk(env, d, selfEp)) continue;
    n++;
    s += env.dd.f249[rep.srcOf[d]];
    sr += env.dd.rep[rep.srcOf[d]];
  }
  return { total, n, mean: n > 0 ? s / n : null, repMean: n > 0 ? sr / n : null };
}

/** M(a) (§6 secondary): mean over D-14..D-1 of F(d) − mean F over d−14..d−1,
 *  masked per §5 incl. the full D-28 reach-back (D6); ≥10-eligible floor applied
 *  to the outer window AND each inner window (contributing days need a valid
 *  inner mean; M needs ≥10 contributing days else dropped + counted). */
export function motionM(env: Env, rep: Rep, centerIdx: number, selfEp: number): { M: number | null; used: number } {
  let used = 0, sum = 0;
  const T = env.cal.total;
  const okDay = (d: number) => d >= 0 && d < T && rep.usable[d] === 1 && coverOk(env, d, selfEp);
  for (let k = WIN_LO; k >= WIN_HI; k--) {
    const d = centerIdx - k;
    if (!okDay(d)) continue;
    let n = 0, s = 0;
    for (let j = WIN_LO; j >= WIN_HI; j--) {
      const d2 = d - j;
      if (!okDay(d2)) continue;
      n++;
      s += env.dd.f249[rep.srcOf[d2]];
    }
    if (n < WINDOW_FLOOR) continue;
    used++;
    sum += env.dd.f249[rep.srcOf[d]] - s / n;
  }
  return used >= WINDOW_FLOOR ? { M: sum / used, used } : { M: null, used };
}

// ─── controls (§7) — adapted from mine.ts controlD0s (epoch-matched, seeded ties) ─
export interface ControlSelection {
  chosen: number[]; // day indexes, ascending
  rejected: { rule1: number; rule2: number; rule3: number };
  eligible: number;
}

export function selectControls(
  env: Env, rep: Rep, epIdx: number, coverageMatched: boolean, epWinRepMean: number | null
): ControlSelection {
  const ep = env.episodes[epIdx];
  const [, mS, dS] = ep.onset.split("-").map(Number);
  const anchorYear = Number(ep.onset.slice(0, 4));
  const rejected = { rule1: 0, rule2: 0, rule3: 0 };
  const cands: { idx: number; gap: number; pen: number }[] = [];
  for (let y = env.eraY0; y <= env.eraY1; y++) {
    const base = env.cal.mdLookup(y, mS, dS);
    if (base < 0) continue;
    for (let off = -CONTROL_DOY_HALF; off <= CONTROL_DOY_HALF; off++) {
      const ci = base + off;
      if (ci < env.eraStartIdx || ci > env.eraEndIdx) continue;
      if (env.anyTierSpan[ci]) { rejected.rule3++; continue; } // iii: inside no span, any family, any tier
      if (env.majorNear30[ci]) { rejected.rule2++; continue; } // ii: no pooled MAJOR span within ±30d
      if (rep.trailCnt[ci] < WINDOW_FLOOR) { rejected.rule1++; continue; } // i: masked window ≥10 eligible
      let pen = 0;
      if (coverageMatched && epWinRepMean !== null) {
        pen = Math.abs(rep.trailRep[ci] / rep.trailCnt[ci] - epWinRepMean) > COVERAGE_GAP_TOLERANCE ? 1 : 0;
      }
      cands.push({ idx: ci, gap: Math.abs(env.cal.year[ci] - anchorYear), pen });
    }
  }
  let chosen: number[];
  if (cands.length <= MAX_CONTROLS) {
    chosen = cands.map((c) => c.idx);
  } else {
    // rng consumed in fixed (year-asc, offset-asc) construction order → deterministic
    const rng = seededRng(fnv(`${env.seed}|fusion-controls|${ep.onset}|${ep.memberIds[0]}`));
    const keyed = cands.map((c) => ({ ...c, r: rng() }));
    // DELIBERATE key order (B(f)): once coverage-matched resampling has triggered,
    // the coverage penalty outranks year gap — gap-first would re-pick the same
    // nearest-year candidates and could not close the reporting-count gap the
    // resample exists to close. Year gap remains the ordering inside each penalty
    // class; any achieved |year-gap| stretch is exposed by the §7 honesty line.
    keyed.sort((a, b) => a.pen - b.pen || a.gap - b.gap || a.r - b.r);
    chosen = keyed.slice(0, MAX_CONTROLS).map((c) => c.idx);
  }
  chosen.sort((a, b) => a - b);
  return { chosen, rejected, eligible: cands.length };
}

// ─── Test 1 (§9) ────────────────────────────────────────────────────────────────
interface EpDetail {
  onset: string;
  families: string[];
  Wa: number | null; // null = window dropped (<10 eligible)
  winN: number;
  winRepMean: number | null;
  ctlIdxs: number[];
  ctlWs: number[];
}

interface Test1Stat {
  dW: number | null;
  meanWep: number | null;
  meanWctl: number | null;
  epUsed: number;
  epDropped: number;
  droppedOnsets: string[];
  zeroControlEps: number;
  ctlWindows: number;
  meanYearGap: number | null;
  epRepMean: number | null;
  ctlRepMean: number | null;
  repGap: number; // anchors − controls mean reporting count (B(f) honesty line)
  perEp: EpDetail[] | null;
}

function test1Stat(env: Env, rep: Rep, coverageMatched: boolean, detail: boolean): Test1Stat {
  let epSum = 0, epN = 0, epDropped = 0;
  const droppedOnsets: string[] = [];
  let ctlSum = 0, ctlN = 0, zeroCtl = 0;
  let gapSum = 0, gapN = 0;
  let epRepSum = 0, epRepN = 0, ctlRepSum = 0, ctlRepN = 0;
  const perEp: EpDetail[] | null = detail ? [] : null;
  for (let e = 0; e < env.episodes.length; e++) {
    const ep = env.episodes[e];
    const o = env.epOnsetIdx[e];
    const w = windowStats(env, rep, o, WIN_LO, WIN_HI, e);
    if (w.n < WINDOW_FLOOR) {
      epDropped++;
      droppedOnsets.push(ep.onset);
      if (perEp) perEp.push({ onset: ep.onset, families: ep.families, Wa: null, winN: w.n, winRepMean: w.repMean, ctlIdxs: [], ctlWs: [] });
      continue;
    }
    const Wa = w.mean!;
    epSum += Wa; epN++;
    epRepSum += w.repMean!; epRepN++;
    const anchorYear = Number(ep.onset.slice(0, 4));
    const sel = selectControls(env, rep, e, coverageMatched, w.repMean);
    if (sel.chosen.length === 0) zeroCtl++;
    const ctlWs: number[] = [];
    for (const c of sel.chosen) {
      const cw = rep.trailF[c] / rep.trailCnt[c];
      ctlSum += cw; ctlN++;
      ctlWs.push(cw);
      gapSum += Math.abs(env.cal.year[c] - anchorYear); gapN++;
      ctlRepSum += rep.trailRep[c] / rep.trailCnt[c]; ctlRepN++;
    }
    if (perEp) perEp.push({ onset: ep.onset, families: ep.families, Wa, winN: w.n, winRepMean: w.repMean, ctlIdxs: sel.chosen, ctlWs });
  }
  const meanWep = epN > 0 ? epSum / epN : null;
  const meanWctl = ctlN > 0 ? ctlSum / ctlN : null;
  const epRepMean = epRepN > 0 ? epRepSum / epRepN : null;
  const ctlRepMean = ctlRepN > 0 ? ctlRepSum / ctlRepN : null;
  return {
    dW: meanWep !== null && meanWctl !== null ? meanWep - meanWctl : null,
    meanWep, meanWctl,
    epUsed: epN, epDropped, droppedOnsets, zeroControlEps: zeroCtl, ctlWindows: ctlN,
    meanYearGap: gapN > 0 ? gapSum / gapN : null,
    epRepMean, ctlRepMean,
    repGap: epRepMean !== null && ctlRepMean !== null ? epRepMean - ctlRepMean : 0,
    perEp,
  };
}

// ─── Test 2 (§9) ────────────────────────────────────────────────────────────────
interface Test2Stat {
  b: number; // post-masking base rate over eligible scan days
  topRate: number;
  lift: number; // topRate / b (b=0 → 0 or MAX_VALUE; a degenerate replicate, never Infinity in JSON)
  eligibleScanDays: number;
  droppedWindows: number; // trailing W < 10 eligible
  inSpanExcluded: number; // scan day inside a pooled MAJOR span
  deciles: { decile: number; n: number; followed: number; rate: number | null }[] | null;
  spearmanRho: number | null; // DESCRIPTIVE only — struck from PASS semantics (D5)
}

function test2Stat(env: Env, rep: Rep, detail: boolean): Test2Stat {
  const byMonth: { d: number; W: number; f: number }[][] = Array.from({ length: 12 }, () => []);
  let elig = 0, fol = 0, droppedWin = 0, inSpan = 0;
  for (let d = env.eraStartIdx; d <= env.eraEndIdx; d++) {
    if (env.inMajorSpan[d]) { inSpan++; continue; }
    if (rep.trailCnt[d] < WINDOW_FLOOR) { droppedWin++; continue; }
    const f = env.followed[d];
    elig++;
    fol += f;
    byMonth[env.cal.month[d] - 1].push({ d, W: rep.trailF[d] / rep.trailCnt[d], f });
  }
  const b = elig > 0 ? fol / elig : 0;
  // deciles WITHIN month strata, pooled
  const decN = new Array<number>(10).fill(0);
  const decF = new Array<number>(10).fill(0);
  for (const arr of byMonth) {
    arr.sort((a, b2) => a.W - b2.W || a.d - b2.d);
    const n = arr.length;
    for (let i = 0; i < n; i++) {
      const g = Math.min(9, Math.floor((i * 10) / n));
      decN[g]++;
      decF[g] += arr[i].f;
    }
  }
  const topRate = decN[9] > 0 ? decF[9] / decN[9] : 0;
  const lift = b > 0 ? topRate / b : topRate > 0 ? Number.MAX_VALUE : 0;
  let deciles: Test2Stat["deciles"] = null;
  let rho: number | null = null;
  if (detail) {
    deciles = decN.map((n, i) => ({ decile: i + 1, n, followed: decF[i], rate: n > 0 ? decF[i] / n : null }));
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < 10; i++) if (decN[i] > 0) { xs.push(i); ys.push(decF[i] / decN[i]); }
    rho = xs.length >= 3 ? spearman(xs, ys) : null;
  }
  return { b, topRate, lift, eligibleScanDays: elig, droppedWindows: droppedWin, inSpanExcluded: inSpan, deciles, spearmanRho: rho };
}

function spearman(xs: number[], ys: number[]): number {
  const rank = (v: number[]): number[] => {
    const idx = v.map((_, i) => i).sort((a, b) => v[a] - v[b] || a - b);
    const r = new Array<number>(v.length);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && v[idx[j + 1]] === v[idx[j]]) j++;
      const avg = (i + j + 2) / 2;
      for (let k = i; k <= j; k++) r[idx[k]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs), ry = rank(ys);
  const n = xs.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (rx[i] - mx) * (ry[i] - my);
    sxx += (rx[i] - mx) ** 2;
    syy += (ry[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const frac = pos - lo;
  return lo + 1 < sorted.length ? sorted[lo] + frac * (sorted[lo + 1] - sorted[lo]) : sorted[lo];
}

// ─── G0 (§10, amendment A3) ─────────────────────────────────────────────────────
interface G0Row {
  name: string;
  found: boolean;
  onset: string | null;
  Wa: number | null;
  ctlMedian: number | null;
  ctlP75: number | null;
  nControls: number;
  preWindowRepMean: number | null; // receipt: roll-call pre-windows report ≥125 slots
  beatsMedian: boolean;
  beatsP75: boolean;
}

function gateG0(env: Env, rollCall: RollCallEvent[], t1: Test1Stat): { pass: boolean; rows: G0Row[]; exclusion: string } {
  const rows: G0Row[] = rollCall.map((rc) => {
    const cand: number[] = [];
    for (let e = 0; e < env.episodes.length; e++) {
      const ep = env.episodes[e];
      if (ep.span.start <= rc.hi && ep.span.end >= rc.lo) cand.push(e);
    }
    const winter = cand.filter((e) => env.episodes[e].families.includes("winter"));
    const pool = winter.length > 0 ? winter : cand;
    pool.sort((a, b) =>
      env.episodes[b].deaths - env.episodes[a].deaths ||
      env.episodes[b].damageUsd - env.episodes[a].damageUsd ||
      (env.episodes[a].onset < env.episodes[b].onset ? -1 : 1)
    );
    if (pool.length === 0) {
      return { name: rc.name, found: false, onset: null, Wa: null, ctlMedian: null, ctlP75: null, nControls: 0, preWindowRepMean: null, beatsMedian: false, beatsP75: false };
    }
    const pe = t1.perEp![pool[0]];
    const ctl = [...pe.ctlWs].sort((a, b) => a - b);
    const med = ctl.length > 0 ? quantile(ctl, 0.5) : null;
    const p75 = ctl.length > 0 ? quantile(ctl, 0.75) : null;
    return {
      name: rc.name,
      found: true,
      onset: pe.onset,
      Wa: pe.Wa,
      ctlMedian: med,
      ctlP75: p75,
      nControls: ctl.length,
      preWindowRepMean: pe.winRepMean,
      beatsMedian: pe.Wa !== null && med !== null && pe.Wa > med,
      beatsP75: pe.Wa !== null && p75 !== null && pe.Wa > p75,
    };
  });
  const allMedian = rows.length === rollCall.length && rows.every((r) => r.found && r.beatsMedian);
  const p75Count = rows.filter((r) => r.beatsP75).length;
  // §10: each must exceed its control median; ≥4 of 5 must exceed the 75th pct.
  const pass = allMedian && p75Count >= Math.max(0, rollCall.length - 1);
  return { pass, rows, exclusion: ELLIOTT_EXCLUSION };
}

// ─── the battery: observed + exhaustive 67 rotations + G0, on one store view ────
interface RotRow {
  offset: number;
  dW: number | null;
  epUsed: number;
  epDropped: number;
  b: number;
  topRate: number;
  lift: number;
  t2Dropped: number;
}

interface Battery {
  coverageMatched: boolean;
  t1: Test1Stat;
  t2: Test2Stat;
  rotations: RotRow[];
  g0: { pass: boolean; rows: G0Row[]; exclusion: string };
  test1Pass: boolean;
  test2Pass: boolean;
}

function runBattery(env: Env, outer: Int32Array | null, rollCall: RollCallEvent[]): Battery {
  const repO = makeRep(env, outer);
  // B(f): coverage honesty — if mean reporting-count gap > 2 slots, re-select
  // controls coverage-matched (candidates within 2 slots of the anchor window's
  // mean reporting count preferred), identically in every replicate.
  let coverageMatched = false;
  let t1 = test1Stat(env, repO, false, true);
  if (Math.abs(t1.repGap) > COVERAGE_GAP_TOLERANCE) {
    coverageMatched = true;
    t1 = test1Stat(env, repO, true, true);
  }
  const t2 = test2Stat(env, repO, true);

  const rotations: RotRow[] = [];
  for (let off = SHIFT_MIN; off <= SHIFT_MAX; off++) {
    const rm = makeRemap(env.cal, off);
    const combined = outer ? composeRemap(outer, rm) : rm;
    const repv = makeRep(env, combined);
    const r1 = test1Stat(env, repv, coverageMatched, false);
    const r2 = test2Stat(env, repv, false);
    rotations.push({
      offset: off,
      dW: r1.dW, epUsed: r1.epUsed, epDropped: r1.epDropped,
      b: r2.b, topRate: r2.topRate, lift: r2.lift, t2Dropped: r2.droppedWindows,
    });
  }
  const g0 = gateG0(env, rollCall, t1);
  // PASS bar (§8/§9): observed strictly exceeds ALL 67 rotation values. A rotation
  // whose statistic is undefined (no usable windows) cannot outrank the observed.
  const test1Pass =
    t1.dW !== null && rotations.every((r) => r.dW === null || (t1.dW as number) > r.dW);
  const test2Pass =
    t2.b > 0 && t2.topRate >= 2 * t2.b && rotations.every((r) => t2.lift > r.lift);
  return { coverageMatched, t1, t2, rotations, g0, test1Pass, test2Pass };
}

// ─── §11 honesty diagnostics (observed run only; never gate, never promoted) ────
interface RichWin { n: number; mean: number; lane: (number | null)[]; laneN: number[]; fstar: number | null; f241: number; f253: number; }

function richWindow(env: Env, rep: Rep, centerIdx: number, lo: number, hi: number, selfEp: number): RichWin | null {
  let n = 0, s249 = 0, s241 = 0, s253 = 0, sStar = 0, nStar = 0;
  const ls = [0, 0, 0, 0], ln = [0, 0, 0, 0];
  for (let k = lo; k >= hi; k--) {
    const d = centerIdx - k;
    if (d < 0 || d >= env.cal.total) continue;
    if (!rep.usable[d]) continue;
    if (!coverOk(env, d, selfEp)) continue;
    const sd = rep.srcOf[d];
    n++;
    s249 += env.dd.f249[sd];
    s241 += env.dd.f241[sd];
    s253 += env.dd.f253[sd];
    if (env.dd.laneBal[sd] >= 0) { sStar += env.dd.laneBal[sd]; nStar++; }
    for (let L = 0; L < 4; L++) {
      const v = env.dd.laneF[L][sd];
      if (v >= 0) { ls[L] += v; ln[L]++; }
    }
  }
  if (n === 0) return null;
  return {
    n,
    mean: s249 / n,
    lane: ls.map((v, L) => (ln[L] > 0 ? v / ln[L] : null)),
    laneN: ln,
    fstar: nStar > 0 ? sStar / nStar : null,
    f241: s241 / n,
    f253: s253 / n,
  };
}

interface Diagnostics {
  lanes: { lane: string; ep: number | null; ctl: number | null; delta: number | null }[];
  laneBalanced: { ep: number | null; ctl: number | null; delta: number | null };
  carryingLanes: string[];
  singleLane: boolean;
  lofo: { family: string; epUsed: number; dW: number | null }[];
  farNear: {
    far: { ep: number | null; ctl: number | null; delta: number | null };
    near: { ep: number | null; ctl: number | null; delta: number | null };
    nearOnly: boolean;
  };
  epochs: { label: string; epUsed: number; ctlWindows: number; dW: number | null }[];
  tau: { byte: number; tauPct: number; ep: number | null; ctl: number | null; delta: number | null }[];
  motion: { ep: number | null; ctl: number | null; delta: number | null; epDropped: number; ctlDropped: number };
}

function computeDiagnostics(env: Env, rep: Rep, t1: Test1Stat): Diagnostics {
  const perEp = t1.perEp!;
  // aggregate rich windows: mean-of-window-means; windows with no eligible days skipped
  type Agg = { s: number; n: number };
  const mk = (): Agg => ({ s: 0, n: 0 });
  const add = (a: Agg, v: number | null) => { if (v !== null) { a.s += v; a.n++; } };
  const val = (a: Agg) => (a.n > 0 ? a.s / a.n : null);

  const epLane = [mk(), mk(), mk(), mk()], ctlLane = [mk(), mk(), mk(), mk()];
  const epStar = mk(), ctlStar = mk();
  const ep241 = mk(), ctl241 = mk(), ep253 = mk(), ctl253 = mk();
  const epFar = mk(), ctlFar = mk(), epNear = mk(), ctlNear = mk();
  const epM = mk(), ctlM = mk();
  let epMDropped = 0, ctlMDropped = 0;

  for (let e = 0; e < perEp.length; e++) {
    const pe = perEp[e];
    if (pe.Wa === null) continue; // dropped windows carry nothing
    const o = env.epOnsetIdx[e];
    const rw = richWindow(env, rep, o, WIN_LO, WIN_HI, e);
    if (rw) {
      for (let L = 0; L < 4; L++) add(epLane[L], rw.lane[L]);
      add(epStar, rw.fstar);
      add(ep241, rw.f241);
      add(ep253, rw.f253);
    }
    add(epFar, windowStats(env, rep, o, FAR_LO, FAR_HI, e).mean);
    add(epNear, windowStats(env, rep, o, NEAR_LO, NEAR_HI, e).mean);
    const m = motionM(env, rep, o, e);
    if (m.M === null) epMDropped++; else add(epM, m.M);
    for (const c of pe.ctlIdxs) {
      const cw = richWindow(env, rep, c, WIN_LO, WIN_HI, -1);
      if (cw) {
        for (let L = 0; L < 4; L++) add(ctlLane[L], cw.lane[L]);
        add(ctlStar, cw.fstar);
        add(ctl241, cw.f241);
        add(ctl253, cw.f253);
      }
      add(ctlFar, windowStats(env, rep, c, FAR_LO, FAR_HI, -1).mean);
      add(ctlNear, windowStats(env, rep, c, NEAR_LO, NEAR_HI, -1).mean);
      const cm = motionM(env, rep, c, -1);
      if (cm.M === null) ctlMDropped++; else add(ctlM, cm.M);
    }
  }

  const lanes = LANES.map((name, L) => {
    const e = val(epLane[L]), c = val(ctlLane[L]);
    return { lane: `F_${name}`, ep: e, ctl: c, delta: e !== null && c !== null ? e - c : null };
  });
  const carrying = lanes.filter((l) => l.delta !== null && l.delta > 0).sort((a, b) => (b.delta! - a.delta!)).map((l) => l.lane);
  const positive = lanes.filter((l) => l.delta !== null && l.delta > 0).length;

  // leave-one-family-out: episodes containing the family removed; masks/controls unchanged
  const families = [...new Set(env.episodes.flatMap((e) => e.families))].sort();
  const lofo = families.map((f) => {
    let eS = 0, eN = 0, cS = 0, cN = 0;
    for (let e = 0; e < perEp.length; e++) {
      const pe = perEp[e];
      if (pe.Wa === null || pe.families.includes(f)) continue;
      eS += pe.Wa; eN++;
      for (const cw of pe.ctlWs) { cS += cw; cN++; }
    }
    return { family: f, epUsed: eN, dW: eN > 0 && cN > 0 ? eS / eN - cS / cN : null };
  });

  // epoch split 1990–2005 vs 2006–2021
  const splitIdx = env.cal.idx(EPOCH_SPLIT);
  const epochs = [
    { label: "1990-2005", test: (e: number) => env.epOnsetIdx[e] < splitIdx },
    { label: "2006-2021", test: (e: number) => env.epOnsetIdx[e] >= splitIdx },
  ].map(({ label, test }) => {
    let eS = 0, eN = 0, cS = 0, cN = 0;
    for (let e = 0; e < perEp.length; e++) {
      const pe = perEp[e];
      if (pe.Wa === null || !test(e)) continue;
      eS += pe.Wa; eN++;
      for (const cw of pe.ctlWs) { cS += cw; cN++; }
    }
    return { label, epUsed: eN, ctlWindows: cN, dW: eN > 0 && cN > 0 ? eS / eN - cS / cN : null };
  });

  const eF = val(epFar), cF = val(ctlFar), eN2 = val(epNear), cN2 = val(ctlNear);
  const dFar = eF !== null && cF !== null ? eF - cF : null;
  const dNear = eN2 !== null && cN2 !== null ? eN2 - cN2 : null;
  const e241 = val(ep241), c241 = val(ctl241), e253 = val(ep253), c253 = val(ctl253);
  const eSt = val(epStar), cSt = val(ctlStar);
  const eM = val(epM), cM = val(ctlM);

  return {
    lanes,
    laneBalanced: { ep: eSt, ctl: cSt, delta: eSt !== null && cSt !== null ? eSt - cSt : null },
    carryingLanes: carrying,
    singleLane: positive === 1,
    lofo,
    farNear: {
      far: { ep: eF, ctl: cF, delta: dFar },
      near: { ep: eN2, ctl: cN2, delta: dNear },
      nearOnly: dNear !== null && dNear > 0 && (dFar === null || dFar <= 0),
    },
    epochs,
    tau: [
      { byte: TAU_DIAG_BYTES[0], tauPct: 0.95, ep: e241, ctl: c241, delta: e241 !== null && c241 !== null ? e241 - c241 : null },
      { byte: TAU_DIAG_BYTES[1], tauPct: 0.995, ep: e253, ctl: c253, delta: e253 !== null && c253 !== null ? e253 - c253 : null },
    ],
    motion: { ep: eM, ctl: cM, delta: eM !== null && cM !== null ? eM - cM : null, epDropped: epMDropped, ctlDropped: ctlMDropped },
  };
}

// ─── coverage-cliff receipt table ───────────────────────────────────────────────
function coverageTable(store: FusionStore, cal: Cal, dd: DayData): { year: number; days: number; medianReporting: number }[] {
  const byYear = new Map<number, number[]>();
  for (const day of store.days) {
    const d = cal.idx(day);
    if (d < 0 || d >= cal.total) continue;
    const y = cal.year[d];
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(dd.rep[d]);
  }
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, reps]) => {
      reps.sort((a, b) => a - b);
      return { year, days: reps.length, medianReporting: reps[reps.length >> 1] };
    });
}

// ─── the core payload (computed twice for G3, byte-compared) ────────────────────
export function runFusionOnce(inputs: FusionInputs, opts: FusionOpts) {
  const rollCall = opts.rollCall ?? PRODUCTION_ROLLCALL;
  const env = buildEnv(inputs, opts.seed);
  const cliff = coverageTable(inputs.store, env.cal, env.dd);
  let eraDayFloorFails = 0;
  for (let d = env.eraStartIdx; d <= env.eraEndIdx; d++) if (!env.dd.ok[d]) eraDayFloorFails++;

  // the run of record: observed + exhaustive 67 rotations + G0 (real store view)
  const real = runBattery(env, null, rollCall);

  // G2 (D1): ONE seeded outer rotation; the COMPLETE pipeline (both tests, the
  // gates' logic) runs on the rotated store; both tests must FAIL there.
  const outerOffset =
    SHIFT_MIN + Math.floor(seededRng(fnv(`${opts.seed}|outer-shift`))() * (SHIFT_MAX - SHIFT_MIN + 1));
  const g2Battery = runBattery(env, makeRemap(env.cal, outerOffset), rollCall);
  const g2Pass = !g2Battery.test1Pass && !g2Battery.test2Pass;

  const diagnostics = computeDiagnostics(env, makeRep(env, null), real.t1);

  return {
    params: {
      registration: "REGISTRATION-FUSION-V2.md (frozen 2026-07-16)",
      seed: opts.seed,
      tauPrimaryByte: TAU_PRIMARY_BYTE,
      tauDiagBytes: TAU_DIAG_BYTES,
      slotSet: `v1 offsets 0-${NSLOT_V1 - 1} (PNA excluded)`,
      lutYearsFloor: LUT_YEARS_FLOOR,
      dayFloor: `${DAY_FLOOR}/${NSLOT_V1}`,
      windowFloor: `${WINDOW_FLOOR}/14`,
      preWindow: "D-14..D-1",
      farNearWindows: "D-14..D-4 / D-3..D-1",
      outcomeWindow: "+1..+14",
      mergeRule: "span overlap or ±7d AND states intersect, transitive",
      controlMask: "±30d episode / span membership any tier",
      controlsPerEpisode: MAX_CONTROLS,
      rotations: `exhaustive ${SHIFT_MIN}..${SHIFT_MAX} (${N_ROTATIONS} replicates, p = 1/${N_ROTATIONS + 1})`,
      anchorEra: `${ERA_START}..${ERA_END}`,
      scanEra: `${ERA_START}..${ERA_END}`,
      epochSplit: "1990-2005 vs 2006-2021",
      layoutVersion: inputs.store.version,
    },
    receipts: {
      frameDays: inputs.store.days.length,
      calendarDays: env.cal.total,
      dayRange: [inputs.store.days[0], inputs.store.days[inputs.store.days.length - 1]],
      coverageCliff: cliff,
      eraDayFloorFails,
      anchorFingerprint: { rawCount: env.receipts.rawCount, memberIdHash: env.receipts.fingerprint },
      mergedEpisodes: {
        majorEffective: env.receipts.majorEffective,
        excludedPost2021: env.receipts.excludedPost2021,
        inEra: env.receipts.inEra,
        pooledEpisodes: env.receipts.episodes,
      },
      // §9: b computed and printed BEFORE any W-vs-outcome contrast — this is the
      // number the 2b bar is set from.
      postMaskingBaseRate: real.t2.b,
      topDecileBar: 2 * real.t2.b,
    },
    g0: { pass: real.g0.pass, rows: real.g0.rows, exclusion: real.g0.exclusion },
    g2: {
      outerOffset,
      test1PassOnRotated: g2Battery.test1Pass,
      test2PassOnRotated: g2Battery.test2Pass,
      pass: g2Pass,
      rotated: {
        dW: g2Battery.t1.dW,
        b: g2Battery.t2.b,
        topRate: g2Battery.t2.topRate,
        lift: g2Battery.t2.lift,
        g0Pass: g2Battery.g0.pass,
        coverageMatched: g2Battery.coverageMatched,
      },
    },
    test1: {
      pass: real.test1Pass,
      dW: real.t1.dW,
      meanWEpisodes: real.t1.meanWep,
      meanWControls: real.t1.meanWctl,
      episodesUsed: real.t1.epUsed,
      episodesDropped: real.t1.epDropped,
      droppedOnsets: real.t1.droppedOnsets,
      zeroControlEpisodes: real.t1.zeroControlEps,
      controlWindows: real.t1.ctlWindows,
      rotations: real.rotations.map((r) => ({ offset: r.offset, dW: r.dW, epUsed: r.epUsed, epDropped: r.epDropped })),
      maxRotationDW: real.rotations.reduce<number | null>((m, r) => (r.dW === null ? m : m === null || r.dW > m ? r.dW : m), null),
    },
    test2: {
      pass: real.test2Pass,
      b: real.t2.b,
      topDecileRate: real.t2.topRate,
      topDecileBar: 2 * real.t2.b,
      lift: real.t2.lift,
      eligibleScanDays: real.t2.eligibleScanDays,
      droppedWindows: real.t2.droppedWindows,
      inSpanExcluded: real.t2.inSpanExcluded,
      deciles: real.t2.deciles,
      spearmanRho: real.t2.spearmanRho,
      rotations: real.rotations.map((r) => ({ offset: r.offset, b: r.b, topRate: r.topRate, lift: r.lift, dropped: r.t2Dropped })),
      maxRotationLift: real.rotations.reduce<number | null>((m, r) => (m === null || r.lift > m ? r.lift : m), null),
    },
    controls: {
      coverageMatched: real.coverageMatched,
      meanYearGap: real.t1.meanYearGap,
      anchorRepMean: real.t1.epRepMean,
      controlRepMean: real.t1.ctlRepMean,
      repGap: real.t1.repGap,
    },
    diagnostics,
    episodes: env.episodes.map((ep, e) => ({
      onset: ep.onset,
      spanEnd: ep.span.end,
      families: ep.families,
      tier: ep.tier,
      members: ep.nEffMembers,
      deaths: ep.deaths,
      Wa: real.t1.perEp![e].Wa,
      nControls: real.t1.perEp![e].ctlIdxs.length,
    })),
  };
}

export type CorePayload = ReturnType<typeof runFusionOnce>;

export interface FusionResult {
  payload: CorePayload & {
    g3: { pass: boolean; bytes: number };
    verdict: { g0: boolean; g2: boolean; g3: boolean; test1: boolean; test2: boolean; caveats: string[]; final: string };
  };
  json: string;
  report: string;
}

export function runFusion(inputs: FusionInputs, opts: FusionOpts): FusionResult {
  // G3: the full payload recomputed a second time in-process, byte-compared.
  const p1 = runFusionOnce(inputs, opts);
  const p2 = runFusionOnce(inputs, opts);
  const j1 = JSON.stringify(p1);
  const j2 = JSON.stringify(p2);
  const g3 = { pass: j1 === j2, bytes: j1.length };

  const caveats: string[] = [];
  if (p1.diagnostics.farNear.nearOnly) {
    caveats.push(
      "PRIMARY PASSES ONLY THROUGH W_near (D-3..D-1): 'storms precede storm damage' is meteorology, not fusion (§6)."
    );
  }
  if (p1.diagnostics.carryingLanes.length > 0) {
    caveats.push(`Carrying lane(s): ${p1.diagnostics.carryingLanes.join(", ")}.`);
  }
  if (p1.diagnostics.singleLane) {
    caveats.push(
      "THE ENTIRE EFFECT IS ONE LANE — the report may NOT claim 'fusion in unfused data' (§11.1)."
    );
  }

  let final: string;
  if (!g3.pass) {
    final = "RUN INVALID — G3 determinism failure (two in-process recomputes differ byte-wise).";
  } else if (!p1.g0.pass) {
    final =
      "METRIC INVALID — G0 failed; no verdict is read from Tests 1/2. " +
      "One pre-declared metric repair permitted (re-freeze with version bump, documented diff); the timebox clock does not pause (§10).";
  } else if (!p1.g2.pass) {
    final = "RUN INVALID — G2 negative control failed: a test PASSED on rotated data (§10).";
  } else if (p1.test1.pass && p1.test2.pass) {
    final =
      "FUSION CONFIRMED at board altitude on the 1990-2021 substrate — both tests beat all 67 rotations " +
      "(Test 2 also ≥ 2b); timebox gate 2 passes; re-hearing earned (§12)." +
      (caveats.length ? " CAVEATS: " + caveats.join(" ") : "");
  } else {
    final =
      "The fusion thesis AS STATED is dead at this altitude on this substrate generation — " +
      `Test 1 ${p1.test1.pass ? "PASS" : "FAIL"}, Test 2 ${p1.test2.pass ? "PASS" : "FAIL"}; ` +
      "the timebox default (mothball at 2026-08-10) proceeds (§12).";
  }

  const payload = {
    ...p1,
    g3,
    verdict: { g0: p1.g0.pass, g2: p1.g2.pass, g3: g3.pass, test1: p1.test1.pass, test2: p1.test2.pass, caveats, final },
  };
  return { payload, json: JSON.stringify(payload, null, 1), report: renderFusionReport(payload) };
}

// ─── report (run-of-record order; no timestamps) ────────────────────────────────
const f4 = (x: number | null) => (x === null || !Number.isFinite(x) ? "—" : x.toFixed(4));
const f6 = (x: number | null) => (x === null || !Number.isFinite(x) ? "—" : x.toFixed(6));

function renderFusionReport(p: FusionResult["payload"]): string {
  const L: string[] = [];
  L.push(`# FUSION FORMATION TEST — mine v2.0 (board altitude)`);
  L.push(``);
  L.push(`Registration: ${p.params.registration} · seed ${p.params.seed} · pass bar: strictly beat all ${SHIFT_MAX - SHIFT_MIN + 1} rotations (p = 1/68 each; tests share substrate and anchors — dependence acknowledged, the joint pass is NOT 0.0147²).`);
  L.push(``);

  L.push(`## 1. SUBSTRATE RECEIPTS`);
  L.push(``);
  L.push(`- frames: ${p.receipts.frameDays} days, ${p.receipts.dayRange[0]} → ${p.receipts.dayRange[1]} (layout v${p.params.layoutVersion})`);
  L.push(`- slot set: ${p.params.slotSet}; τ primary byte ≥ ${p.params.tauPrimaryByte}; day floor ${p.params.dayFloor}; window floor ${p.params.windowFloor}`);
  L.push(`- era day-floor failures (${p.params.scanEra}): ${p.receipts.eraDayFloorFails} days excluded from all windows, controls, and scans`);
  L.push(`- anchor fingerprint: raw ${p.receipts.anchorFingerprint.rawCount}, member-id hash ${p.receipts.anchorFingerprint.memberIdHash}`);
  const m = p.receipts.mergedEpisodes;
  L.push(`- merged-episode receipt: ${m.majorEffective} MAJOR effective → ${m.excludedPost2021} excluded (onset ≥ 2022-01-01, amendment A5) → ${m.inEra} in era → ${m.pooledEpisodes} pooled episodes (cross-family merge §4)`);
  L.push(`- **post-masking base rate b = ${f6(p.receipts.postMaskingBaseRate)}** (computed BEFORE any W-vs-outcome contrast; Test 2 top-decile bar = 2b = ${f6(p.receipts.topDecileBar)})`);
  L.push(``);
  L.push(`coverage-cliff receipt (median reporting slots of ${NSLOT_V1} per year; day floor ${DAY_FLOOR}):`);
  L.push(``);
  L.push(`| year | days | median reporting |`);
  L.push(`|---|---|---|`);
  const cliff = p.receipts.coverageCliff;
  const show = cliff.length <= 16 ? cliff : cliff.filter((r) => r.year % 10 === 0 || r.year >= 2018);
  for (const r of show) L.push(`| ${r.year} | ${r.days} | ${r.medianReporting} |`);
  L.push(``);

  L.push(`## 2. G0 — POSITIVE-CONTROL ROLL CALL`);
  L.push(``);
  L.push(`| event | episode onset | W(a) | ctl median | ctl p75 | n ctl | pre-window rep | > median | > p75 |`);
  L.push(`|---|---|---|---|---|---|---|---|---|`);
  for (const r of p.g0.rows) {
    L.push(`| ${r.name} | ${r.onset ?? "NOT FOUND"} | ${f4(r.Wa)} | ${f4(r.ctlMedian)} | ${f4(r.ctlP75)} | ${r.nControls} | ${r.preWindowRepMean === null ? "—" : r.preWindowRepMean.toFixed(1)} | ${r.beatsMedian ? "YES" : "no"} | ${r.beatsP75 ? "YES" : "no"} |`);
  }
  L.push(``);
  L.push(`${p.g0.exclusion}`);
  L.push(``);
  L.push(`**G0: ${p.g0.pass ? "PASS" : "FAIL — METRIC INVALID; no verdict is read from Tests 1/2 (§10)"}**`);
  L.push(``);

  L.push(`## 3. G2 — FULL-PIPELINE NEGATIVE CONTROL`);
  L.push(``);
  L.push(`Outer rotation ${p.g2.outerOffset} years (seeded). Complete pipeline on the rotated store:`);
  L.push(`- Test 1 on rotated data: ΔW = ${f6(p.g2.rotated.dW)} → ${p.g2.test1PassOnRotated ? "PASS (INVALIDATES THE RUN)" : "FAIL (correct)"}`);
  L.push(`- Test 2 on rotated data: b = ${f6(p.g2.rotated.b)}, top decile ${f6(p.g2.rotated.topRate)}, lift ${f4(p.g2.rotated.lift)} → ${p.g2.test2PassOnRotated ? "PASS (INVALIDATES THE RUN)" : "FAIL (correct)"}`);
  L.push(`- rotated G0 (reported, not the gate): ${p.g2.rotated.g0Pass ? "pass" : "fail"}`);
  L.push(``);
  L.push(`**G2: ${p.g2.pass ? "PASS (both tests fail on rotated data)" : "FAIL — a test passed on rotated data; the run is invalid"}**`);
  L.push(``);

  L.push(`## 4. G3 — DETERMINISM`);
  L.push(``);
  L.push(`Full payload recomputed a second time in-process and byte-compared: ${p.g3.pass ? `IDENTICAL (${p.g3.bytes} bytes)` : "MISMATCH — RUN INVALID"}. No timestamps; Math.random banned; RNG consumption order fixed.`);
  L.push(``);

  L.push(`## 5. TEST 1 — PRIMARY CONTRAST (ΔW vs exhaustive 67 rotations)`);
  L.push(``);
  L.push(`- ΔW = mean W(episodes) − mean W(controls) = ${f6(p.test1.meanWEpisodes)} − ${f6(p.test1.meanWControls)} = **${f6(p.test1.dW)}**`);
  L.push(`- episodes used ${p.test1.episodesUsed}, dropped ${p.test1.episodesDropped} (<${WINDOW_FLOOR}/14 eligible)${p.test1.droppedOnsets.length ? `: ${p.test1.droppedOnsets.join(", ")}` : ""}`);
  L.push(`- control windows ${p.test1.controlWindows}; episodes with zero controls ${p.test1.zeroControlEpisodes}`);
  L.push(`- max rotation ΔW = ${f6(p.test1.maxRotationDW)} over 67 replicates (offsets ${SHIFT_MIN}..${SHIFT_MAX})`);
  const t1drops = p.test1.rotations.map((r) => r.epDropped);
  L.push(`- per-replicate dropped-episode counts (offsets ${SHIFT_MIN}..${SHIFT_MAX}): ${t1drops.join(" ")} (min ${Math.min(...t1drops)}, max ${Math.max(...t1drops)})`);
  L.push(``);
  L.push(`**TEST 1: ${p.test1.pass ? "PASS — ΔW strictly exceeds all 67 rotations" : "FAIL"}**`);
  L.push(``);

  L.push(`## 6. TEST 2 — DOSE-RESPONSE (month-stratified deciles)`);
  L.push(``);
  L.push(`- eligible scan days ${p.test2.eligibleScanDays} (dropped windows ${p.test2.droppedWindows}; in-span excluded ${p.test2.inSpanExcluded})`);
  const t2drops = p.test2.rotations.map((r) => r.dropped);
  L.push(`- per-replicate dropped-window counts (offsets ${SHIFT_MIN}..${SHIFT_MAX}): ${t2drops.join(" ")}`);
  L.push(`- b (post-masking) = ${f6(p.test2.b)}; bar = 2b = ${f6(p.test2.topDecileBar)}`);
  L.push(``);
  L.push(`| decile | days | followed | rate |`);
  L.push(`|---|---|---|---|`);
  for (const d of p.test2.deciles ?? []) L.push(`| ${d.decile} | ${d.n} | ${d.followed} | ${f4(d.rate)} |`);
  L.push(``);
  L.push(`- top decile rate ${f6(p.test2.topDecileRate)} (${p.test2.topDecileRate >= p.test2.topDecileBar ? "≥ 2b" : "< 2b"}); lift ${f4(p.test2.lift)}; max rotation lift ${f4(p.test2.maxRotationLift)}`);
  L.push(`- Spearman ρ across deciles = ${f4(p.test2.spearmanRho)} (DESCRIPTIVE only — struck from PASS semantics, D5)`);
  L.push(``);
  L.push(`**TEST 2: ${p.test2.pass ? "PASS — top decile ≥ 2b AND lift strictly exceeds all 67 rotations" : "FAIL"}**`);
  L.push(``);

  L.push(`## 7. MANDATORY HONESTY DIAGNOSTICS (§11 — never gate, never promoted)`);
  L.push(``);
  L.push(`### Lane decomposition`);
  L.push(``);
  L.push(`| lane | episodes | controls | Δ |`);
  L.push(`|---|---|---|---|`);
  for (const l of p.diagnostics.lanes) L.push(`| ${l.lane} | ${f6(l.ep)} | ${f6(l.ctl)} | ${f6(l.delta)} |`);
  const lb = p.diagnostics.laneBalanced;
  L.push(`| F* (lane-balanced, declared secondary) | ${f6(lb.ep)} | ${f6(lb.ctl)} | ${f6(lb.delta)} |`);
  L.push(``);
  L.push(`Carrying lane(s): ${p.diagnostics.carryingLanes.length ? p.diagnostics.carryingLanes.join(", ") : "none positive"}${p.diagnostics.singleLane ? " — SINGLE-LANE EFFECT: may NOT be claimed as 'fusion in unfused data'" : ""}.`);
  L.push(``);
  L.push(`### Leave-one-family-out (masks and controls unchanged; diagnostic)`);
  L.push(``);
  L.push(`| family removed | episodes left | ΔW |`);
  L.push(`|---|---|---|`);
  for (const r of p.diagnostics.lofo) L.push(`| ${r.family} | ${r.epUsed} | ${f6(r.dW)} |`);
  L.push(``);
  L.push(`### W_far / W_near (declared secondaries)`);
  L.push(``);
  const fn = p.diagnostics.farNear;
  L.push(`- W_far (D-14..D-4): episodes ${f6(fn.far.ep)} vs controls ${f6(fn.far.ctl)} → Δ ${f6(fn.far.delta)}`);
  L.push(`- W_near (D-3..D-1): episodes ${f6(fn.near.ep)} vs controls ${f6(fn.near.ctl)} → Δ ${f6(fn.near.delta)}`);
  if (fn.nearOnly) L.push(`- **HEADLINE CAVEAT: the effect lives only in W_near** — "storms precede storm damage" is meteorology, not fusion.`);
  L.push(``);
  L.push(`### Epoch split`);
  L.push(``);
  for (const e of p.diagnostics.epochs) L.push(`- ${e.label}: ΔW ${f6(e.dW)} (${e.epUsed} episodes, ${e.ctlWindows} control windows)`);
  L.push(``);
  L.push(`### τ diagnostics (labeled, never promoted)`);
  L.push(``);
  for (const t of p.diagnostics.tau) L.push(`- byte ≥ ${t.byte} (τ ${t.tauPct}): episodes ${f6(t.ep)} vs controls ${f6(t.ctl)} → Δ ${f6(t.delta)}`);
  L.push(``);
  L.push(`### M(a) motion (declared secondary)`);
  L.push(``);
  const mo = p.diagnostics.motion;
  L.push(`- M episodes ${f6(mo.ep)} vs controls ${f6(mo.ctl)} → Δ ${f6(mo.delta)} (dropped: ${mo.epDropped} episode / ${mo.ctlDropped} control windows under the ≥${WINDOW_FLOOR} floors)`);
  L.push(``);
  L.push(`### Control honesty lines`);
  L.push(``);
  L.push(`- achieved mean |year gap| = ${f4(p.controls.meanYearGap)} years`);
  L.push(`- mean reporting count: anchors ${p.controls.anchorRepMean === null ? "—" : p.controls.anchorRepMean.toFixed(2)} vs controls ${p.controls.controlRepMean === null ? "—" : p.controls.controlRepMean.toFixed(2)} (gap ${p.controls.repGap.toFixed(2)}; tolerance ${COVERAGE_GAP_TOLERANCE})`);
  L.push(`- coverage-matched resampling ${p.controls.coverageMatched ? "TRIGGERED (ruling B(f)) — controls re-drawn preferring candidates within 2 slots of the anchor window's mean reporting count, identically in every replicate" : "not triggered"}`);
  L.push(``);

  L.push(`## 8. VERDICT (§12)`);
  L.push(``);
  L.push(`- G0 ${p.verdict.g0 ? "PASS" : "FAIL"} · G2 ${p.verdict.g2 ? "PASS" : "FAIL"} · G3 ${p.verdict.g3 ? "PASS" : "FAIL"} · Test 1 ${p.verdict.test1 ? "PASS" : "FAIL"} · Test 2 ${p.verdict.test2 ? "PASS" : "FAIL"}`);
  for (const c of p.verdict.caveats) L.push(`- ${c}`);
  L.push(``);
  L.push(`**${p.verdict.final}**`);
  L.push(``);
  return L.join("\n");
}

// ─── CLI (run of record — production only; fired by the main session, never by tests) ─
function parseArgs(): { seed: number; jsonOnly: boolean } {
  const argv = process.argv.slice(2);
  let seed = SEED_DEFAULT;
  let jsonOnly = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--seed") seed = Number(argv[++i]);
    else if (argv[i] === "--json-only") jsonOnly = true;
    else {
      console.error(`unknown arg ${argv[i]}\nusage: npx tsx scripts/mine/fusion-formation.ts [--seed 42] [--json-only]`);
      process.exit(1);
    }
  }
  if (!Number.isFinite(seed)) throw new Error("--seed must be a number");
  return { seed, jsonOnly };
}

async function main() {
  const { seed, jsonOnly } = parseArgs();
  const t0 = Date.now();
  const [anchorSet, store] = await Promise.all([loadAnchors(), loadFrameStore()]);
  if (store.slots.length < NSLOT_V1) throw new Error(`layout has ${store.slots.length} slots — need the ${NSLOT_V1} v1 offsets`);
  if (store.version !== LAYOUT_VERSION_PINNED)
    throw new Error(`layout version ${store.version} ≠ pinned ${LAYOUT_VERSION_PINNED} — substrate re-baked; §2 requires a re-freeze + registration version bump`);
  if (store.days.length < MIN_FRAME_DAYS)
    throw new Error(`frame store has ${store.days.length} days < ${MIN_FRAME_DAYS} — §2 substrate receipt violated`);
  console.error(`[fusion] loaded ${anchorSet.raw.length} raw anchors, ${store.days.length} frames — ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const res = runFusion(
    { store, rawCount: anchorSet.raw.length, effective: anchorSet.effective },
    { seed }
  );
  const outDir = join(dirname(fileURLToPath(import.meta.url)), "out");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "fusion-v2.json"), res.json);
  console.error(`[fusion] wrote ${join(outDir, "fusion-v2.json")}`);
  if (!jsonOnly) {
    writeFileSync(join(outDir, "FUSION-REPORT.md"), res.report);
    console.error(`[fusion] wrote ${join(outDir, "FUSION-REPORT.md")}`);
  }
  process.stdout.write(res.report + "\n");
  console.error(`[fusion] total wall time ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((e) => {
    console.error("FATAL:", e);
    process.exit(1);
  });
}
