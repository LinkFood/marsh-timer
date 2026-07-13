/**
 * report.ts — the Lookout Mine's human-readable output (docs/THE-WEEK.md PARK LIST:
 * THE LOOKOUT MINE / THE NEAR-MISS LAW).
 *
 * Owns the payload CONTRACT (MinePayload — what mine.ts must produce and what
 * out/lookout-candidates.json contains) and renders out/LOOKOUT-REPORT.md.
 *
 * REPORT LAWS:
 *  - Every candidate leads with a plain sentence in RAW units ("AO value ≤ −2.41"),
 *    never a bare percentile — that is what the LUT inversion exists for.
 *  - Every rate carries its raw counts and Wilson interval. Every q carries the
 *    total test count of the one BH family it survived.
 *  - The KILLED section stays visible: a report with only hits is a liar.
 *  - D0 rows are DETECTORS (the outcome lives in the slots on D0) — never
 *    written up as lookouts.
 *  - NO timestamps anywhere in payload or report (G3 determinism).
 */

// ─── payload contract ───────────────────────────────────────────────────────────

export interface WilsonCI {
  lo: number;
  hi: number;
  mid: number;
}

/** One tested candidate (cell × column × τ × k × lead) that survived BH. */
export interface CandidateRow {
  family: string;
  region: string; // "US" or state abbr
  tier: string; // ALL | SEVERE | MAJOR — severity of the merged effective anchors
  cell: string; // "family/region"
  column: string; // column id, e.g. "slot:007:needle-ao:value:low"
  columnLabel: string;
  kind: "slot" | "moon" | "depth";
  colClass: string; // calibration stratum: daily | monthly | moon | depth
  instId: string | null;
  metric: string | null;
  side: string | null;
  tau: number; // pct for slot/moon; count for depth
  thr: number; // byte threshold for slot/moon; count for depth
  k: number; // persistence: ≥k qualifying days in the lead bucket
  lead: string; // "D-30..D-8" | "D-7..D-1" | "D0"
  a: number; // event windows fired
  nEff: number; // event windows (post null-guard)
  b: number; // control windows fired
  m: number; // control windows (post null-guard)
  distinctYears: number; // distinct anchor years among surviving event windows
  eventRate: number;
  controlRate: number;
  eventWilson: WilsonCI;
  controlWilson: WilsonCI;
  lift: number;
  p: number;
  q: number; // SHIPPING q: shuffle-calibrated empirical FDR over the ONE sweep-wide family
  qBH: number; // BH-adjusted q (diagnostic — anti-conservative under year clustering)
  sentence: string; // RAW-units sentence (LUT-inverted for slots)
  rawValue: number | null; // inverted raw threshold (null for moon/depth/missing LUT)
  medianDoy: number; // cell's median anchor doy (wrap-aware) used for inversion
  score: number; // lift × log10(1/q) — ranking key within verdict class
}

export interface FireEpisode {
  start: string; // ISO day
  end: string;
  days: number; // fire days inside the episode
  era: "labeled" | "unlabeled"; // unlabeled = pre-1990 (no anchors exist there)
  followedBy: string | null; // "family d0 — title" of the anchor that began +2..+30d after a fire day; null = no anchor followed (or unlabeled era)
}

/** Deep-dive block computed for every non-D0 BH survivor. */
export interface DeepDive {
  fa: {
    scanDays: number; // matched-season 1990+ frame-days scanned
    baseRateDay: number; // P(same-family anchor begins +2..+30d | random matched-season 1990+ day)
    fireDays: number; // labeled-era fire days
    fireEpisodes: number; // labeled-era fire episodes (gap >7d splits)
    followedEpisodes: number;
    pEventFollowsFire: WilsonCI & { k: number; n: number }; // followed/episodes
    pFireGivenEvent: WilsonCI & { k: number; n: number }; // = a/nEff from the sweep
    unlabeledEpisodes: number; // pre-1990 episodes (shown in fire list, ungradable)
  };
  nearMiss: {
    band: string; // human description of the near-miss band
    fireBand: { fires: number; followed: number };
    nearBand: { fires: number; followed: number };
    fireDayCount: number;
    nearDayCount: number;
    ratio: number;
    p: number;
    verdict: "FUSION" | "DECORATION";
  };
  cliff: { tau: number; rate: number | null; fires: number; followed: number }[];
  fireList: FireEpisode[];
}

