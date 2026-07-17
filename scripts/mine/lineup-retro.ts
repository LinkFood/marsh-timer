/**
 * lineup-retro.ts — THE LINEUP RETRODICTION TEST: loader / orchestrator /
 * report (timebox gate 1, due 2026-07-20).
 *
 * Implements scripts/mine/REGISTRATION-LINEUP-RETRO.md (frozen 2026-07-16,
 * commit c135065). The registration is THE LAW; where this file and the
 * registration disagree, the registration wins and this file is wrong.
 *
 * Run-of-record order inside one invocation (§8/§10): load gates (500-row
 * metadata≡content parity, per-state-year row counts, coverage receipts) →
 * parity gate (10 seeded live probes vs the DEPLOYED hunt-atlas-spot — EXACT
 * match on n_matches / last_date / mode / n_days_searched / control.all_n /
 * all_outcome_n; failure STOPS the run) → G0 → G2 → G3 → primary vs the 64
 * rotations → secondaries S1–S8 (one 57-test BH family) → verdict.
 * Outputs: scripts/mine/out/lineup-retro.json + LINEUP-RETRO-REPORT.md.
 *
 * DEVELOPMENT FIREWALL (§8): the core (runLineupRetro) is pure and takes an
 * injectable LineupStore so synthetic fixtures drive it
 * (lineup-engine.test.ts). The first production invocation is the run of
 * record, fired by the main session. The ONLY network the firewall permits
 * during development is the parity gate's 10 seeded GETs (--probe-dry).
 *
 * Determinism (G3): no timestamps in the payload; Math.random banned; seed 42
 * is used ONLY for fixture generation, the 500-row load-gate sample, and
 * parity-probe selection. The full payload is computed twice in-process and
 * byte-compared. The parity probes' target date is the run day (the
 * registration probes CURRENT dates): two runs the same day are
 * byte-identical.
 *
 * Usage: npx tsx scripts/mine/lineup-retro.ts [--seed 42] [--json-only] [--probe-dry]
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { fisherExactOneSided, wilsonInterval, benjaminiHochberg, seededRng } from "./stats";
import {
  BH_Q, ERA_END, ERA_START, EPOCH_SPLIT_YEAR, G0_FLOOR, G0_MCNEMAR_BAR, G2_OFFSET,
  GUARD_DAYS, GUARD_SENSITIVITY, IMPORTANCE_FLOOR, N_ROTATIONS, ROTATION_OFFSETS,
  SEED_DEFAULT, STATE_ABBRS,
  Env, EvalOpts, LineupStore, RepStats, SpotLiveResult, TideStationData,
  buildEnv, composeRemap, evalReplicate, fnv, makeRemap, mcnemarOneSided,
  moonAgeOnDate, spotLiveLineup,
} from "./lineup-engine";

const SUPABASE_URL = "https://rvhyotvklfowklzjahdd.supabase.co";
const PAGE_SIZE = 1000;
const AVG_HIGH_RE = /average high of ([\d.]+)\s*°?F/i; // the product's own content regex (§2)
const PARITY_SAMPLE = 500;
const PARITY_TOL_F = 0.05;
const N_PROBES = 10;

// ─── battery: one predicate pass + the 64 registered rotations (§7) ─────────────

interface RotRow {
  offset: number;
  delta: number | null;
  paired: number;
  perState: (number | null)[];
  perMode: (number | null)[];
  perVerb: (number | null)[];
  perEpoch: (number | null)[];
  s1: number | null;
  s6Diff: number | null;
}

const accDelta = (a: { n: number; sum: number }): number | null => (a.n > 0 ? a.sum / a.n : null);
const s6DiffOf = (s6: RepStats["s6"]): number | null =>
  s6.lN > 0 && s6.nN > 0 ? s6.lCooled / s6.lN - s6.nCooled / s6.nN : null;

function rotRowOf(offset: number, r: RepStats): RotRow {
  return {
    offset,
    delta: r.delta,
    paired: r.paired,
    perState: r.perState.map(accDelta),
    perMode: r.perMode.map(accDelta),
    perVerb: r.perVerb.map(accDelta),
    perEpoch: r.perEpoch.map(accDelta),
    s1: accDelta(r.s1),
    s6Diff: s6DiffOf(r.s6),
  };
}

function battery(env: Env, outer: Int32Array | null, log: (s: string) => void, tag: string):
  { obs: RepStats; rots: RotRow[] } {
  const opts: EvalOpts = { predicate: "lineup", guardDays: GUARD_DAYS, detail: true };
  const obs = evalReplicate(env, outer, opts);
  log(`[lineup] ${tag}: observed done (paired ${obs.paired})`);
  const rots: RotRow[] = [];
  for (let i = 0; i < ROTATION_OFFSETS.length; i++) {
    const k = ROTATION_OFFSETS[i];
    const rm = makeRemap(env.cal, k);
    const combined = outer ? composeRemap(outer, rm) : rm;
    rots.push(rotRowOf(k, evalReplicate(env, combined, { predicate: "lineup", guardDays: GUARD_DAYS })));
    if ((i + 1) % 16 === 0) log(`[lineup] ${tag}: rotation ${i + 1}/${ROTATION_OFFSETS.length}`);
  }
  return { obs, rots };
}

/** CERTIFIED bar (§7): Δ_obs strictly exceeds ALL 64 rotations AND ≥ +2.0pp.
 *  A rotation whose Δ is undefined (no pairs) cannot outrank the observed. */
function certification(delta: number | null, rots: RotRow[]): {
  beatsAll: boolean; floorMet: boolean; certified: boolean; maxRotation: number | null;
} {
  const maxRotation = rots.reduce<number | null>(
    (m, r) => (r.delta === null ? m : m === null || r.delta > m ? r.delta : m), null);
  const beatsAll = delta !== null && rots.every((r) => r.delta === null || delta > r.delta);
  const floorMet = delta !== null && delta >= IMPORTANCE_FLOOR;
  return { beatsAll, floorMet, certified: beatsAll && floorMet, maxRotation };
}

/** Empirical rotation p for a subgroup (§9/S4 formula): (1 + #{k: Δ_k ≥ Δ}) / 65.
 *  Null rotation values cannot outrank; a null observed Δ gets p = 1. */
