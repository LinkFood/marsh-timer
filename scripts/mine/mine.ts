/**
 * mine.ts — THE LOOKOUT MINE orchestrator (docs/THE-WEEK.md PARK LIST: THE
 * LOOKOUT MINE / THE NEAR-MISS LAW / THE SENTRY).
 *
 * Outcome-first retrodiction: anchor on every stitched OUTCOME (anchors.ts),
 * walk every board column (frames.ts — 142 manifest slots + 2 moon pseudo-slots
 * + 1 board-energy depth column) backward through D-30..D0 vs seeded
 * matched-season controls, Fisher-test every (cell × column × τ × k × lead)
 * candidate, correct the ENTIRE sweep as ONE family — BH per spec as a
 * diagnostic, plus a shuffle-calibrated empirical FDR as the shipping filter
 * (see empiricalQValues: G2 proved window-level Fisher + BH admits year-
 * clustering noise wholesale) — then grade every non-D0 survivor by the
 * NEAR-MISS LAW (cliff at the boundary = FUSION, slope = DECORATION-KILL),
 * its false-alarm denominator in both directions, and its empirical cliff.
 *
 * READ-ONLY vs the DB (both loaders are GET-only). No timestamps in outputs —
 * same --seed twice must be byte-identical (G3). --shuffle permutes anchor
 * years (seeded) and re-runs as the mine's own honesty line (G2). The AO low
 * slot rediscovering the famous winter roll call is the acceptance anchor (G1).
 *
 * Usage:
 *   npx tsx scripts/mine/mine.ts [--family winter] [--seed 42] [--shuffle] [--json-only]
 * Outputs (gitignored):
 *   scripts/mine/out/lookout-candidates.json          (main; -shuffle.json for --shuffle)
 *   scripts/mine/out/LOOKOUT-REPORT.md                (skipped with --json-only / --shuffle)
 */

import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { loadAnchors, EffectiveAnchor } from "./anchors";
import {
  loadFrameStore,
  FrameStore,
  NSLOT,
  SYNODIC_DAYS,
  doyOfIso,
  invertPct,
  moonPhase,
} from "./frames";
import {
  benjaminiHochberg,
  fisherExactOneSided,
  lift,
  cliffSweep,
  nearMissVerdict,
  seededRng,
  wilsonInterval,
} from "./stats";
import {
  renderReport,
  MinePayload,
  CandidateRow,
  Survivor,
  DeepDive,
  FireEpisode,
  GateG1,
  WilsonCI,
} from "./report";

// ─── the grid (spec is ground truth) ─────────────────────────────────────────────
const TAU_PCT = [0.9, 0.95, 0.98];
const TAU_BYTE = [229, 241, 249]; // byte thresholds per spec (byte/254 ≥ τ, 255=null)
const DEPTH_TAU = [5, 10, 15]; // board-energy column: counts of slots ≥ 0.98 (byte ≥ 249)
const K_GRID = [1, 3, 7];
const LEADS = [
  { id: "D-30..D-8", lo: 8, hi: 30, len: 23, bucket: 0 },
  { id: "D-7..D-1", lo: 1, hi: 7, len: 7, bucket: 1 },
  { id: "D0", lo: 0, hi: 0, len: 1, bucket: 2 },
] as const;
const CONTROL_YEARS: [number, number] = [1990, 2025]; // NEVER 1950–89 — unlabeled era would poison control rates
const MAX_CONTROLS = 8;
const NULL_GUARD_MIN_READABLE = 20; // of 31 window days
const FLOOR_N_EFF = 20;
const FLOOR_YEARS = 10;
const BH_Q = 0.05;
const K_NULL = 20; // internal year-permuted null sweeps for the calibrated FDR
const NEAR_BAND_BYTE = 13; // [τ−0.05, τ) → 0.05 × 254 = 12.7 → 13 bytes
const NEAR_BAND_DEPTH = 3; // count analog of the 0.05 band for the depth column
const EPISODE_GAP = 7; // fire days >7d apart = separate episodes
const FOLLOW_LO = 2;
const FOLLOW_HI = 30; // "followed" = same-family anchor begins +2..+30d after a fire day
const SEASON_HALF = 15; // matched season = doy within ±15 of any cell anchor doy
const EXCLUDE_DAYS = 45; // control windows: no same-family (scoped) anchor within ±45d
const LABELED_START = "1990-01-01";

// ─── severity tiers (coordinator ruling 2026-07-12) ────────────────────────────────
// The ALL-grain G1 autopsy: at all-severity national grain the outcome side is
// saturated (base rates 0.38–0.66), so the near-miss FUSION bar (2× the sideband,
// floored at base) is mathematically unreachable. The doctrine's proof-probe was a
// roll call of CATASTROPHES — so cells are tiered by severity of the MERGED
// effective anchor (summed member deaths/damage, as anchors.ts exports).
// Tiered cells grade FA/near-miss follows against SAME-TIER-OR-WORSE outcomes only
// (an event-of-any-size following does not vindicate a MAJOR lookout); control
// exclusion still avoids anchors of ANY tier (a window sitting on a minor flood is
// not a clean control for major floods). Floors unchanged; tiers that fail floors
// are untested and say so in the payload's tierCells table.
type Tier = "ALL" | "SEVERE" | "MAJOR";
const TIERS: Tier[] = ["ALL", "SEVERE", "MAJOR"];
const TIER_RULE: Record<Tier, (e: EffectiveAnchor) => boolean> = {
  ALL: () => true,
  SEVERE: (e) => e.deaths >= 1 || e.damageUsd >= 50e6,
  MAJOR: (e) => e.deaths >= 10 || e.damageUsd >= 250e6,
};
const TIER_DESC: Record<Tier, string> = {
  ALL: "every effective anchor (baseline/diagnostic)",
  SEVERE: "deaths ≥ 1 OR damage ≥ $50M",
  MAJOR: "deaths ≥ 10 OR damage ≥ $250M",
};

interface MineCell {
  family: string;
  region: string; // "US" or state abbr
  tier: Tier;
  nEff: number;
  distinctYears: number;
  eligible: boolean;
}

const cellKeyOf = (c: MineCell) => `${c.tier}:${c.family}/${c.region}`;

/**
 * Tiered eligibility cells. Mirrors anchors.computeCells (family×national always
 * computed with its eligibility flag; family×state emitted only where floors
 * pass) — replicated here because the committed anchors.ts is tier-blind.
 */
function buildTieredCells(effective: EffectiveAnchor[]): MineCell[] {
  const cells: MineCell[] = [];
  for (const tier of TIERS) {
    const pool = effective.filter(TIER_RULE[tier]);
    const families = [...new Set(pool.map((e) => e.family))].sort();
    for (const family of families) {
      const fam = pool.filter((e) => e.family === family);
      const natYears = new Set(fam.map((e) => e.d0.slice(0, 4)));
      cells.push({
        family,
        region: "US",
        tier,
        nEff: fam.length,
        distinctYears: natYears.size,
        eligible: fam.length >= FLOOR_N_EFF && natYears.size >= FLOOR_YEARS,
      });
      const byState = new Map<string, EffectiveAnchor[]>();
      for (const e of fam) {
        if (!e.primaryState) continue;
        if (!byState.has(e.primaryState)) byState.set(e.primaryState, []);
        byState.get(e.primaryState)!.push(e);
      }
      for (const [state, list] of [...byState.entries()].sort()) {
        const years = new Set(list.map((e) => e.d0.slice(0, 4)));
        if (list.length >= FLOOR_N_EFF && years.size >= FLOOR_YEARS) {
          cells.push({ family, region: state, tier, nEff: list.length, distinctYears: years.size, eligible: true });
        }
      }
    }
  }
  return cells;
}

// ─── CLI ───────────────────────────────────────────────────────────────────────────
function parseArgs() {
  const argv = process.argv.slice(2);
  let seed = 42;
  let family: string | null = null;
  let shuffle = false;
  let jsonOnly = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--seed") seed = Number(argv[++i]);
    else if (argv[i] === "--family") family = argv[++i];
    else if (argv[i] === "--shuffle") shuffle = true;
    else if (argv[i] === "--json-only") jsonOnly = true;
    else {
      console.error(`unknown arg ${argv[i]}\nusage: npx tsx scripts/mine/mine.ts [--family winter] [--seed 42] [--shuffle] [--json-only]`);
      process.exit(1);
    }
  }
  if (!Number.isFinite(seed)) throw new Error("--seed must be a number");
  return { seed, family, shuffle, jsonOnly };
}