export interface Survivor extends CandidateRow {
  dive: DeepDive;
}

export interface GateG1 {
  ran: boolean;
  pass: boolean;
  detail: string[];
}

export interface MinePayload {
  params: {
    seed: number;
    shuffle: boolean;
    families: string[]; // families actually mined
    tiers: string[]; // tier definitions
    layoutVersion: number;
    frameDays: number;
    rawAnchors: number;
    effectiveAnchors: number;
    eligibleCells: number;
    columns: number;
    tauPcts: number[];
    tauBytes: number[];
    depthTaus: number[];
    kGrid: number[];
    leads: string[];
    controlYears: [number, number];
    controlsPerAnchor: number;
    nullGuardMinReadable: number;
    floorNEff: number;
    floorYears: number;
    bhQ: number;
    episodeGapDays: number;
    followWindow: [number, number];
    seasonHalfWidthDays: number;
    controlExclusionDays: number;
  };
  coverage: string[]; // honesty preamble lines
  controlYearGaps: { tier: string; controls: number; meanGap: number }[]; // epoch-matching audit
  trendDiagnostics: { column: string; label: string; slopePerDecade: number; years: number }[]; // v1.1 detrend audit, sorted by |slope|
  tierCells: { family: string; region: string; tier: string; nEff: number; distinctYears: number; eligible: boolean }[];
  cellBaseRates: { cell: string; tier: string; nEff: number; baseRateDay: number; scanDays: number }[];
  totalTests: number;
  untestedPairs: number; // cell×column pairs skipped by null-guard floors
  bhThresholdP: number;
  bhSurvivors: number; // BH-as-specified survivor count (diagnostic)
  calibration: {
    nullSweeps: number;
    classes: { cls: string; tests: number; nullTests: number; nullMinP: number; barP: number | null; survivors: number }[];
  };
  survivorsTotal: number; // shuffle-calibrated survivors (the shipping set)
  lookouts: Survivor[]; // non-D0 BH survivors, near-miss verdict FUSION
  killed: Survivor[]; // non-D0 BH survivors, near-miss verdict DECORATION
  detectors: CandidateRow[]; // D0 BH survivors — labeled DETECTOR, no deep dive
  gates: { g1: GateG1 };
}

// ─── formatting helpers ──────────────────────────────────────────────────────────

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const ci = (w: WilsonCI) => `[${pct(w.lo)}–${pct(w.hi)}]`;
const sci = (x: number) =>
  x === 0 ? "0" : x < 1e-3 ? x.toExponential(2) : x.toFixed(4);
const n1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : String(x));

function candidateHeader(c: CandidateRow, i: number, totalTests: number): string[] {
  return [
    `### ${i + 1}. ${c.sentence}`,
    ``,
    `- **cell** ${c.cell} · **tier** ${c.tier} · **column** \`${c.column}\` · τ=${c.tau} (thr ${c.thr}) · k=${c.k} · lead ${c.lead}`,
    `- **event windows** fired ${c.a}/${c.nEff} = ${pct(c.eventRate)} ${ci(c.eventWilson)} (${c.distinctYears} distinct years)` +
      ` · **controls** fired ${c.b}/${c.m} = ${pct(c.controlRate)} ${ci(c.controlWilson)}`,
    `- **lift** ${n1(c.lift)} · p=${sci(c.p)} · **q=${sci(c.q)}** (shuffle-calibrated FDR within class \`${c.colClass}\`, sweep of ${totalTests.toLocaleString("en-US")} tests) · BH q=${sci(c.qBH)} (diagnostic) · score ${n1(c.score)}`,
  ];
}