function empiricalP(obs: number | null, rotVals: (number | null)[]): number {
  if (obs === null) return 1;
  let ge = 0;
  for (const v of rotVals) if (v !== null && v >= obs) ge++;
  return (1 + ge) / (N_ROTATIONS + 1);
}

// ─── receipts / parity shapes (injected — the pure core never touches I/O) ──────

export interface LoadReceipts {
  ghcn: {
    rows: number;
    unknownStateRows: number;
    stateYears: { deficient: { state: string; year: number; rows: number }[]; min: number; max: number };
    parity500: { checked: number; maxAbsDiff: number; pass: boolean };
  };
  tide: {
    rows: number;
    stations: number;
    stateDecadeDays: { state: string; decade: string; days: number }[];
  };
}

export interface ParityProbe {
  state: string;
  date: string;
  pass: boolean;
  fields: Record<string, { engine: unknown; spot: unknown; match: boolean }>;
  moonAgeAbsDiff: number | null; // receipt only (spot rounds to 2dp) — not an EXACT field
  note: string | null;
}

export interface ParityBlock {
  date: string;
  probes: ParityProbe[];
  pass: boolean;
}

export interface RunOpts {
  seed: number;
  parity: ParityBlock | null; // null on synthetic fixture runs (production path always sets it)
  loadReceipts: LoadReceipts | null;
  log?: (s: string) => void;
}

// ─── the core payload (computed twice for G3, byte-compared) ────────────────────

export function runOnce(store: LineupStore, opts: RunOpts) {
  const log = opts.log ?? (() => {});
  const env = buildEnv(store);
  log(`[lineup] env built: ${env.states.length} states × ${env.T} days`);

  // G0 — positive control (§8): the harness must detect regression to the mean
  const g0Rep = evalReplicate(env, null, { predicate: "g0", guardDays: GUARD_DAYS, detail: true });
  const g0P = mcnemarOneSided(g0Rep.disc.b, g0Rep.disc.c);
  const g0Pass = g0Rep.delta !== null && g0Rep.delta >= G0_FLOOR && g0P <= G0_MCNEMAR_BAR;
  log(`[lineup] G0: delta=${g0Rep.delta} p=${g0P} pass=${g0Pass}`);

  // G2 — full-pipeline negative control at rotation offset 3 (outside the null set)
  const outer = makeRemap(env.cal, G2_OFFSET);
  const g2Bat = battery(env, outer, log, "G2");
  const g2Cert = certification(g2Bat.obs.delta, g2Bat.rots);
  const g0AtG2 = evalReplicate(env, outer, { predicate: "g0", guardDays: GUARD_DAYS });
  const g0AtG2P = mcnemarOneSided(g0AtG2.disc.b, g0AtG2.disc.c);
  const g0AtG2Pass = g0AtG2.delta !== null && g0AtG2.delta >= G0_FLOOR && g0AtG2P <= G0_MCNEMAR_BAR;
  const g2Pass = !g2Cert.certified && g0AtG2Pass;
  log(`[lineup] G2: certifiedOnRotated=${g2Cert.certified} g0Invariance=${g0AtG2Pass} pass=${g2Pass}`);

  // PRIMARY — observed vs the 64 registered rotations
  const bat = battery(env, null, log, "primary");
  const obs = bat.obs;
  const cert = certification(obs.delta, bat.rots);
  const missL = obs.paired - obs.hitL;
  const missN = obs.paired - obs.hitN;
  const fisherP = obs.paired > 0 ? fisherExactOneSided(obs.hitL, missL, obs.hitN, missN) : 1;
  const mcnP = mcnemarOneSided(obs.disc.b, obs.disc.c);

  // S7/S8 — guard variants (observed only; diagnostics, never gate)
  const s7 = evalReplicate(env, null, { predicate: "lineup", guardDays: 0 });
  const s8 = GUARD_SENSITIVITY.map((g) =>
    evalReplicate(env, null, { predicate: "lineup", guardDays: g }));
  log(`[lineup] guard variants done`);

  // SECONDARIES — one 57-test BH family (50 states + 2 modes + 3 verbs + 2 epochs)
  const modeNames = ["moon_tide_temp", "moon_temp"];
  const verbNames = ["cooled", "warmed", "held"];
  const epochNames = [`${env.cal.year0}-${EPOCH_SPLIT_YEAR - 1}`, `${EPOCH_SPLIT_YEAR}-${env.cal.year0 + env.cal.yearSpan - 1}`];
  const states = env.states;
  const sub = (
    name: string, kind: string, acc: { n: number; sum: number }, rotVals: (number | null)[],
  ) => {
    const delta = accDelta(acc);
    return { name, kind, n: acc.n, delta, p: empiricalP(delta, rotVals) };
  };
  const family = [
    ...states.map((s, i) => sub(s, "state", obs.perState[i], bat.rots.map((r) => r.perState[i]))),
    ...modeNames.map((m, i) => sub(m, "mode", obs.perMode[i], bat.rots.map((r) => r.perMode[i]))),
    ...verbNames.map((v, i) => sub(v, "verb", obs.perVerb[i], bat.rots.map((r) => r.perVerb[i]))),
    ...epochNames.map((e, i) => sub(e, "epoch", obs.perEpoch[i], bat.rots.map((r) => r.perEpoch[i]))),
  ];
  const bh = benjaminiHochberg(family.map((f) => f.p), BH_Q);
  const familyOut = family.map((f, i) => ({ ...f, bhRejected: bh.rejected[i] }));

  const s1 = { n: obs.s1.n, delta: accDelta(obs.s1), p: empiricalP(accDelta(obs.s1), bat.rots.map((r) => r.s1)) };
  const s6Obs = obs.s6;
  const s6 = {
    lN: s6Obs.lN, lCooled: s6Obs.lCooled, nN: s6Obs.nN, nCooled: s6Obs.nCooled,
    pCooledGivenL: s6Obs.lN > 0 ? s6Obs.lCooled / s6Obs.lN : null,
    pCooledGivenN: s6Obs.nN > 0 ? s6Obs.nCooled / s6Obs.nN : null,
    diff: s6DiffOf(s6Obs),
    p: empiricalP(s6DiffOf(s6Obs), bat.rots.map((r) => r.s6Diff)),
  };

  const wl = obs.paired > 0 ? wilsonInterval(obs.hitL, obs.paired) : null;
  const wn = obs.paired > 0 ? wilsonInterval(obs.hitN, obs.paired) : null;

  return {
    params: {
      registration: "REGISTRATION-LINEUP-RETRO.md (frozen 2026-07-16, commit c135065)",
      seed: opts.seed,
      era: `${store.startIso}..${store.endIso}`,
      states: states.length,
      window: "±3 day-of-year",
      aftermath: "next 7 recorded days",
      moonTolDays: 2,
      tempTolF: 5,
      tempNearF: 2,
      tideElevFt: 0.5,
      tideJointDayFloor: 60,
      baselineFloorYears: 5,
      outcomeBarF: 5,
      precedentPick: "most-recent match (date desc, matches[0] verbatim)",
      moonMath: "Schlyter, copied verbatim from hunt-atlas-spot (never frames.ts moonPhase)",
      antiLeakageGuardDays: GUARD_DAYS,
      rotations: `5..71 minus {19,38,57} = ${N_ROTATIONS} (exact p = 1/${N_ROTATIONS + 1})`,
      passBar: `delta > all ${N_ROTATIONS} rotations AND delta >= +2.0pp`,
      g2Offset: G2_OFFSET,
      g0Bar: "delta_pos >= +2.0pp AND descriptive McNemar p <= 1e-6",
      bh: `q = ${BH_Q}, one ${family.length}-test family`,
      deviations: "D1 as-if-live day-0; D2 symmetric LOYO; D3 GHCN ground; D4 ±10d guard (S7/S8 sensitivity)",
    },
    receipts: opts.loadReceipts ?? { synthetic: true as const },
    parity: opts.parity ?? { skipped: "synthetic fixture run — the parity gate runs on the production path only" },
    g0: {
      pass: g0Pass,
      delta: g0Rep.delta,
      paired: g0Rep.paired,
      hitTreatment: g0Rep.hitL,
      hitControl: g0Rep.hitN,
      discordant: g0Rep.disc,
      mcnemarP: g0P,
      funnel: g0Rep.funnel,
    },
    g2: {
      outerOffset: G2_OFFSET,
      rotatedDelta: g2Bat.obs.delta,
      rotatedPaired: g2Bat.obs.paired,
      maxRotationDelta: g2Cert.maxRotation,
      certifiedOnRotated: g2Cert.certified,
      g0UnderRotation: { pass: g0AtG2Pass, delta: g0AtG2.delta, mcnemarP: g0AtG2P },
      pass: g2Pass,
    },
    primary: {
      certified: cert.certified,
      beatsAllRotations: cert.beatsAll,
      importanceFloorMet: cert.floorMet,
      delta: obs.delta,
      paired: obs.paired,
      hitL: obs.hitL,
      hitN: obs.hitN,
      hitRateL: wl ? { rate: obs.hitL / obs.paired, wilsonLo: wl.lo, wilsonHi: wl.hi } : null,
      hitRateN: wn ? { rate: obs.hitN / obs.paired, wilsonLo: wn.lo, wilsonHi: wn.hi } : null,
      discordant: obs.disc,
      fisherP_descriptive: fisherP,
      mcnemarP_descriptive: mcnP,
      maxRotationDelta: cert.maxRotation,
      rotations: bat.rots.map((r) => ({ offset: r.offset, delta: r.delta, paired: r.paired })),
      funnel: obs.funnel,
    },
    secondaries: {
      s1_argmaxState: s1,
      family: familyOut,
      bhThreshold: bh.threshold,
      bhRejectedCount: familyOut.filter((f) => f.bhRejected).length,
      s6_memberLevel: s6,
      s7_unguarded: { delta: s7.delta, paired: s7.paired },
      s8_guardSensitivity: GUARD_SENSITIVITY.map((g, i) => ({ guardDays: g, delta: s8[i].delta, paired: s8[i].paired })),
    },
    diagnostics: {
      verbMixL: obs.detail!.verbMixL,
      verbMixN: obs.detail!.verbMixN,
      distinctPrecedentDaysL: obs.detail!.distinctPrecedentsL,
      distinctPrecedentDaysN: obs.detail!.distinctPrecedentsN,
      precedentVintageMedianYearL: obs.detail!.vintageMedianYearL,
      precedentVintageMedianYearN: obs.detail!.vintageMedianYearN,
      ungradeableL: obs.detail!.ungradeableL,
      ungradeableN: obs.detail!.ungradeableN,
      pairedByMode: obs.detail!.modePaired,
    },
  };
}