// ─── day index math (UTC) ─────────────────────────────────────────────────────────
const DAY_MS = 864e5;
let TS0 = 0;
let TOTAL_DAYS = 0;
let ISO_BY_IDX: string[] = [];
let DOY_BY_IDX: Uint16Array = new Uint16Array(0);
let YEAR_BY_IDX: Uint16Array = new Uint16Array(0);

const idxOfIso = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - TS0) / DAY_MS);
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const pad2 = (n: number) => String(n).padStart(2, "0");

function initCalendar(days: string[]) {
  TS0 = Date.parse(`${days[0]}T00:00:00Z`);
  const tsN = Date.parse(`${days[days.length - 1]}T00:00:00Z`);
  TOTAL_DAYS = Math.round((tsN - TS0) / DAY_MS) + 1;
  ISO_BY_IDX = new Array(TOTAL_DAYS);
  DOY_BY_IDX = new Uint16Array(TOTAL_DAYS);
  YEAR_BY_IDX = new Uint16Array(TOTAL_DAYS);
  for (let i = 0; i < TOTAL_DAYS; i++) {
    const iso = new Date(TS0 + i * DAY_MS).toISOString().slice(0, 10);
    ISO_BY_IDX[i] = iso;
    DOY_BY_IDX[i] = doyOfIso(iso);
    YEAR_BY_IDX[i] = Number(iso.slice(0, 4));
  }
}