function diveBlock(s: Survivor, maxFireLines: number): string[] {
  const d = s.dive;
  const out: string[] = [];
  out.push(
    `- **false-alarm denominator** (matched-season 1990+ scan, ${d.fa.scanDays.toLocaleString("en-US")} days, base rate ${pct(d.fa.baseRateDay)}):` +
      ` P(fire | event coming) = ${d.fa.pFireGivenEvent.k}/${d.fa.pFireGivenEvent.n} = ${pct(d.fa.pFireGivenEvent.mid)} ${ci(d.fa.pFireGivenEvent)};` +
      ` P(event follows | fire) = ${d.fa.pEventFollowsFire.k}/${d.fa.pEventFollowsFire.n} episodes = ${pct(d.fa.pEventFollowsFire.mid)} ${ci(d.fa.pEventFollowsFire)}` +
      ` (${d.fa.fireDays} fire days; ${d.fa.unlabeledEpisodes} pre-1990 unlabeled episodes shown below, ungraded)`
  );
  out.push(
    `- **near-miss** (${d.nearMiss.band}): fire band ${d.nearMiss.fireBand.followed}/${d.nearMiss.fireBand.fires} vs near band ${d.nearMiss.nearBand.followed}/${d.nearMiss.nearBand.fires} episodes` +
      ` (day counts ${d.nearMiss.fireDayCount} vs ${d.nearMiss.nearDayCount}) → ratio ${n1(d.nearMiss.ratio)}, p=${sci(d.nearMiss.p)} → **${d.nearMiss.verdict}**`
  );
  const cliffCells = d.cliff
    .map((pt) => `${pt.tau.toFixed(2)}:${pt.rate === null || Number.isNaN(pt.rate) ? "–" : pct(pt.rate)}(${pt.followed}/${pt.fires})`)
    .join(" · ");
  out.push(`- **cliff sweep** (τ : follow-rate(followed/fires)): ${cliffCells}`);
  out.push(`- **fire roll call** (${d.fireList.length} episodes):`);
  const shown = d.fireList.slice(0, maxFireLines);
  for (const ep of shown) {
    const span = ep.start === ep.end ? ep.start : `${ep.start} → ${ep.end}`;
    const tail =
      ep.era === "unlabeled"
        ? "· unlabeled era (pre-1990, no anchors to grade against)"
        : ep.followedBy
          ? `· **followed by** ${ep.followedBy}`
          : "· no anchor followed (+2..+30d)";
    out.push(`  - ${span} (${ep.days}d) ${tail}`);
  }
  if (d.fireList.length > shown.length) {
    out.push(`  - …and ${d.fireList.length - shown.length} more (full list in lookout-candidates.json)`);
  }
  return out;
}

// ─── renderer ─────────────────────────────────────────────────────────────────────