export type CorePayload = ReturnType<typeof runOnce>;

export interface LineupResult {
  payload: CorePayload & {
    g3: { pass: boolean; bytes: number };
    verdict: {
      parity: boolean | null; g0: boolean; g2: boolean; g3: boolean;
      beatsAllRotations: boolean; importanceFloorMet: boolean; certified: boolean;
      final: string;
    };
  };
  json: string;
  report: string;
}

export function runLineupRetro(store: LineupStore, opts: RunOpts): LineupResult {
  // G3: the full payload recomputed a second time in-process, byte-compared.
  const p1 = runOnce(store, opts);
  const p2 = runOnce(store, { ...opts, log: undefined });
  const j1 = JSON.stringify(p1);
  const j2 = JSON.stringify(p2);
  const g3 = { pass: j1 === j2, bytes: j1.length };

  const parityPass = opts.parity ? opts.parity.pass : null;
  let final: string;
  if (!g3.pass) {
    final = "RUN INVALID — G3 determinism failure (two in-process recomputes differ byte-wise); code bug: fix code (never the registration), rerun (§10).";
  } else if (parityPass === false) {
    final = "RUN INVALID — parity gate failure (the engine does not reproduce the deployed spot's bookkeeping); code bug: fix code, rerun (§8/§10).";
  } else if (!p1.g0.pass) {
    final = "HARNESS INVALID — G0 positive control failed; NO verdict is read from the primary. One pre-declared repair permitted (version bump, documented diff); the timebox clock does not pause (§8/§10).";
  } else if (!p1.g2.pass) {
    final = "RUN INVALID — G2 negative control failed (the primary certified on rotated data, or G0 lost invariance under rotation); code bug: fix code, rerun (§8/§10).";
  } else if (p1.primary.certified) {
    final = "CERTIFIED LIFT — the lineup-selected precedent beats the anomaly-matched-only precedent above all 64 rotations and the +2.0pp importance floor. The lineup lane survives; timebox gate 1 PASS; documented re-hearing per the timebox (§10).";
  } else {
    const detectable = p1.primary.beatsAllRotations && p1.primary.delta !== null &&
      p1.primary.delta > 0 && !p1.primary.importanceFloorMet;
    final = "NO LIFT — the lineup claim lane dies in THE-WEEK.md the same night (§10). " +
      "Named trigger scope: the Morning Line's lineup sentence and precedent-claim lane " +
      "(hunt-atlas-spot lineup block, hunt-morning-line lineup_sentence, the grader's precedent path) " +
      "are retired or demoted to control-line-only copy — the surgery executes by main session." +
      (detectable
        ? " NOTE: the observed delta beats all rotations but sits below the registered +2.0pp importance floor — detectable but below the registered importance floor; the lane still dies as registered."
        : "");
  }

  const payload = {
    ...p1,
    g3,
    verdict: {
      parity: parityPass,
      g0: p1.g0.pass,
      g2: p1.g2.pass,
      g3: g3.pass,
      beatsAllRotations: p1.primary.beatsAllRotations,
      importanceFloorMet: p1.primary.importanceFloorMet,
      certified: p1.primary.certified,
      final,
    },
  };
  return { payload, json: JSON.stringify(payload, null, 1), report: renderReport(payload) };
}