// FNV-1a — deterministic 32-bit seed derivation for per-anchor control sampling.
function fnv(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ─── column classes (coordinator ruling 2026-07-12: STRATIFIED calibration) ───────
// The pooled calibration was valid FDR control but misallocated power: monthly-held
// needles generate permutation-null p's down to ~1e-48 (months-long regimes ×
// year-clustered anchors), and pooling forced daily columns to clear that bar —
// AO-MAJOR's honest p=1.9e-8 (cliff crossed, roll call 4/4) died to another
// class's noise physics. Classes are fixed A PRIORI by data resolution — never
// fit to results — and each candidate is calibrated against its OWN class's
// permuted-null pool (per-class q=0.05; per-individual-column pools from K=20
// sweeps would risk thin tails and bar jitter). Per-class bars are reported —
// that number is part of the mine's honesty.
type ColClass = "daily" | "monthly" | "moon" | "depth";
const COL_CLASSES: ColClass[] = ["daily", "monthly", "moon", "depth"];
// monthly-held needles (value constant across the month in the frame store);
// needle-ao is DAILY (CPC daily series 1950+) and stays in class 1.
const MONTHLY_NEEDLES = new Set(["needle-nao", "needle-pdo", "needle-enso"]);

// ─── columns: 142 slots + 2 moon pseudo-slots + 1 depth column = 145 ─────────────
interface Column {
  id: string;
  kind: "slot" | "moon" | "depth";
  cls: ColClass;
  label: string;
  instId: string | null;
  metric: string | null;
  side: "low" | "high" | null;
  taus: { tau: number; thr: number }[]; // tau = pct (slot/moon) or count (depth); thr = byte or count
  vals: Int16Array; // per dayIdx; -1 = null/unreadable
  scale: number; // 254 for slot/moon; 1 for depth (thr already in value units)
}

function buildColumns(store: FrameStore): Column[] {
  const cols: Column[] = [];
  const slotTaus = TAU_PCT.map((t, i) => ({ tau: t, thr: TAU_BYTE[i] }));

  for (let off = 0; off < NSLOT; off++) {
    const s = store.slots[off];
    const inst = store.instruments.get(s.inst_id);
    cols.push({
      id: `slot:${String(off).padStart(3, "0")}:${s.inst_id}:${s.metric}:${s.side}`,
      kind: "slot",
      cls: MONTHLY_NEEDLES.has(s.inst_id) ? "monthly" : "daily",
      label: `${inst?.label ?? s.inst_id} ${s.metric} (${s.side} tail)`,
      instId: s.inst_id,
      metric: s.metric,
      side: s.side,
      taus: slotTaus,
      vals: new Int16Array(TOTAL_DAYS).fill(-1),
      scale: 254,
    });
  }
  for (const [day, bytes] of store.frames) {
    const idx = idxOfIso(day);
    if (idx < 0 || idx >= TOTAL_DAYS) continue;
    for (let off = 0; off < NSLOT; off++) {
      const b = bytes[off];
      if (b !== 255) cols[off].vals[idx] = b;
    }
  }

  // Moon pseudo-slots: pseudo-pct = 1 − dist/(synodic/2), quantized to a byte so
  // they ride the same τ grid. τ=0.90 ⇔ within ~1.48d of new/full ("within-1.5-days").
  const half = SYNODIC_DAYS / 2;
  const mNew = new Int16Array(TOTAL_DAYS);
  const mFull = new Int16Array(TOTAL_DAYS);
  for (let i = 0; i < TOTAL_DAYS; i++) {
    const { phaseDays } = moonPhase(ISO_BY_IDX[i]);
    const dNew = Math.min(phaseDays, SYNODIC_DAYS - phaseDays);
    const dFull = Math.abs(phaseDays - half);
    mNew[i] = Math.round((1 - dNew / half) * 254);
    mFull[i] = Math.round((1 - dFull / half) * 254);
  }
  cols.push({ id: "moon:new", kind: "moon", cls: "moon", label: "Moon — proximity to NEW", instId: null, metric: null, side: null, taus: slotTaus, vals: mNew, scale: 254 });
  cols.push({ id: "moon:full", kind: "moon", cls: "moon", label: "Moon — proximity to FULL", instId: null, metric: null, side: null, taus: slotTaus, vals: mFull, scale: 254 });

  // Board-energy depth column: n slots ≥ 0.98 that day; τ grid on counts.
  const depth = new Int16Array(TOTAL_DAYS).fill(-1);
  for (const [day, bytes] of store.frames) {
    const idx = idxOfIso(day);
    if (idx < 0 || idx >= TOTAL_DAYS) continue;
    let c = 0;
    for (let off = 0; off < NSLOT; off++) {
      const b = bytes[off];
      if (b !== 255 && b >= 249) c++;
    }
    depth[idx] = c;
  }
  cols.push({
    id: "depth:ge0.98",
    kind: "depth",
    cls: "depth",
    label: "Board energy — n slots ≥ 0.98 depth",
    instId: null, metric: null, side: null,
    taus: DEPTH_TAU.map((t) => ({ tau: t, thr: t })),
    vals: depth,
    scale: 1,
  });
  return cols;
}

// ─── window tallies (cached by d0 index — identical for every cell) ───────────────
// Layout per column: [readable, cnt(τ0,b0..b2), cnt(τ1,b0..b2), cnt(τ2,b0..b2)] = 10 bytes.
const TALLY_STRIDE = 10;

function tallyWindow(d0Idx: number, cols: Column[], cache: Map<number, Uint8Array>): Uint8Array {
  const hit = cache.get(d0Idx);
  if (hit) return hit;
  const t = new Uint8Array(cols.length * TALLY_STRIDE);
  for (let leadDays = 0; leadDays <= 30; leadDays++) {
    const d = d0Idx - leadDays;
    if (d < 0 || d >= TOTAL_DAYS) continue;
    const bucket = leadDays === 0 ? 2 : leadDays <= 7 ? 1 : 0;
    for (let c = 0; c < cols.length; c++) {
      const v = cols[c].vals[d];
      if (v < 0) continue;
      const base = c * TALLY_STRIDE;
      t[base]++;
      const taus = cols[c].taus;
      if (v >= taus[0].thr) {
        t[base + 1 + bucket]++;
        if (v >= taus[1].thr) {
          t[base + 4 + bucket]++;
          if (v >= taus[2].thr) t[base + 7 + bucket]++;
        }
      }
    }
  }
  cache.set(d0Idx, t);
  return t;
}

// ─── control sampling (seeded, per anchor per cell scope) ─────────────────────────
function buildBlocked(anchors: EffectiveAnchor[], family: string, state: string | null): Uint8Array {
  const blocked = new Uint8Array(TOTAL_DAYS);
  for (const a of anchors) {
    if (a.family !== family) continue;
    if (state && !a.states.includes(state)) continue;
    const s = Math.max(0, idxOfIso(a.span.start) - EXCLUDE_DAYS);
    const e = Math.min(TOTAL_DAYS - 1, idxOfIso(a.span.end) + EXCLUDE_DAYS);
    if (e >= 0 && s < TOTAL_DAYS) blocked.fill(1, s, e + 1);
  }
  return blocked;
}

/**
 * EPOCH-MATCHED (year-proximate) control sampling — coordinator ruling 2026-07-12,
 * the trend-confound fix. Controls are the NEAREST eligible years to the anchor's
 * year (|controlYear − anchorYear| minimized, seeded tie-break), not a uniform
 * draw over 1990–2025. Matched case-control on epoch: kills both halves of the
 * confound that set the daily calibration bar at p ≤ 1.23e-23 — secular
 * instrument trend (tide-residual percentiles climb with sea-level rise across
 * the 1950–2026 pools) AND anchor density growth (NCEI reporting skews events
 * late; uniform controls sat systematically earlier in time than events). The
 * fix applies identically in real and null sweeps, so the calibration stays
 * apples-to-apples. All exclusion rules unchanged.
 */
function controlD0s(anchor: EffectiveAnchor, blocked: Uint8Array, seed: number, scopeKey: string): number[] {
  const [, m, d] = anchor.d0.split("-").map(Number);
  const anchorYear = Number(anchor.d0.slice(0, 4));
  const candidates: { idx: number; gap: number }[] = [];
  for (let y = CONTROL_YEARS[0]; y <= CONTROL_YEARS[1]; y++) {
    if (y === anchorYear) continue;
    const dd = m === 2 && d === 29 && !isLeap(y) ? 28 : d;
    const idx = idxOfIso(`${y}-${pad2(m)}-${pad2(dd)}`);
    if (idx < 0 || idx >= TOTAL_DAYS) continue;
    if (blocked[idx]) continue;
    candidates.push({ idx, gap: Math.abs(y - anchorYear) });
  }
  if (candidates.length <= MAX_CONTROLS) return candidates.map((c) => c.idx);
  const rng = seededRng(fnv(`${seed}|${scopeKey}|${anchor.d0}|${anchor.memberIds[0]}`));
  // rng consumed in fixed (year-ascending) construction order → deterministic.
  const keyed = candidates.map((c) => ({ ...c, r: rng() }));
  keyed.sort((a, b) => a.gap - b.gap || a.r - b.r);
  return keyed
    .slice(0, MAX_CONTROLS)
    .map((c) => c.idx)
    .sort((a, b) => a - b);
}

// ─── year permutation: --shuffle (G2) AND the internal null calibration ──────────
function shuffleAnchorYears(effective: EffectiveAnchor[], seed: number, salt: string): EffectiveAnchor[] {
  const years = effective.map((e) => Number(e.d0.slice(0, 4)));
  const rng = seededRng(fnv(`${seed}|shuffle-anchor-years|${salt}`));
  for (let i = years.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [years[i], years[j]] = [years[j], years[i]];
  }
  return effective.map((e, i) => {
    const y = years[i];
    const [, m, d] = e.d0.split("-").map(Number);
    const dd = m === 2 && d === 29 && !isLeap(y) ? 28 : d;
    const d0 = `${y}-${pad2(m)}-${pad2(dd)}`;
    const spanLen = Math.max(
      0,
      Math.round((Date.parse(`${e.span.end}T00:00:00Z`) - Date.parse(`${e.span.start}T00:00:00Z`)) / DAY_MS)
    );
    const end = new Date(Date.parse(`${d0}T00:00:00Z`) + spanLen * DAY_MS).toISOString().slice(0, 10);
    return { ...e, d0, span: { start: d0, end } };
  });
}

// ─── the sweep ─────────────────────────────────────────────────────────────────────
interface TestRec {
  cell: MineCell;
  colIdx: number;
  tauIdx: number;
  k: number;
  lead: (typeof LEADS)[number];
  a: number;
  nEff: number;
  b: number;
  m: number;
  distinctYears: number;
  p: number;
}

interface CellData {
  cell: MineCell;
  members: EffectiveAnchor[]; // tier-filtered event anchors
  eventTallies: { anchor: EffectiveAnchor; tally: Uint8Array; year: number }[];
  controlTallies: Uint8Array[];
  scopedAnchors: EffectiveAnchor[]; // FA/near-miss outcome set: same family, SAME-TIER-OR-WORSE, states-intersecting region for state cells
  controlGapSum: number; // Σ |controlYear − anchorYear| over sampled controls (epoch-matching audit)
  controlGapN: number;
}

function prepareCells(
  cells: MineCell[],
  effective: EffectiveAnchor[],
  cols: Column[],
  seed: number,
  cache: Map<number, Uint8Array>
): CellData[] {
  const out: CellData[] = [];
  for (const cell of cells) {
    const state = cell.region === "US" ? null : cell.region;
    const tierOk = TIER_RULE[cell.tier];
    const members = effective.filter(
      (e) => e.family === cell.family && tierOk(e) && (state === null || e.primaryState === state)
    );
    // FA/near-miss grading set: only same-tier-or-worse outcomes count as "followed".
    const scopedAnchors = effective
      .filter((e) => e.family === cell.family && tierOk(e) && (state === null || e.states.includes(state)))
      .sort((a, b) => (a.d0 < b.d0 ? -1 : 1));
    // Control exclusion is tier-BLIND by ruling: any same-family anchor dirties a window.
    const blocked = buildBlocked(effective, cell.family, state);
    // scopeKey is tier-independent: a given anchor draws the same control windows in
    // every tier of its cell (controls belong to the anchor, not the tier).
    const scopeKey = `${cell.family}/${cell.region}`;
    const eventTallies = members.map((a) => ({
      anchor: a,
      tally: tallyWindow(idxOfIso(a.d0), cols, cache),
      year: Number(a.d0.slice(0, 4)),
    }));
    const controlTallies: Uint8Array[] = [];
    let controlGapSum = 0;
    let controlGapN = 0;
    for (const a of members) {
      const aYear = Number(a.d0.slice(0, 4));
      for (const cIdx of controlD0s(a, blocked, seed, scopeKey)) {
        controlTallies.push(tallyWindow(cIdx, cols, cache));
        controlGapSum += Math.abs(YEAR_BY_IDX[cIdx] - aYear);
        controlGapN++;
      }
    }
    out.push({ cell, members, eventTallies, controlTallies, scopedAnchors, controlGapSum, controlGapN });
  }
  return out;
}

function runSweep(cellData: CellData[], cols: Column[]): { tests: TestRec[]; untested: number } {
  const tests: TestRec[] = [];
  let untested = 0;
  for (const cd of cellData) {
    for (let c = 0; c < cols.length; c++) {
      const base = c * TALLY_STRIDE;
      const evOk = cd.eventTallies.filter((e) => e.tally[base] >= NULL_GUARD_MIN_READABLE);
      const years = new Set(evOk.map((e) => e.year));
      if (evOk.length < FLOOR_N_EFF || years.size < FLOOR_YEARS) {
        untested++;
        continue;
      }
      const ctOk = cd.controlTallies.filter((t) => t[base] >= NULL_GUARD_MIN_READABLE);
      if (ctOk.length === 0) {
        untested++;
        continue;
      }
      const nEff = evOk.length;
      const m = ctOk.length;
      for (let tauIdx = 0; tauIdx < 3; tauIdx++) {
        for (const lead of LEADS) {
          for (const k of K_GRID) {
            if (k > lead.len) continue; // impossible persistence — not a test
            const slot = base + 1 + tauIdx * 3 + lead.bucket;
            let a = 0;
            for (const e of evOk) if (e.tally[slot] >= k) a++;
            let b = 0;
            for (const t of ctOk) if (t[slot] >= k) b++;
            const p = fisherExactOneSided(a, nEff - a, b, m - b);
            tests.push({ cell: cd.cell, colIdx: c, tauIdx, k, lead, a, nEff, b, m, distinctYears: years.size, p });
          }
        }
      }
    }
  }
  return { tests, untested };
}

/**
 * PERMUTATION-CALIBRATED EMPIRICAL FDR — the fix G2 forced.
 *
 * Window-level Fisher assumes independent windows. It is a lie for the slow
 * columns: an ENSO/PDO/NAO episode spans months, so every event window in the
 * same year is perfectly correlated and the effective sample is ~36 years, not
 * ~250 windows. The variance of the null is inflated far beyond Fisher's
 * hypergeometric, the p-values are anti-conservative, and BH — which trusts
 * the p-values — admits noise wholesale. Proved live by G2: 1,310 post-BH
 * survivors on year-PERMUTED anchors (vs 1,979 real — a ~66% empirical FDR).
 *
 * The repair keeps every spec'd ingredient (Fisher as the per-candidate score,
 * ONE family across the whole sweep, same grid/controls/null-guards) and
 * replaces only the calibration: K internal year-permutation null sweeps
 * (seeded, deterministic) give the true null distribution of the sweep's own
 * p-values WITH the year-clustering baked in. A candidate survives iff, at its
 * p-level, the permuted-null sweeps say the expected false fraction ≤ q:
 *
 *   fdr(p, rank) = [ (#null p's ≤ p + 1) / (nNull + 1) · nReal ] / rank,
 *   qEmp = step-up monotonized; survive iff qEmp ≤ 0.05.
 *
 * Under a genuinely null input (the --shuffle run) the real vector matches the
 * null pool, fdr ≈ 1 everywhere, and ~nothing survives — G2 becomes true by
 * honesty, not by construction. BH is still computed and reported as the
 * diagnostic that it is.
 */
function empiricalQValues(pvals: number[], nullPool: Float64Array): number[] {
  const nReal = pvals.length;
  const nNull = nullPool.length;
  const countLE = (p: number) => {
    let lo = 0,
      hi = nNull; // first index with value > p
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (nullPool[mid] <= p) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const order = pvals.map((_, i) => i).sort((x, y) => pvals[x] - pvals[y] || x - y);
  const q = new Array<number>(nReal);
  let prev = Infinity;
  for (let r = nReal - 1; r >= 0; r--) {
    const i = order[r];
    const fdr = (((countLE(pvals[i]) + 1) / (nNull + 1)) * nReal) / (r + 1);
    prev = Math.min(prev, fdr);
    q[i] = prev;
  }
  return q;
}

// BH-adjusted q-values (step-up, monotone) — computed per spec and reported as a
// diagnostic; rejection thresholding via stats.benjaminiHochberg likewise. The
// SHIPPING survivor set uses empiricalQValues above (see its header for why).
function bhQValues(pvals: number[]): number[] {
  const n = pvals.length;
  const order = pvals.map((_, i) => i).sort((x, y) => pvals[x] - pvals[y] || x - y);
  const q = new Array<number>(n);
  let prev = 1;
  for (let r = n - 1; r >= 0; r--) {
    const i = order[r];
    prev = Math.min(prev, (pvals[i] * n) / (r + 1));
    q[i] = prev;
  }
  return q;
}

// ─── per-cell deep-dive context ────────────────────────────────────────────────────
interface CellCtx {
  matchedDoy: Uint8Array; // [367] — 1 if doy within ±15 of any member-anchor doy
  followed: Uint8Array; // per dayIdx — 1 if a scoped anchor begins in [d+2, d+30]
  anchorIdxs: number[]; // scoped anchor d0 indexes, sorted
  anchorLabels: string[]; // parallel: "family d0 — title"
  baseRateDay: number; // over matched-season 1990+ days
  scanDays: number;
  medianDoy: number;
  labeledStartIdx: number;
}

function buildCellCtx(cd: CellData): CellCtx {
  const matchedDoy = new Uint8Array(367);
  const doys = cd.members.map((a) => doyOfIso(a.d0));
  for (const doy of doys) {
    for (let o = -SEASON_HALF; o <= SEASON_HALF; o++) {
      matchedDoy[((doy - 1 + o + 366) % 366) + 1] = 1;
    }
  }
  const followed = new Uint8Array(TOTAL_DAYS);
  const anchorIdxs: number[] = [];
  const anchorLabels: string[] = [];
  for (const a of cd.scopedAnchors) {
    const i = idxOfIso(a.d0);
    anchorIdxs.push(i);
    anchorLabels.push(`${a.family} ${a.d0} — ${a.titles[0]}`);
    const s = Math.max(0, i - FOLLOW_HI);
    const e = Math.min(TOTAL_DAYS - 1, i - FOLLOW_LO);
    if (e >= s) followed.fill(1, s, e + 1);
  }
  const labeledStartIdx = idxOfIso(LABELED_START);
  let scanDays = 0;
  let followedDays = 0;
  for (let d = Math.max(0, labeledStartIdx); d < TOTAL_DAYS; d++) {
    if (!matchedDoy[DOY_BY_IDX[d]]) continue;
    scanDays++;
    if (followed[d]) followedDays++;
  }
  // wrap-aware median doy: if the spread crosses the Dec/Jan seam, unwrap first
  const sortedDoys = [...doys].sort((a, b) => a - b);
  let medianDoy: number;
  if (sortedDoys.length && sortedDoys[sortedDoys.length - 1] - sortedDoys[0] > 183) {
    const unwrapped = doys.map((d) => (d < 183 ? d + 366 : d)).sort((a, b) => a - b);
    const mid = unwrapped[Math.floor(unwrapped.length / 2)];
    medianDoy = ((mid - 1) % 366) + 1;
  } else {
    medianDoy = sortedDoys[Math.floor(sortedDoys.length / 2)] ?? 1;
  }
  return {
    matchedDoy,
    followed,
    anchorIdxs,
    anchorLabels,
    baseRateDay: scanDays > 0 ? followedDays / scanDays : 0,
    scanDays,
    medianDoy,
    labeledStartIdx,
  };
}

// ─── deep dive: FA denominator, near-miss verdict, cliff, fire roll call ──────────
interface Ep {
  startIdx: number;
  endIdx: number;
  days: number;
}

function groupEpisodes(daysList: number[]): Ep[] {
  const eps: Ep[] = [];
  for (const d of daysList) {
    const last = eps[eps.length - 1];
    if (last && d - last.endIdx <= EPISODE_GAP) {
      last.endIdx = d;
      last.days++;
    } else {
      eps.push({ startIdx: d, endIdx: d, days: 1 });
    }
  }
  return eps;
}

function firstFollowingAnchor(ep: Ep, ctx: CellCtx): string | null {
  // union of [f+FOLLOW_LO, f+FOLLOW_HI] over fire days in the episode is
  // contiguous (gaps ≤ 7 < window width 28) = [start+2, end+30].
  const lo = ep.startIdx + FOLLOW_LO;
  const hi = ep.endIdx + FOLLOW_HI;
  for (let i = 0; i < ctx.anchorIdxs.length; i++) {
    if (ctx.anchorIdxs[i] >= lo && ctx.anchorIdxs[i] <= hi) return ctx.anchorLabels[i];
    if (ctx.anchorIdxs[i] > hi) break;
  }
  return null;
}

/**
 * Fire days for a candidate over the whole frame range: day d fires iff d itself
 * qualifies (value ≥ cutoff) AND the trailing window of the candidate's own
 * lead-bucket length contains ≥ k qualifying days AND d is in the cell's matched
 * season. (The fire is "lit" on a qualifying day once persistence is met.)
 */
function fireDaysAt(col: Column, cutoff: number, k: number, W: number, ctx: CellCtx): number[] {
  const out: number[] = [];
  const vals = col.vals;
  const qbuf = new Uint8Array(TOTAL_DAYS);
  let rolling = 0;
  for (let d = 0; d < TOTAL_DAYS; d++) {
    const v = vals[d];
    const q = v >= 0 && v >= cutoff - 1e-9 ? 1 : 0;
    qbuf[d] = q;
    rolling += q;
    if (d - W >= 0) rolling -= qbuf[d - W];
    if (q && rolling >= k && ctx.matchedDoy[DOY_BY_IDX[d]]) out.push(d);
  }
  return out;
}

/**
 * Near-miss days: k=1 → value in [thr−band, thr); k>1 → trailing count == k−1.
 *
 * THE "NEVER ≥τ" CLAUSE (spec, near-miss law): a formation that COMPLETED is a
 * fire, not a near-miss. Without this, the shoulders of every fire episode (the
 * day before the k-th hit; the 0.96 day beside the 0.99 day) flood the sideband
 * with days that belong to the same physical plunge — crediting the near-miss
 * band with the fires' own outcomes and flattening every cliff to ratio ≈ 1
 * (observed live: AO winter fire 35/80 vs "near" 59/138). So any candidate
 * near-miss day within ±EPISODE_GAP of a fire day of THIS candidate is excluded:
 * the sideband holds only formations that built and died short of the trigger.
 */
function nearMissDays(
  col: Column,
  thr: number,
  k: number,
  W: number,
  ctx: CellCtx,
  fireDays: number[]
): number[] {
  const nearFire = new Uint8Array(TOTAL_DAYS);
  for (const f of fireDays) {
    const s = Math.max(0, f - EPISODE_GAP);
    const e = Math.min(TOTAL_DAYS - 1, f + EPISODE_GAP);
    nearFire.fill(1, s, e + 1);
  }
  const out: number[] = [];
  const vals = col.vals;
  const band = col.kind === "depth" ? NEAR_BAND_DEPTH : NEAR_BAND_BYTE;
  if (k === 1) {
    for (let d = 0; d < TOTAL_DAYS; d++) {
      const v = vals[d];
      if (v >= 0 && v >= thr - band && v < thr && !nearFire[d] && ctx.matchedDoy[DOY_BY_IDX[d]]) out.push(d);
    }
    return out;
  }
  const qbuf = new Uint8Array(TOTAL_DAYS);
  let rolling = 0;
  for (let d = 0; d < TOTAL_DAYS; d++) {
    const v = vals[d];
    const q = v >= 0 && v >= thr ? 1 : 0;
    qbuf[d] = q;
    rolling += q;
    if (d - W >= 0) rolling -= qbuf[d - W];
    if (rolling === k - 1 && !nearFire[d] && ctx.matchedDoy[DOY_BY_IDX[d]]) out.push(d);
  }
  return out;
}

function bandStats(daysList: number[], ctx: CellCtx): { fires: number; followed: number; dayCount: number; eps: Ep[] } {
  const labeled = daysList.filter((d) => d >= ctx.labeledStartIdx);
  const eps = groupEpisodes(labeled);
  let followedN = 0;
  for (const ep of eps) if (firstFollowingAnchor(ep, ctx) !== null) followedN++;
  return { fires: eps.length, followed: followedN, dayCount: labeled.length, eps };
}

function deepDive(t: TestRec, col: Column, ctx: CellCtx, eventWilson: WilsonCI): DeepDive {
  const thr = col.taus[t.tauIdx].thr;
  const W = t.lead.len;

  // fire days across ALL years (pre-1990 = unlabeled era, shown but ungraded)
  const allFireDays = fireDaysAt(col, thr, t.k, W, ctx);
  const fire = bandStats(allFireDays, ctx);
  const unlabeledEps = groupEpisodes(allFireDays.filter((d) => d < ctx.labeledStartIdx));

  const near = bandStats(nearMissDays(col, thr, t.k, W, ctx, allFireDays), ctx);
  const nm = nearMissVerdict(
    { fires: fire.fires, followed: fire.followed },
    { fires: near.fires, followed: near.followed },
    ctx.baseRateDay
  );

  const tauStar = col.kind === "depth" ? thr : thr / 254;
  const cliff = cliffSweep((tau) => {
    const cutoff = col.kind === "depth" ? tau : tau * 254;
    const days = fireDaysAt(col, cutoff, t.k, W, ctx).filter((d) => d >= ctx.labeledStartIdx);
    const eps = groupEpisodes(days);
    let followedN = 0;
    for (const ep of eps) if (firstFollowingAnchor(ep, ctx) !== null) followedN++;
    return { fires: eps.length, followed: followedN };
  }, tauStar);

  const fireList: FireEpisode[] = [];
  for (const ep of unlabeledEps) {
    fireList.push({ start: ISO_BY_IDX[ep.startIdx], end: ISO_BY_IDX[ep.endIdx], days: ep.days, era: "unlabeled", followedBy: null });
  }
  for (const ep of fire.eps) {
    fireList.push({
      start: ISO_BY_IDX[ep.startIdx],
      end: ISO_BY_IDX[ep.endIdx],
      days: ep.days,
      era: "labeled",
      followedBy: firstFollowingAnchor(ep, ctx),
    });
  }

  const wFollow = wilsonInterval(fire.followed, fire.fires);
  const bandDesc =
    t.k === 1
      ? col.kind === "depth"
        ? `count in [${thr - NEAR_BAND_DEPTH}, ${thr})`
        : `pct in [${((thr - NEAR_BAND_BYTE) / 254).toFixed(3)}, ${(thr / 254).toFixed(3)})`
      : `exactly k−1 = ${t.k - 1} qualifying days in the trailing ${W}d window`;
  const bandDescFull = `${bandDesc}; days within ±${EPISODE_GAP}d of a fire day excluded (completed formations are fires, not near-misses)`;

  return {
    fa: {
      scanDays: ctx.scanDays,
      baseRateDay: ctx.baseRateDay,
      fireDays: fire.dayCount,
      fireEpisodes: fire.fires,
      followedEpisodes: fire.followed,
      pEventFollowsFire: { ...wFollow, k: fire.followed, n: fire.fires },
      pFireGivenEvent: { ...eventWilson, k: t.a, n: t.nEff },
      unlabeledEpisodes: unlabeledEps.length,
    },
    nearMiss: {
      band: bandDescFull,
      fireBand: { fires: fire.fires, followed: fire.followed },
      nearBand: { fires: near.fires, followed: near.followed },
      fireDayCount: fire.dayCount,
      nearDayCount: near.dayCount,
      ratio: nm.ratio,
      p: nm.p,
      verdict: nm.verdict,
    },
    cliff,
    fireList,
  };
}

// ─── the RAW-units sentence (LUT inversion — a percentile is not a product sentence) ─
function fmtRaw(v: number): string {
  return Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2);
}

function buildSentence(
  t: TestRec,
  col: Column,
  medianDoy: number
): { sentence: string; rawValue: number | null } {
  const thr = col.taus[t.tauIdx].thr;
  const persist = t.lead.id === "D0" ? "on D0" : `on ≥${t.k} day(s) in ${t.lead.id}`;
  const cellStr = `${t.cell.family}/${t.cell.region} [${t.cell.tier}]`;
  if (col.kind === "slot") {
    const raw = invertPct(col.instId!, col.metric!, medianDoy, thr / 254, col.side as "low" | "high");
    const dir = col.side === "low" ? "≤" : "≥";
    const instLabel = col.label.replace(/ \((low|high) tail\)$/, "");
    if (raw === null) {
      return {
        sentence: `${instLabel} ${dir} p${(thr / 254).toFixed(3)} tail (LUT missing at doy ${medianDoy}) ${persist} → ${cellStr}`,
        rawValue: null,
      };
    }
    return { sentence: `${instLabel} ${dir} ${fmtRaw(raw)} ${persist} → ${cellStr}`, rawValue: raw };
  }
  if (col.kind === "moon") {
    const daysOut = ((1 - thr / 254) * SYNODIC_DAYS) / 2;
    const which = col.id === "moon:new" ? "new" : "full";
    return { sentence: `Moon within ${daysOut.toFixed(1)}d of ${which} ${persist} → ${cellStr}`, rawValue: null };
  }
  return { sentence: `Board energy: ≥${thr} of 142 slots at ≥0.98 depth ${persist} → ${cellStr}`, rawValue: null };
}

// ─── G1: AO rediscovery ─────────────────────────────────────────────────────────────
const G1_ROLLCALL: { name: string; lo: string; hi: string }[] = [
  { name: "Feb-2010 (Snowmageddon)", lo: "2010-01-20", hi: "2010-03-10" },
  { name: "Dec-2010 (Christmas blizzard)", lo: "2010-11-20", hi: "2011-01-10" },
  { name: "Jan/Feb-2021 (Uri)", lo: "2021-01-01", hi: "2021-03-01" },
  { name: "Dec-2022 (Elliott)", lo: "2022-11-20", hi: "2023-01-10" },
];
const G1_UNLABELED: { name: string; lo: string; hi: string }[] = [
  { name: "Jan-1977 (snow in Miami)", lo: "1976-12-01", hi: "1977-02-28" },
  { name: "Feb-1978 (Blizzard of '78)", lo: "1978-01-10", hi: "1978-03-10" },
];

function overlaps(ep: FireEpisode, lo: string, hi: string): boolean {
  return ep.start <= hi && ep.end >= lo;
}

/**
 * Ruling follow-up (2026-07-12): does AO-low winter cross the near-miss cliff at
 * each tier? Dived for the best candidates REGARDLESS of calibrated survival, so
 * the gate can say WHY it fails (calibration vs cliff vs roll call). Diagnostic
 * only — nothing here enters LOOKOUTS.
 */
function aoTierDiagnostics(
  tests: TestRec[],
  cols: Column[],
  ctxByCell: Map<string, CellCtx>,
  qvals: number[],
  qBHvals: number[]
): string[] {
  const out: string[] = [];
  for (const tier of TIERS) {
    const idxs: number[] = [];
    for (let i = 0; i < tests.length; i++) {
      const t = tests[i];
      if (t.cell.family !== "winter" || t.cell.region !== "US" || t.cell.tier !== tier || t.lead.id === "D0") continue;
      const col = cols[t.colIdx];
      if (col.instId === "needle-ao" && col.side === "low") idxs.push(i);
    }
    if (idxs.length === 0) {
      out.push(`[${tier}] AO diagnostic: winter/US AO-low untested at this tier (below floors or null-guarded)`);
      continue;
    }
    const describe = (i: number, dive: DeepDive, tag: string) => {
      const t = tests[i];
      const col = cols[t.colIdx];
      const ctx = ctxByCell.get(cellKeyOf(t.cell))!;
      const nm = dive.nearMiss;
      const roll = G1_ROLLCALL.map(
        (rc) =>
          `${rc.name.split(" ")[0]}:${dive.fireList.some((ep) => ep.era === "labeled" && overlaps(ep, rc.lo, rc.hi)) ? "FIRED" : "miss"}`
      ).join(" ");
      const { sentence } = buildSentence(t, col, ctx.medianDoy);
      return (
        `[${tier}] AO ${tag}: "${sentence}" a=${t.a}/${t.nEff} b=${t.b}/${t.m} p=${t.p.toExponential(2)} ` +
        `q=${qvals[i].toExponential(2)} qBH=${qBHvals[i].toExponential(2)} | ` +
        `fire ${nm.fireBand.followed}/${nm.fireBand.fires} vs near ${nm.nearBand.followed}/${nm.nearBand.fires} ` +
        `(base ${dive.fa.baseRateDay.toFixed(3)}) ratio ${nm.ratio.toFixed(2)} p_nm=${nm.p.toExponential(2)} → ${nm.verdict} | ${roll}`
      );
    };
    let bestP = idxs[0];
    let bestRatioI = idxs[0];
    let bestRatioDive: DeepDive | null = null;
    let fusionShaped = 0;
    for (const i of idxs) {
      const t = tests[i];
      if (t.p < tests[bestP].p) bestP = i;
      const col = cols[t.colIdx];
      const ctx = ctxByCell.get(cellKeyOf(t.cell))!;
      const dive = deepDive(t, col, ctx, wilsonInterval(t.a, t.nEff));
      if (dive.nearMiss.verdict === "FUSION") fusionShaped++;
      if (!bestRatioDive || dive.nearMiss.ratio > bestRatioDive.nearMiss.ratio) {
        bestRatioDive = dive;
        bestRatioI = i;
      }
    }
    out.push(
      `[${tier}] AO diagnostic: ${idxs.length} AO-low winter/US candidates tested; ${fusionShaped} cross the near-miss cliff (FUSION-shaped, survival aside)`
    );
    {
      const t = tests[bestP];
      const col = cols[t.colIdx];
      const ctx = ctxByCell.get(cellKeyOf(t.cell))!;
      out.push(describe(bestP, deepDive(t, col, ctx, wilsonInterval(t.a, t.nEff)), "best-by-p"));
    }
    if (bestRatioDive && bestRatioI !== bestP) out.push(describe(bestRatioI, bestRatioDive, "best-by-cliff"));
  }
  return out;
}

function gateG1(lookouts: Survivor[], killed: Survivor[], diagnostics: string[]): GateG1 {
  const detail: string[] = [...diagnostics];
  let pass = false;
  for (const tier of TIERS) {
    const isAo = (s: Survivor) =>
      s.family === "winter" && s.instId === "needle-ao" && s.side === "low" && s.tier === tier;
    const aoLookouts = lookouts.filter(isAo);
    const aoKilled = killed.filter(isAo);
    const best = aoLookouts[0] ?? aoKilled[0];
    if (!best) {
      detail.push(`[${tier}] no AO-low winter candidate survived the calibrated sweep at this tier`);
      continue;
    }
    const isFusion = aoLookouts.length > 0;
    const tierRank = lookouts.filter((s) => s.family === "winter" && s.tier === tier).indexOf(best) + 1;
    const nm = best.dive.nearMiss;
    detail.push(
      `[${tier}] best AO-low winter survivor: "${best.sentence}" (τ=${best.tau}, k=${best.k}, ${best.lead}) — ` +
        `${isFusion ? `FUSION, rank #${tierRank} among ${tier} winter lookouts` : "DECORATION (in KILLED)"}; ` +
        `fire ${nm.fireBand.followed}/${nm.fireBand.fires} vs near ${nm.nearBand.followed}/${nm.nearBand.fires}, ` +
        `ratio ${nm.ratio.toFixed(2)}, p=${nm.p.toExponential(2)}, base ${best.dive.fa.baseRateDay.toFixed(3)}`
    );
    let allHit = true;
    for (const rc of G1_ROLLCALL) {
      const hit = best.dive.fireList.some((ep) => ep.era === "labeled" && overlaps(ep, rc.lo, rc.hi));
      detail.push(`[${tier}] roll call ${rc.name}: ${hit ? "FIRED" : "MISSING"}`);
      if (!hit) allHit = false;
    }
    for (const rc of G1_UNLABELED) {
      const hit = best.dive.fireList.some((ep) => ep.era === "unlabeled" && overlaps(ep, rc.lo, rc.hi));
      detail.push(`[${tier}] unlabeled era ${rc.name}: ${hit ? "FIRED (shown, ungradable — no anchors pre-1990)" : "no fire"}`);
    }
    if ((tier === "SEVERE" || tier === "MAJOR") && isFusion && allHit) pass = true;
  }
  detail.push(
    `G1 verdict: ${pass ? "PASS" : "FAIL"} (requires an AO-low winter FUSION lookout with all 4 labeled roll-call fires at SEVERE or MAJOR tier)`
  );
  return { ran: true, pass, detail };
}

// ─── main ────────────────────────────────────────────────────────────────────────────
async function main() {
  const { seed, family, shuffle, jsonOnly } = parseArgs();
  const tWall = Date.now();
  const phase = (label: string, t0: number) =>
    console.log(`[mine] ${label} — ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // 1. load (parallel; both loaders are GET-only)
  let t0 = Date.now();
  const [anchorSet, store] = await Promise.all([loadAnchors(), loadFrameStore()]);
  phase(`loaded ${anchorSet.raw.length} raw anchors → ${anchorSet.effective.length} effective; ` +
    `${store.days.length} frames, layout v${store.version}, ${store.luts.size} LUT rows`, t0);

  initCalendar(store.days);

  // 2. shuffle (G2) — permute anchor years, rebuild cells from the permuted set
  let effective = anchorSet.effective;
  if (shuffle) {
    effective = shuffleAnchorYears(effective, seed, "outer");
    console.log(`[mine] G2 SHUFFLE MODE — anchor years permuted (seeded); expecting ≈0 calibrated survivors`);
  }
  const allTierCells = buildTieredCells(effective);
  let cells = allTierCells.filter((c) => c.eligible);
  if (family) {
    cells = cells.filter((c) => c.family === family);
    if (cells.length === 0) throw new Error(`--family ${family}: no eligible cells`);
  }
  const families = [...new Set(cells.map((c) => c.family))].sort();
  console.log(
    `[mine] tiered cells: ` +
      TIERS.map((t) => `${t} ${cells.filter((c) => c.tier === t).length}`).join(" · ") +
      ` eligible (of ${allTierCells.length} computed)`
  );

  // 3. columns
  t0 = Date.now();
  const cols = buildColumns(store);
  phase(`built ${cols.length} columns (142 slots + 2 moon + 1 depth)`, t0);

  // 4. tallies + controls
  t0 = Date.now();
  const cache = new Map<number, Uint8Array>();
  const cellData = prepareCells(cells, effective, cols, seed, cache);
  const totalControls = cellData.reduce((n, cd) => n + cd.controlTallies.length, 0);
  phase(`tallied ${cells.length} cells: ${cellData.reduce((n, cd) => n + cd.eventTallies.length, 0)} event windows, ` +
    `${totalControls} control windows (${cache.size} distinct positions)`, t0);
  // epoch-matching audit: achieved mean |controlYear − anchorYear| per tier
  const controlYearGaps = TIERS.map((tr) => {
    const cds = cellData.filter((cd) => cd.cell.tier === tr);
    const sum = cds.reduce((n, cd) => n + cd.controlGapSum, 0);
    const n = cds.reduce((k, cd) => k + cd.controlGapN, 0);
    return { tier: tr as string, controls: n, meanGap: n > 0 ? sum / n : 0 };
  });
  console.log(
    `[mine] epoch matching: mean |control year − anchor year| = ` +
      controlYearGaps.map((g) => `${g.tier} ${g.meanGap.toFixed(2)}y (${g.controls} controls)`).join(" · ")
  );

  // 5. sweep + Fisher
  t0 = Date.now();
  const { tests, untested } = runSweep(cellData, cols);
  phase(`swept ${tests.length} candidates (${untested} cell×column pairs untested by null-guard/floors)`, t0);

  // 6. ONE BH family across the entire sweep (diagnostic — see empiricalQValues)
  t0 = Date.now();
  const pvals = tests.map((t) => t.p);
  const { threshold, rejected } = benjaminiHochberg(pvals, BH_Q);
  const qBHvals = bhQValues(pvals);
  const bhSurvivors = rejected.filter(Boolean).length;
  phase(`BH one family (diagnostic): threshold p ≤ ${threshold.toExponential(3)}, ${bhSurvivors} BH survivors of ${tests.length}`, t0);

  // 6b. CLASS-STRATIFIED permutation-calibrated FDR — K internal year-permuted
  //     null sweeps; each candidate judged against its own class's null pool.
  t0 = Date.now();
  const nullPoolsArr: Record<ColClass, number[]> = { daily: [], monthly: [], moon: [], depth: [] };
  for (let j = 1; j <= K_NULL; j++) {
    const nullEff = shuffleAnchorYears(effective, seed, `null-${j}`);
    let nullCells = buildTieredCells(nullEff).filter((c) => c.eligible);
    if (family) nullCells = nullCells.filter((c) => c.family === family);
    const nullData = prepareCells(nullCells, nullEff, cols, seed, cache);
    const { tests: nullTests } = runSweep(nullData, cols);
    for (const nt of nullTests) nullPoolsArr[cols[nt.colIdx].cls].push(nt.p);
  }
  const qvals = new Array<number>(tests.length).fill(1);
  const survivorIdx: number[] = [];
  const classStats: { cls: string; tests: number; nullTests: number; nullMinP: number; barP: number | null; survivors: number }[] = [];
  for (const cls of COL_CLASSES) {
    const idxs: number[] = [];
    for (let i = 0; i < tests.length; i++) if (cols[tests[i].colIdx].cls === cls) idxs.push(i);
    const pool = Float64Array.from(nullPoolsArr[cls]);
    pool.sort();
    const clsQ = empiricalQValues(idxs.map((i) => pvals[i]), pool);
    let barP: number | null = null;
    let surv = 0;
    idxs.forEach((i, k) => {
      qvals[i] = clsQ[k];
      if (clsQ[k] <= BH_Q) {
        surv++;
        survivorIdx.push(i);
        if (barP === null || pvals[i] > barP) barP = pvals[i];
      }
    });
    classStats.push({
      cls,
      tests: idxs.length,
      nullTests: pool.length,
      nullMinP: pool.length ? pool[0] : 1,
      barP,
      survivors: surv,
    });
  }
  survivorIdx.sort((a, b) => a - b);
  const nullTestsTotal = classStats.reduce((n, c) => n + c.nullTests, 0);
  phase(
    `stratified calibration: ${K_NULL} null sweeps, ${nullTestsTotal} null tests → ${survivorIdx.length} calibrated survivors ` +
      `(vs ${bhSurvivors} under BH — the gap is year-clustering noise)`,
    t0
  );
  for (const c of classStats) {
    console.log(
      `[mine]   class ${c.cls.padEnd(7)}: ${c.survivors} survivors of ${c.tests} tests | ` +
        `bar p ≤ ${c.barP === null ? "— (none clear)" : c.barP.toExponential(2)} | ` +
        `null pool ${c.nullTests} (min ${c.nullMinP.toExponential(2)})`
    );
  }

  // 7. cell contexts (eager — they also feed the per-tier base-rate table), then
  //    deep dives (non-D0 survivors) + sentences
  t0 = Date.now();
  const ctxByCell = new Map<string, CellCtx>();
  for (const cd of cellData) ctxByCell.set(cellKeyOf(cd.cell), buildCellCtx(cd));
  const cellBaseRates = cellData
    .map((cd) => {
      const ctx = ctxByCell.get(cellKeyOf(cd.cell))!;
      return {
        cell: `${cd.cell.family}/${cd.cell.region}`,
        tier: cd.cell.tier as string,
        nEff: cd.cell.nEff,
        baseRateDay: ctx.baseRateDay,
        scanDays: ctx.scanDays,
      };
    })
    .sort((a, b) =>
      a.cell < b.cell ? -1 : a.cell > b.cell ? 1 : TIERS.indexOf(a.tier as Tier) - TIERS.indexOf(b.tier as Tier)
    );

  const lookouts: Survivor[] = [];
  const killed: Survivor[] = [];
  const detectors: CandidateRow[] = [];

  for (const i of survivorIdx) {
    const t = tests[i];
    const col = cols[t.colIdx];
    const ctx = ctxByCell.get(cellKeyOf(t.cell))!;
    const { sentence, rawValue } = buildSentence(t, col, ctx.medianDoy);
    const eventWilson = wilsonInterval(t.a, t.nEff);
    const controlWilson = wilsonInterval(t.b, t.m);
    const q = qvals[i]; // shuffle-calibrated empirical FDR (the shipping q)
    const qBH = qBHvals[i]; // BH diagnostic — anti-conservative here, kept visible
    const row: CandidateRow = {
      family: t.cell.family,
      region: t.cell.region,
      tier: t.cell.tier,
      cell: `${t.cell.family}/${t.cell.region}`,
      column: col.id,
      columnLabel: col.label,
      kind: col.kind,
      colClass: col.cls,
      instId: col.instId,
      metric: col.metric,
      side: col.side,
      tau: col.taus[t.tauIdx].tau,
      thr: col.taus[t.tauIdx].thr,
      k: t.k,
      lead: t.lead.id,
      a: t.a,
      nEff: t.nEff,
      b: t.b,
      m: t.m,
      distinctYears: t.distinctYears,
      eventRate: t.a / t.nEff,
      controlRate: t.b / t.m,
      eventWilson,
      controlWilson,
      lift: lift(t.a, t.nEff, t.b, t.m),
      p: t.p,
      q,
      qBH,
      sentence,
      rawValue,
      medianDoy: ctx.medianDoy,
      // ranking key: lift × log10(1/q) per spec — on the BH q, which is fine-grained
      // and monotone in Fisher p (the empirical q is granular at the top: many
      // candidates beat the entire null pool and tie).
      score: lift(t.a, t.nEff, t.b, t.m) * Math.log10(1 / Math.max(qBH, 1e-300)),
    };
    if (t.lead.id === "D0") {
      detectors.push(row); // DETECTOR: the outcome lives in the slots on D0 — never a lookout
      continue;
    }
    const dive = deepDive(t, col, ctx, eventWilson);
    const s: Survivor = { ...row, dive };
    if (dive.nearMiss.verdict === "FUSION") lookouts.push(s);
    else killed.push(s);
  }

  const byScore = (x: CandidateRow, y: CandidateRow) =>
    y.score - x.score ||
    (x.tier + x.cell + x.column + x.tau + x.k + x.lead < y.tier + y.cell + y.column + y.tau + y.k + y.lead ? -1 : 1);
  lookouts.sort(byScore);
  killed.sort(byScore);
  detectors.sort(byScore);
  phase(`deep dives: ${lookouts.length} FUSION lookouts, ${killed.length} killed (decoration), ${detectors.length} D0 detectors`, t0);

  // 8. gates
  const g1: GateG1 =
    !shuffle && families.includes("winter")
      ? gateG1(lookouts, killed, aoTierDiagnostics(tests, cols, ctxByCell, qvals, qBHvals))
      : { ran: false, pass: false, detail: [] };

  // 9. payload + outputs (NO timestamps anywhere — G3)
  const payload: MinePayload = {
    params: {
      seed,
      shuffle,
      families,
      tiers: TIERS.map((t) => `${t}: ${TIER_DESC[t]}`),
      layoutVersion: store.version,
      frameDays: store.days.length,
      rawAnchors: anchorSet.raw.length,
      effectiveAnchors: effective.length,
      eligibleCells: cells.length,
      columns: cols.length,
      tauPcts: TAU_PCT,
      tauBytes: TAU_BYTE,
      depthTaus: DEPTH_TAU,
      kGrid: K_GRID,
      leads: LEADS.map((l) => l.id),
      controlYears: CONTROL_YEARS,
      controlsPerAnchor: MAX_CONTROLS,
      nullGuardMinReadable: NULL_GUARD_MIN_READABLE,
      floorNEff: FLOOR_N_EFF,
      floorYears: FLOOR_YEARS,
      bhQ: BH_Q,
      episodeGapDays: EPISODE_GAP,
      followWindow: [FOLLOW_LO, FOLLOW_HI],
      seasonHalfWidthDays: SEASON_HALF,
      controlExclusionDays: EXCLUDE_DAYS,
    },
    coverage: [
      `Anchors exist 1990+ ONLY (the labeled era). 1950–89 frames serve pool depth and unlabeled fire lists — controls are never drawn there.`,
      `Tide gauges cover NE / Gulf / Chesapeake only — no West Coast, no Great Lakes surge lens.`,
      `State temperature slots are avg_high only — cold outbreaks register through the LOW tail of avg_high, not a true min-temp lane.`,
      `Climate-index caveat: AO/NAO/PNA are daily (1950+); any ENSO/PDO/monthly-resolution index slots smear fire dates to month precision — treat their cells accordingly.`,
      `Fire family is absent from the anchor set (no fire-event stitching yet).`,
      `Tropical anchors are national-only (no tropical state cell clears the floors).`,
      `D0 candidates are computed and reported as DETECTORS — the outcome lives in the slots on D0; they are never lookouts.`,
      `Severity tiers: ALL (baseline) / SEVERE (deaths ≥1 or ≥$50M) / MAJOR (deaths ≥10 or ≥$250M), summed on the merged effective anchor. ` +
        `Tiered cells grade FA/near-miss follows against SAME-TIER-OR-WORSE outcomes only; control exclusion avoids anchors of ANY tier.`,
      `v1.1 knob (skipped in v1 per ruling): state-scoped outcome columns in FA/near-miss grading for family×national tiered cells.`,
    ],
    controlYearGaps,
    tierCells: allTierCells.map((c) => ({
      family: c.family,
      region: c.region,
      tier: c.tier as string,
      nEff: c.nEff,
      distinctYears: c.distinctYears,
      eligible: c.eligible,
    })),
    cellBaseRates,
    totalTests: tests.length,
    untestedPairs: untested,
    bhThresholdP: threshold,
    bhSurvivors,
    calibration: { nullSweeps: K_NULL, classes: classStats },
    survivorsTotal: survivorIdx.length,
    lookouts,
    killed,
    detectors,
    gates: { g1 },
  };

  const outDir = join(dirname(fileURLToPath(import.meta.url)), "out");
  mkdirSync(outDir, { recursive: true });
  const jsonPath = join(outDir, shuffle ? "lookout-candidates-shuffle.json" : "lookout-candidates.json");
  writeFileSync(jsonPath, JSON.stringify(payload, null, 1));
  console.log(`[mine] wrote ${jsonPath}`);
  if (!jsonOnly && !shuffle) {
    const mdPath = join(outDir, "LOOKOUT-REPORT.md");
    writeFileSync(mdPath, renderReport(payload));
    console.log(`[mine] wrote ${mdPath}`);
  }

  // 10. console verdicts
  console.log(`\n=== LOOKOUT MINE — ${shuffle ? "SHUFFLE (G2)" : "RUN"} SUMMARY (seed ${seed}) ===`);
  console.log(
    `tests ${tests.length} | calibrated survivors ${survivorIdx.length} ` +
      `(BH-as-specified would pass ${bhSurvivors} at p ≤ ${threshold.toExponential(3)} — anti-conservative under year clustering) | ` +
      `null pool ${nullTestsTotal} p's from ${K_NULL} year-permuted sweeps, class-stratified`
  );
  console.log(
    `per class: ` +
      classStats.map((c) => `${c.cls} ${c.survivors} surv (bar ${c.barP === null ? "—" : c.barP.toExponential(2)})`).join(" · ")
  );
  console.log(`LOOKOUTS (FUSION) ${lookouts.length} | DETECTORS (D0) ${detectors.length} | KILLED ${killed.length} | untested pairs ${untested}`);
  console.log(
    `per tier: ` +
      TIERS.map((tr) => {
        const f = lookouts.filter((s) => s.tier === tr).length;
        const k = killed.filter((s) => s.tier === tr).length;
        const d = detectors.filter((s) => s.tier === tr).length;
        return `${tr} ${f}F/${k}K/${d}D`;
      }).join(" · ")
  );
  if (shuffle) {
    console.log(
      `G2 SHUFFLE: calibrated survivor count = ${survivorIdx.length} (the mine's own honesty line — expect ≈0; ` +
        `raw post-BH on the same shuffled anchors = ${bhSurvivors}, which is WHY BH could not be the shipping filter)`
    );
  }
  if (g1.ran) {
    console.log(`\nG1 AO REDISCOVERY: ${g1.pass ? "PASS" : "FAIL"}`);
    for (const d of g1.detail) console.log(`  ${d}`);
  }
  if (lookouts.length > 0) {
    console.log(`\ntop lookouts:`);
    lookouts.slice(0, 10).forEach((s, i) =>
      console.log(
        `  ${i + 1}. ${s.sentence} | lift ${s.lift.toFixed(1)} q=${s.q.toExponential(2)} | ` +
          `P(event|fire) ${s.dive.fa.followedEpisodes}/${s.dive.fa.fireEpisodes} | near-miss ratio ${s.dive.nearMiss.ratio.toFixed(1)}`
      )
    );
  }
  console.log(`\n[mine] total wall time ${((Date.now() - tWall) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