export function renderReport(p: MinePayload): string {
  const L: string[] = [];
  const T = p.totalTests;

  L.push(`# LOOKOUT MINE — ${p.params.shuffle ? "SHUFFLE (null) run" : "run report"}`);
  L.push(``);
  L.push(
    `seed ${p.params.seed} · families ${p.params.families.join(", ")} · layout v${p.params.layoutVersion} · ` +
      `${p.params.frameDays.toLocaleString("en-US")} frame-days · ${p.params.rawAnchors} raw → ${p.params.effectiveAnchors} effective anchors · ` +
      `${p.params.eligibleCells} eligible cells · ${p.params.columns} columns`
  );
  L.push(``);

  L.push(`## Coverage honesty (read before believing anything below)`);
  L.push(``);
  for (const line of p.coverage) L.push(`- ${line}`);
  L.push(``);

  L.push(`## Tiers and base rates (the number that made the ALL grain unreachable)`);
  L.push(``);
  for (const t of p.params.tiers) L.push(`- ${t}`);
  L.push(``);
  L.push(
    `Base rate = P(a same-tier-or-worse same-family anchor begins +2..+30d | random matched-season 1990+ day). ` +
      `The near-miss FUSION bar needs the fire band to at least DOUBLE max(near-band rate, base rate) — a base above 0.5 is unreachable by definition.`
  );
  L.push(``);
  L.push(`| cell | tier | n_eff | base rate | scan days |`);
  L.push(`|------|------|-------|-----------|-----------|`);
  for (const r of p.cellBaseRates) {
    L.push(`| ${r.cell} | ${r.tier} | ${r.nEff} | ${pct(r.baseRateDay)} | ${r.scanDays.toLocaleString("en-US")} |`);
  }
  L.push(``);
  const untestedTiers = p.tierCells.filter((c) => !c.eligible);
  if (untestedTiers.length > 0) {
    L.push(
      `Untested tier cells (failed floors n_eff≥20 / ≥10 years — computed, not swept): ` +
        untestedTiers.map((c) => `${c.family}/${c.region}@${c.tier} (n=${c.nEff}, y=${c.distinctYears})`).join(" · ")
    );
    L.push(``);
  }

  L.push(`## Detrend (v1.1 — the secular-trend confound removed at the source)`);
  L.push(``);
  L.push(
    `Every slot's per-year mean pct was fit with a Theil–Sen robust trend and the trend subtracted from every day ` +
      `(re-centered, clamped; see coverage note). The 10 steepest slopes removed — the confound's face:`
  );
  L.push(``);
  L.push(`| slope (pct/decade) | slot | year-means fit |`);
  L.push(`|--------------------|------|----------------|`);
  for (const t of p.trendDiagnostics.slice(0, 10)) {
    L.push(`| ${t.slopePerDecade >= 0 ? "+" : ""}${(t.slopePerDecade * 100).toFixed(2)}% | ${t.label} | ${t.years} |`);
  }
  L.push(``);

  L.push(`## The sweep`);
  L.push(``);
  L.push(
    `- **${T.toLocaleString("en-US")} tests**, ONE family. BH at q=${p.params.bhQ} (threshold p ≤ ${sci(p.bhThresholdP)}) would pass ` +
      `**${p.bhSurvivors}** — but window-level Fisher is anti-conservative here (slow columns make same-year windows perfectly correlated; ` +
      `the year-permutation shuffle proved BH admits noise wholesale). The SHIPPING q is a **class-stratified, shuffle-calibrated empirical FDR**: ` +
      `${p.calibration.nullSweeps} seeded year-permuted null sweeps; each candidate is judged against its OWN column class's null pool ` +
      `(classes fixed a priori by data resolution — pooling had forced daily columns to clear the monthly needles' regime-noise bar). ` +
      `A candidate survives iff its class's nulls say its p-level carries ≤${p.params.bhQ} expected false fraction.`
  );
  L.push(``);
  L.push(`Per-class calibration bars (part of the mine's honesty — the p-level each class must clear):`);
  L.push(``);
  L.push(`| class | real tests | null tests | null min p | calibration bar (survive iff p ≤) | survivors |`);
  L.push(`|-------|-----------|-----------|------------|------------------------------------|-----------|`);
  for (const c of p.calibration.classes) {
    L.push(
      `| ${c.cls} | ${c.tests.toLocaleString("en-US")} | ${c.nullTests.toLocaleString("en-US")} | ${sci(c.nullMinP)} | ` +
        `${c.barP === null ? "— (nothing clears)" : sci(c.barP)} | ${c.survivors} |`
    );
  }
  L.push(``);
  L.push(
    `Audit trail (design iteration receipts, seed 42, 2026-07-12): with UNIFORM control years the daily class's null pool bottomed at ` +
      `p = 7.27e-48 and its calibration bar sat at p ≤ 1.23e-23 — secular-trend monsters (tide-residual percentiles climbing with sea-level ` +
      `rise across the 1950–2026 pools × anchor density growing toward recent years; the tell was harbor tide gauges "predicting" heat waves at ` +
      `p ≈ 2e-49). Epoch-matched controls were then applied (this run) — and the honest receipt is that they DID NOT collapse the bar ` +
      `(daily: 1.23e-23 → 1.36e-23; daily null min 7.27e-48 → 5.44e-48). The achieved mean |year gap| above (~14y, not ~4y) says why: for ` +
      `dense national families the any-tier ±45d exclusion blocks virtually every nearby year, so the nearest CLEAN control years sit decades ` +
      `away and the trend contrast survived epoch matching (daily survivor list was 73/78 tide gauges, trend-suspect). ` +
      `v1.1 DETREND (this run) then removed the LINEAR trend at the source — Theil–Sen per slot, see the Detrend section — with the daily bar at ` +
      `1.36e-23 (null min 5.44e-48) going in. THE RECEIPT (seed 42): the bar did NOT collapse — it deepened (daily bar → 1.80e-26, daily null ` +
      `min → 3.80e-58). A linear detrend removes the linear component; the permutation nulls show the remaining confound is NONLINEAR/decadal ` +
      `structure (trend acceleration, regime steps, datum shifts) that year-permutation still converts into fake association at scale. Per the ` +
      `v1.1 ruling this is where the machinery STOPS: the calibrated survivor list below must be read as structure-suspect, every survivor is ` +
      `DECORATION by the near-miss law, none is claims-eligible, and the honest conclusion is that this archive's slow columns cannot currently ` +
      `be separated from their own decadal structure by this design.`
  );
  L.push(``);
  L.push(
    `- Grid: τ ∈ {${p.params.tauPcts.join(", ")}} (bytes ≥ ${p.params.tauBytes.join("/")}), depth-counts ∈ {${p.params.depthTaus.join(", ")}}, ` +
      `k ∈ {${p.params.kGrid.join(", ")}}, leads {${p.params.leads.join(", ")}}. D0 rows are DETECTORS, never lookouts.`
  );
  L.push(
    `- Controls: up to ${p.params.controlsPerAnchor}/anchor, same month-day in the NEAREST eligible years to the anchor's year ` +
      `(epoch-matched case-control, |controlYear − anchorYear| minimized within ${p.params.controlYears[0]}–${p.params.controlYears[1]}, seeded tie-break), ` +
      `no same-family anchor of ANY tier (scoped) within ±${p.params.controlExclusionDays}d. Achieved epoch tightness — mean |year gap|: ` +
      p.controlYearGaps.map((g) => `${g.tier} ${g.meanGap.toFixed(2)}y (${g.controls.toLocaleString("en-US")} controls)`).join(" · ") +
      `. Null guard: <${p.params.nullGuardMinReadable}/31 readable days drops a window; ` +
      `floors n_eff≥${p.params.floorNEff}, ≥${p.params.floorYears} years re-checked per cell×column (${p.untestedPairs} pairs untested).`
  );
  L.push(
    `- **Calibrated survivors: ${p.survivorsTotal}** → ${p.lookouts.length} LOOKOUTS (FUSION) · ${p.detectors.length} DETECTORS (D0) · ${p.killed.length} KILLED (DECORATION).`
  );
  L.push(``);

  L.push(`## LOOKOUTS (FUSION — near-miss cliff confirmed)`);
  L.push(``);
  if (p.lookouts.length === 0) L.push(`*(none)*`);
  p.lookouts.forEach((s, i) => {
    L.push(...candidateHeader(s, i, T));
    L.push(...diveBlock(s, 30));
    L.push(``);
  });
  L.push(``);

  L.push(`## DETECTORS (D0 — the outcome lives in the slots on D0; not lookouts)`);
  L.push(``);
  if (p.detectors.length === 0) L.push(`*(none)*`);
  else {
    L.push(`| # | sentence | cell | tier | τ/k | fired | controls | lift | q (of ${T.toLocaleString("en-US")}) |`);
    L.push(`|---|----------|------|------|-----|-------|----------|------|---|`);
    p.detectors.forEach((c, i) => {
      L.push(
        `| ${i + 1} | ${c.sentence} | ${c.cell} | ${c.tier} | ${c.tau}/${c.k} | ${c.a}/${c.nEff} = ${pct(c.eventRate)} ${ci(c.eventWilson)} | ${c.b}/${c.m} = ${pct(c.controlRate)} | ${n1(c.lift)} | ${sci(c.q)} |`
      );
    });
  }
  L.push(``);

  L.push(`## KILLED (BH survivors whose near-miss boundary is a slope, not a cliff — kept visible; a report with only hits is a liar)`);
  L.push(``);
  if (p.killed.length === 0) L.push(`*(none)*`);
  p.killed.forEach((s, i) => {
    L.push(...candidateHeader(s, i, T));
    L.push(...diveBlock(s, 10));
    L.push(``);
  });
  L.push(``);

  L.push(`## Gates`);
  L.push(``);
  if (p.gates.g1.ran) {
    L.push(`### G1 — AO rediscovery: ${p.gates.g1.pass ? "PASS" : "FAIL"}`);
    for (const d of p.gates.g1.detail) L.push(`- ${d}`);
  } else {
    L.push(`### G1 — not run in this mode (${p.params.shuffle ? "shuffle" : "family filter excludes winter"})`);
  }
  L.push(``);

  return L.join("\n");
}