// ─── report (run-of-record order; no timestamps) ────────────────────────────────

const f4 = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : x.toFixed(4));
const f6 = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : x.toFixed(6));
const pp = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(2)}pp`);
const sci = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : x.toExponential(2));

function renderReport(p: LineupResult["payload"]): string {
  const L: string[] = [];
  L.push(`# LINEUP RETRODICTION TEST — timebox gate 1`);
  L.push(``);
  L.push(`Registration: ${p.params.registration} · seed ${p.params.seed} · era ${p.params.era} (${p.params.states} states)`);
  L.push(`Pass bar: Δ strictly beats all ${N_ROTATIONS} rotations (exact p = 1/${N_ROTATIONS + 1}) AND Δ ≥ +2.0pp. Fisher/McNemar are DESCRIPTIVE ONLY — inference lives in the rotations alone (§7).`);
  L.push(``);

  L.push(`## 1. SUBSTRATE RECEIPTS (load gates, §2)`);
  L.push(``);
  const r = p.receipts as any;
  if (r.synthetic) {
    L.push(`Synthetic fixture store (development firewall, §8) — production load gates run on the run of record only.`);
  } else {
    const g = r.ghcn, t = r.tide;
    L.push(`- ghcn-daily rows loaded: ${g.rows} (unknown-state rows skipped: ${g.unknownStateRows})`);
    L.push(`- per-state-year row counts: min ${g.stateYears.min}, max ${g.stateYears.max}; state-years under 360 rows: ${g.stateYears.deficient.length}` +
      (g.stateYears.deficient.length ? ` — ${g.stateYears.deficient.slice(0, 12).map((x: any) => `${x.state}/${x.year}:${x.rows}`).join(", ")}${g.stateYears.deficient.length > 12 ? ", …" : ""}` : ""));
    L.push(`- 500-row metadata≡content parity: checked ${g.parity500.checked}, max |diff| ${g.parity500.maxAbsDiff.toFixed(4)}°F → ${g.parity500.pass ? "PASS" : "FAIL (aborts the run)"}`);
    L.push(`- tide-gauge rows with residual_ft: ${t.rows} across ${t.stations} stations`);
    L.push(``);
    L.push(`tide coverage receipt (station-days with residual_ft per state × decade — the tide clause's honest reach):`);
    L.push(``);
    L.push(`| state | decade | days |`);
    L.push(`|---|---|---|`);
    for (const row of t.stateDecadeDays) L.push(`| ${row.state} | ${row.decade} | ${row.days} |`);
  }
  L.push(``);

  L.push(`## 2. PARITY GATE (verbatim-faithfulness, §8)`);
  L.push(``);
  const par = p.parity as any;
  if (par.skipped) {
    L.push(`${par.skipped}`);
  } else {
    L.push(`10 seeded live probes vs the DEPLOYED hunt-atlas-spot on ${par.date} (spot's own bookkeeping mode). EXACT-match fields: n_matches, last_date, mode, n_days_searched, control.all_n, control.all_outcome_n.`);
    L.push(``);
    L.push(`| state | pass | mismatches | moon |Δage| |`);
    L.push(`|---|---|---|---|`);
    for (const pr of par.probes) {
      const bad = Object.entries(pr.fields).filter(([, v]: any) => !v.match).map(([k, v]: any) => `${k}: engine ${v.engine} vs spot ${v.spot}`);
      L.push(`| ${pr.state} | ${pr.pass ? "PASS" : "FAIL"} | ${bad.length ? bad.join("; ") : "—"} | ${pr.moonAgeAbsDiff === null ? "—" : pr.moonAgeAbsDiff.toFixed(4)} |`);
    }
    L.push(``);
    L.push(`**PARITY: ${par.pass ? "PASS" : "FAIL — parity failure stops the run (code gate, fix and rerun)"}**`);
  }
  L.push(``);

  L.push(`## 3. G0 — POSITIVE CONTROL (regression to the mean, §8)`);
  L.push(``);
  L.push(`Identical machinery, one predicate swap: treatment = most-recent A(d) member (anomaly-matched), control = most-recent member of pool \\ A(d) (season-matched only).`);
  L.push(`- Δ_pos = ${pp(p.g0.delta)} over ${p.g0.paired} pairs (hits ${p.g0.hitTreatment} vs ${p.g0.hitControl}; discordant ${p.g0.discordant.b}/${p.g0.discordant.c})`);
  L.push(`- descriptive McNemar p = ${sci(p.g0.mcnemarP)} (bar ≤ 1e-6); floor ≥ +2.0pp`);
  L.push(``);
  L.push(`**G0: ${p.g0.pass ? "PASS — the harness detects a rule known to carry information" : "FAIL — HARNESS INVALID; no verdict is read from the primary (§8)"}**`);
  L.push(``);

  L.push(`## 4. G2 — FULL-PIPELINE NEGATIVE CONTROL (rotation offset ${p.g2.outerOffset}, §8)`);
  L.push(``);
  L.push(`- primary on rotated data: Δ = ${pp(p.g2.rotatedDelta)} (${p.g2.rotatedPaired} pairs), max composed-rotation Δ = ${pp(p.g2.maxRotationDelta)} → ${p.g2.certifiedOnRotated ? "CERTIFIED (INVALIDATES THE RUN)" : "not certified (correct)"}`);
  L.push(`- G0 invariance receipt (temp-only control must survive the moon+tide rotation): Δ_pos = ${pp(p.g2.g0UnderRotation.delta)}, McNemar ${sci(p.g2.g0UnderRotation.mcnemarP)} → ${p.g2.g0UnderRotation.pass ? "PASS" : "FAIL"}`);
  L.push(``);
  L.push(`**G2: ${p.g2.pass ? "PASS" : "FAIL — the run is invalid (§8/§10)"}**`);
  L.push(``);

  L.push(`## 5. G3 — DETERMINISM`);
  L.push(``);
  L.push(`Full payload recomputed a second time in-process and byte-compared: ${p.g3.pass ? `IDENTICAL (${p.g3.bytes} bytes)` : "MISMATCH — RUN INVALID"}. No timestamps in the payload; Math.random banned; seed ${p.params.seed} touches only fixtures, the 500-row sample, and parity-probe selection.`);
  L.push(``);

  L.push(`## 6. PRIMARY — Δ vs the ${N_ROTATIONS} rotations (§6/§7)`);
  L.push(``);
  L.push(`Δ = mean over paired index days of [Hit_L(d) − Hit_N(d)] — the lineup clause's marginal value over season + anomaly depth.`);
  L.push(``);
  const fu = p.primary.funnel;
  L.push(`eligibility funnel (§4 — every stage counted):`);
  L.push(``);
  L.push(`| stage | count |`);
  L.push(`|---|---|`);
  L.push(`| index state-days | ${fu.indexDays} |`);
  L.push(`| with recorded high (D1 day-0) | ${fu.withHigh} |`);
  L.push(`| with offMean(0) computable (LOYO ≥ 5y, D2) | ${fu.withBaseline} |`);
  L.push(`| dropped: L(d) empty | ${fu.lEmpty} |`);
  L.push(`| dropped: N(d) empty | ${fu.nEmpty} |`);
  L.push(`| both arms non-empty | ${fu.bothArms} |`);
  L.push(`| dropped: L precedent makes no claim (thin) | ${fu.lNoClaim} |`);
  L.push(`| dropped: N precedent makes no claim (thin) | ${fu.nNoClaim} |`);
  L.push(`| both claims parse to a verb | ${fu.claimsParsed} |`);
  L.push(`| dropped: UNGRADEABLE (either arm, §5) | ${fu.ungradeable} |`);
  L.push(`| **paired n** | **${fu.paired}** |`);
  L.push(``);
  L.push(`- **Δ_obs = ${pp(p.primary.delta)}** (${p.primary.paired} pairs)`);
  const hl = p.primary.hitRateL, hn = p.primary.hitRateN;
  if (hl && hn) {
    L.push(`- Hit_L = ${f4(hl.rate)} [Wilson ${f4(hl.wilsonLo)}, ${f4(hl.wilsonHi)}] (${p.primary.hitL}/${p.primary.paired}); Hit_N = ${f4(hn.rate)} [${f4(hn.wilsonLo)}, ${f4(hn.wilsonHi)}] (${p.primary.hitN}/${p.primary.paired})`);
  }
  L.push(`- discordant pairs b/c = ${p.primary.discordant.b}/${p.primary.discordant.c}; DESCRIPTIVE Fisher p = ${sci(p.primary.fisherP_descriptive)}, McNemar p = ${sci(p.primary.mcnemarP_descriptive)} (anti-conservative under serial correlation — never gate)`);
  L.push(`- max rotation Δ = ${pp(p.primary.maxRotationDelta)}; beats all ${N_ROTATIONS}: ${p.primary.beatsAllRotations ? "YES" : "no"}; ≥ +2.0pp floor: ${p.primary.importanceFloorMet ? "YES" : "no"}`);
  L.push(``);
  L.push(`all ${N_ROTATIONS} rotation Δs (offset: Δ, paired):`);
  L.push(``);
  L.push(p.primary.rotations.map((rt) => `${rt.offset}: ${rt.delta === null ? "—" : (rt.delta * 100).toFixed(3)}pp (${rt.paired})`).join(" · "));
  L.push(``);
  L.push(`**PRIMARY: ${p.primary.certified ? "CERTIFIED LIFT" : "NO LIFT"}**`);
  L.push(``);

  L.push(`## 7. SECONDARIES AND DIAGNOSTICS (§9 — printed; never gate; never promoted)`);
  L.push(``);
  const s = p.secondaries;
  L.push(`- S1 argmax-|z| subpopulation (the state the Morning Line quotes; n_years ≥ 10): Δ = ${pp(s.s1_argmaxState.delta)} (n ${s.s1_argmaxState.n}, rotation p ${f4(s.s1_argmaxState.p)} — descriptive, outside the BH family)`);
  L.push(`- S6 member-level pooled 2×2: P(cooled≥5 | L) = ${f4(s.s6_memberLevel.pCooledGivenL)} (${s.s6_memberLevel.lCooled}/${s.s6_memberLevel.lN}) vs P(cooled≥5 | N) = ${f4(s.s6_memberLevel.pCooledGivenN)} (${s.s6_memberLevel.nCooled}/${s.s6_memberLevel.nN}); diff ${pp(s.s6_memberLevel.diff)}, rotation p ${f4(s.s6_memberLevel.p)}`);
  L.push(`- S7 unguarded verbatim Δ (no ±10d exclusion): ${pp(s.s7_unguarded.delta)} (${s.s7_unguarded.paired} pairs)`);
  for (const g of s.s8_guardSensitivity) L.push(`- S8 guard ±${g.guardDays}d: Δ = ${pp(g.delta)} (${g.paired} pairs)`);
  L.push(``);
  L.push(`ONE ${s.family.length}-test BH family (q = ${BH_Q}; threshold ${f6(s.bhThreshold)}; rejected ${s.bhRejectedCount}):`);
  L.push(``);
  L.push(`| test | kind | n | Δ | rotation p | BH |`);
  L.push(`|---|---|---|---|---|---|`);
  for (const f of s.family) L.push(`| ${f.name} | ${f.kind} | ${f.n} | ${pp(f.delta)} | ${f4(f.p)} | ${f.bhRejected ? "REJECTED (significant)" : "—"} |`);
  L.push(``);
  const d = p.diagnostics;
  L.push(`diagnostics:`);
  L.push(``);
  L.push(`- per-arm verb mix (paired days; cooled/warmed/held): L = ${d.verbMixL.join("/")}, N = ${d.verbMixN.join("/")}`);
  L.push(`- cluster receipt — distinct precedent days: L = ${d.distinctPrecedentDaysL}, N = ${d.distinctPrecedentDaysN}`);
  L.push(`- precedent vintage (median year): L = ${d.precedentVintageMedianYearL ?? "—"}, N = ${d.precedentVintageMedianYearN ?? "—"}`);
  L.push(`- UNGRADEABLE drops: L-arm ${d.ungradeableL}, N-arm ${d.ungradeableN}`);
  L.push(`- paired days by mode (moon_tide_temp / moon_temp): ${d.pairedByMode.join(" / ")}`);
  L.push(``);

  L.push(`## 8. VERDICT (§10)`);
  L.push(``);
  const v = p.verdict;
  L.push(`- parity ${v.parity === null ? "n/a (fixture)" : v.parity ? "PASS" : "FAIL"} · G0 ${v.g0 ? "PASS" : "FAIL"} · G2 ${v.g2 ? "PASS" : "FAIL"} · G3 ${v.g3 ? "PASS" : "FAIL"} · beats-all-rotations ${v.beatsAllRotations ? "YES" : "no"} · ≥2pp ${v.importanceFloorMet ? "YES" : "no"}`);
  L.push(``);
  L.push(`**${v.final}**`);
  L.push(``);
  return L.join("\n");
}

// ─── production loader (run of record only — NEVER run under the development
//     firewall; the main session fires it) ─────────────────────────────────────

let KEY: string | null = null;
function serviceKey(): string {
  if (KEY) return KEY;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return (KEY = process.env.SUPABASE_SERVICE_ROLE_KEY);
  const out = execSync(
    "npx supabase projects api-keys --project-ref rvhyotvklfowklzjahdd --output json 2>/dev/null",
    { encoding: "utf-8", timeout: 30_000 },
  );
  const arr = JSON.parse(out);
  const k = (Array.isArray(arr) ? arr : []).find(
    (x: any) => x.id === "service_role" || x.name === "service_role",
  )?.api_key;
  if (!k) throw new Error("no service_role key");
  return (KEY = k);
}
function headers(): Record<string, string> {
  const k = serviceKey();
  return { Authorization: `Bearer ${k}`, apikey: k };
}

/** fetch with retry — 5xx/network only, NEVER 4xx. */
async function fetchJson(url: string, tries = 4): Promise<any> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    try {
      const res = await fetch(url, { headers: headers() });
      if (res.ok) return res.json();
      const body = (await res.text()).slice(0, 200);
      if (res.status >= 400 && res.status < 500) {
        throw Object.assign(new Error(`${res.status} (no retry): ${body}`), { fatal: true });
      }
      lastErr = new Error(`${res.status}: ${body}`);
    } catch (e: any) {
      if (e?.fatal) throw e;
      lastErr = e;
    }
  }
  throw lastErr;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(HERE, ".retro-cache");
const OUT_DIR = join(HERE, "out");

/** One bounded ascending year of a content type — pages ascend with date
 *  bounds (NEVER desc unbounded — 57014), cached to .retro-cache/. */
async function loadYear(kind: "ghcn" | "tide", year: number, select: string, extra: string): Promise<any[]> {
  const cache = join(CACHE_DIR, `${kind}-${year}.json`);
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, "utf-8"));
  const rows: any[] = [];
  for (let page = 0; ; page++) {
    const url = `${SUPABASE_URL}/rest/v1/hunt_knowledge?` +
      `content_type=eq.${kind === "ghcn" ? "ghcn-daily" : "tide-gauge"}` +
      `&select=${encodeURIComponent(select)}${extra}` +
      `&effective_date=gte.${year}-01-01&effective_date=lte.${year}-12-31` +
      `&order=effective_date.asc,id.asc&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`;
    const data = await fetchJson(url);
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cache, JSON.stringify(rows));
  return rows;
}

export async function loadProductionStore(seed: number, log: (s: string) => void):
  Promise<{ store: LineupStore; receipts: LoadReceipts }> {
  const y0 = Number(ERA_START.slice(0, 4));
  const y1 = Number(ERA_END.slice(0, 4));
  const T = Math.round((Date.parse(`${ERA_END}T00:00:00Z`) - Date.parse(`${ERA_START}T00:00:00Z`)) / 864e5) + 1;
  const ts0 = Date.parse(`${ERA_START}T00:00:00Z`);
  const idxOf = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - ts0) / 864e5);
  const yearOfDay = new Int16Array(T); // calendar year per day index (receipts — never d/365.25)
  for (let d = 0; d < T; d++) yearOfDay[d] = Number(new Date(ts0 + d * 864e5).toISOString().slice(0, 4));
  const stateIdx = new Map(STATE_ABBRS.map((s, i) => [s, i] as const));

  // GHCN — per-year ascending bounded pages (§2 substrate)
  const high = new Map<string, Float64Array>(STATE_ABBRS.map((s) => [s, new Float64Array(T).fill(NaN)]));
  const syCount = new Int32Array(STATE_ABBRS.length * (y1 - y0 + 1));
  let ghcnRows = 0, unknownState = 0;
  for (let y = y0; y <= y1; y++) {
    const rows = await loadYear("ghcn", y, "effective_date,state_abbr,high:metadata->avg_high_f", "");
    for (const r of rows) {
      const si = stateIdx.get(String(r.state_abbr));
      if (si === undefined) { unknownState++; continue; }
      const d = idxOf(String(r.effective_date).slice(0, 10));
      if (d < 0 || d >= T) continue;
      const v = typeof r.high === "number" && Number.isFinite(r.high) ? r.high : NaN;
      if (Number.isFinite(v)) {
        high.get(STATE_ABBRS[si])![d] = v;
        ghcnRows++;
        syCount[si * (y1 - y0 + 1) + (y - y0)]++;
      }
    }
    if ((y - y0) % 10 === 0) log(`[load] ghcn ${y} done (${ghcnRows} rows so far)`);
  }
  let syMin = Infinity, syMax = 0;
  const deficient: { state: string; year: number; rows: number }[] = [];
  for (let si = 0; si < STATE_ABBRS.length; si++) {
    for (let y = y0; y <= y1; y++) {
      const c = syCount[si * (y1 - y0 + 1) + (y - y0)];
      if (c < syMin) syMin = c;
      if (c > syMax) syMax = c;
      if (c < 360) deficient.push({ state: STATE_ABBRS[si], year: y, rows: c });
    }
  }

  // TIDE — the ONLY key the product's tidePool reads is metadata.residual_ft
  // (§2); rows without it are invisible to the lineup as implemented.
  const tideByState = new Map<string, Map<string, { name: string; res: Float64Array }>>();
  let tideRows = 0;
  for (let y = y0; y <= y1; y++) {
    const rows = await loadYear("tide", y,
      "effective_date,state_abbr,sid:metadata->>station_id,sname:metadata->>station_name,res:metadata->residual_ft",
      "&metadata->>residual_ft=not.is.null");
    for (const r of rows) {
      const res = typeof r.res === "number" && Number.isFinite(r.res) ? r.res : NaN;
      if (!Number.isFinite(res)) continue;
      const st = String(r.state_abbr ?? "");
      if (!stateIdx.has(st)) continue;
      const sid = String(r.sid ?? r.sname ?? "");
      if (!sid) continue;
      const d = idxOf(String(r.effective_date).slice(0, 10));
      if (d < 0 || d >= T) continue;
      if (!tideByState.has(st)) tideByState.set(st, new Map());
      const m = tideByState.get(st)!;
      if (!m.has(sid)) m.set(sid, { name: String(r.sname ?? sid), res: new Float64Array(T).fill(NaN) });
      m.get(sid)!.res[d] = res;
      tideRows++;
    }
  }
  const tide = new Map<string, TideStationData[]>();
  const stateDecadeDays: { state: string; decade: string; days: number }[] = [];
  let stationCount = 0;
  for (const [st, m] of [...tideByState.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const stations: TideStationData[] = [...m.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([id, s]) => ({ id, name: s.name, res: s.res }));
    tide.set(st, stations);
    stationCount += stations.length;
    const perDecade = new Map<string, number>();
    for (const s of stations) {
      for (let d = 0; d < T; d++) {
        if (Number.isFinite(s.res[d])) {
          const decade = `${Math.floor(yearOfDay[d] / 10) * 10}s`;
          perDecade.set(decade, (perDecade.get(decade) ?? 0) + 1);
        }
      }
    }
    for (const [decade, days] of [...perDecade.entries()].sort()) stateDecadeDays.push({ state: st, decade, days });
  }
  log(`[load] tide done: ${tideRows} residual_ft rows, ${stationCount} stations`);

  // 500-row metadata≡content parity (§2) — seeded sample, aborts on mismatch
  const rng = seededRng(fnv(`${seed}|ghcn-parity-500`));
  const sample: { state: string; iso: string; high: number }[] = [];
  let guardIter = 0;
  while (sample.length < PARITY_SAMPLE && guardIter++ < 100000) {
    const si = Math.floor(rng() * STATE_ABBRS.length);
    const d = Math.floor(rng() * T);
    const v = high.get(STATE_ABBRS[si])![d];
    if (!Number.isFinite(v)) continue;
    const iso = new Date(ts0 + d * 864e5).toISOString().slice(0, 10);
    sample.push({ state: STATE_ABBRS[si], iso, high: v });
  }
  const byState = new Map<string, typeof sample>();
  for (const s of sample) {
    if (!byState.has(s.state)) byState.set(s.state, []);
    byState.get(s.state)!.push(s);
  }
  let checked = 0, maxAbsDiff = 0;
  for (const [st, rows] of byState) {
    for (let i = 0; i < rows.length; i += 50) {
      const chunk = rows.slice(i, i + 50);
      const dates = chunk.map((c) => c.iso).join(",");
      const data = await fetchJson(`${SUPABASE_URL}/rest/v1/hunt_knowledge?content_type=eq.ghcn-daily&state_abbr=eq.${st}&effective_date=in.(${dates})&select=effective_date,content`);
      const contentByDate = new Map<string, string>(data.map((r: any) => [String(r.effective_date).slice(0, 10), String(r.content ?? "")]));
      for (const c of chunk) {
        const m = (contentByDate.get(c.iso) ?? "").match(AVG_HIGH_RE);
        if (!m) throw new Error(`LOAD GATE FAIL: ${st} ${c.iso} content has no parsable avg high (metadata says ${c.high})`);
        const diff = Math.abs(parseFloat(m[1]) - c.high);
        if (diff > maxAbsDiff) maxAbsDiff = diff;
        if (diff > PARITY_TOL_F) throw new Error(`LOAD GATE FAIL: ${st} ${c.iso} metadata ${c.high} vs content ${m[1]} (|diff| ${diff} > ${PARITY_TOL_F})`);
        checked++;
      }
    }
  }
  log(`[load] 500-row parity: checked ${checked}, max |diff| ${maxAbsDiff.toFixed(4)}°F`);

  return {
    store: { startIso: ERA_START, endIso: ERA_END, states: STATE_ABBRS, high, tide },
    receipts: {
      ghcn: {
        rows: ghcnRows,
        unknownStateRows: unknownState,
        stateYears: { deficient, min: syMin, max: syMax },
        parity500: { checked, maxAbsDiff, pass: true },
      },
      tide: { rows: tideRows, stations: stationCount, stateDecadeDays },
    },
  };
}

// ─── parity gate (b): 10 seeded live probes vs the deployed spot (§8) ───────────

export function pickProbeStates(seed: number): string[] {
  const rng = seededRng(fnv(`${seed}|parity-probes`));
  const pool = [...STATE_ABBRS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, N_PROBES);
}

async function fetchSpot(state: string, dateIso: string): Promise<any> {
  return fetchJson(`${SUPABASE_URL}/functions/v1/hunt-atlas-spot?state=${state}&date=${dateIso}&slim=1`);
}

export async function runParityGate(env: Env, seed: number, dateIso: string, log: (s: string) => void): Promise<ParityBlock> {
  const states = pickProbeStates(seed);
  const probes: ParityProbe[] = [];
  for (const st of states) {
    const resp = await fetchSpot(st, dateIso);
    const si = env.states.indexOf(st);
    const day0 = typeof resp?.past?.anomaly?.value === "number" ? resp.past.anomaly.value : null;
    const eng = spotLiveLineup(env, si, dateIso, day0);
    const lu = resp?.lineup ?? null;
    const ctl = resp?.control ?? null;
    const fields: ParityProbe["fields"] = {};
    let pass: boolean;
    let note: string | null = null;
    if (lu === null || !eng.computable) {
      pass = lu === null && !eng.computable;
      note = `no lineup: spot ${lu === null ? "null" : "present"}, engine ${eng.computable ? "computable" : `not computable (${eng.reason})`}`;
    } else {
      const cmp = (k: string, engineVal: unknown, spotVal: unknown) => {
        const match = engineVal === spotVal;
        fields[k] = { engine: engineVal, spot: spotVal, match };
        return match;
      };
      // evaluate all six even when one fails (full receipt)
      cmp("n_matches", eng.n_matches, lu.n_matches);
      cmp("last_date", eng.last_date, lu.last_date ?? null);
      cmp("mode", eng.mode, lu.mode);
      cmp("n_days_searched", eng.n_days_searched, lu.n_days_searched);
      cmp("control.all_n", eng.all_n, ctl?.all_n ?? null);
      cmp("control.all_outcome_n", eng.all_outcome_n, ctl?.all_outcome_n ?? null);
      pass = Object.values(fields).every((f) => f.match);
    }
    const spotMoon = typeof lu?.today?.moon_age === "number" ? lu.today.moon_age : null;
    const moonDiff = spotMoon !== null && eng.moon_age_today !== null
      ? Math.abs(spotMoon - eng.moon_age_today) : null;
    probes.push({ state: st, date: dateIso, pass, fields, moonAgeAbsDiff: moonDiff, note });
    log(`[parity] ${st} ${dateIso}: ${pass ? "PASS" : "FAIL"}${note ? ` (${note})` : ""}`);
  }
  return { date: dateIso, probes, pass: probes.every((p) => p.pass) };
}

/** --probe-dry: the development firewall's ONLY permitted network — fire the
 *  10 seeded GETs, print the spot's key fields + the pure-math moon check.
 *  NO substrate loads, NO engine comparison (that runs on the run of record). */
async function probeDry(seed: number): Promise<void> {
  const dateIso = new Date().toISOString().slice(0, 10);
  const states = pickProbeStates(seed);
  const out: any[] = [];
  for (const st of states) {
    const resp = await fetchSpot(st, dateIso);
    const lu = resp?.lineup ?? null;
    const ctl = resp?.control ?? null;
    const engineMoon = moonAgeOnDate(dateIso);
    out.push({
      state: st,
      date: dateIso,
      lineup_present: lu !== null,
      mode: lu?.mode ?? null,
      n_matches: lu?.n_matches ?? null,
      last_date: lu?.last_date ?? null,
      n_days_searched: lu?.n_days_searched ?? null,
      n_years: lu?.n_years ?? null,
      day0_source: lu?.day0_source ?? null,
      tide_station: lu?.today?.tide_station ?? null,
      control_all_n: ctl?.all_n ?? null,
      control_all_outcome_n: ctl?.all_outcome_n ?? null,
      anomaly_value: resp?.past?.anomaly?.value ?? null,
      spot_moon_age: lu?.today?.moon_age ?? null,
      engine_moon_age: Math.round(engineMoon * 100) / 100,
      moon_parity: lu?.today?.moon_age != null
        ? Math.abs(lu.today.moon_age - engineMoon) <= 0.005 + 1e-9
        : null,
    });
  }
  process.stdout.write(JSON.stringify({ probe_dry: true, seed, probes: out }, null, 1) + "\n");
}

// ─── CLI (run of record — fired by the main session, never by tests) ────────────

function parseArgs(): { seed: number; jsonOnly: boolean; probeDry: boolean } {
  const argv = process.argv.slice(2);
  let seed = SEED_DEFAULT;
  let jsonOnly = false;
  let dry = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--seed") seed = Number(argv[++i]);
    else if (argv[i] === "--json-only") jsonOnly = true;
    else if (argv[i] === "--probe-dry") dry = true;
    else {
      console.error(`unknown arg ${argv[i]}\nusage: npx tsx scripts/mine/lineup-retro.ts [--seed 42] [--json-only] [--probe-dry]`);
      process.exit(1);
    }
  }
  if (!Number.isFinite(seed)) throw new Error("--seed must be a number");
  return { seed, jsonOnly, probeDry: dry };
}

async function main() {
  const { seed, jsonOnly, probeDry: dry } = parseArgs();
  if (dry) {
    await probeDry(seed);
    return;
  }
  const t0 = Date.now();
  const log = (s: string) => console.error(`${s} — ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  // 1. load gates (§2)
  const { store, receipts } = await loadProductionStore(seed, log);

  // 2. parity gate (§8) — 10 seeded live probes on the CURRENT date; failure stops the run
  const envForParity = buildEnv(store);
  const parity = await runParityGate(envForParity, seed, new Date().toISOString().slice(0, 10), log);
  if (!parity.pass) {
    console.error("[lineup] PARITY GATE FAILED — the run stops here (code gate: fix and rerun, §8).");
    console.error(JSON.stringify(parity, null, 1));
    process.exit(2);
  }

  // 3. the run of record: G0 → G2 → G3 → primary → secondaries → verdict
  const res = runLineupRetro(store, { seed, parity, loadReceipts: receipts, log });

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "lineup-retro.json"), res.json);
  log(`[lineup] wrote ${join(OUT_DIR, "lineup-retro.json")}`);
  if (!jsonOnly) {
    writeFileSync(join(OUT_DIR, "LINEUP-RETRO-REPORT.md"), res.report);
    log(`[lineup] wrote ${join(OUT_DIR, "LINEUP-RETRO-REPORT.md")}`);
  }
  process.stdout.write(res.report + "\n");
  log(`[lineup] total wall time`);
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
