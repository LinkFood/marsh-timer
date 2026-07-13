/**
 * stats.ts — the statistics kernel for the Lookout Mine.
 *
 * PURE functions only. No network, no filesystem, no clock, no globals.
 * Every function here exists to keep the mine honest: the 2,304-formula
 * convergence sweep proved that without hard statistical guardrails the
 * archive will happily hand you astrology. These are the guardrails.
 *
 * Doctrine (docs/THE-WEEK.md, PARK LIST):
 *  - THE LOOKOUT MINE: outcome-first retrodiction. Every candidate lookout is
 *    an event-window fire rate vs a matched-control fire rate. Fisher decides
 *    whether "crushes" is real; Wilson keeps the false-alarm denominator
 *    honest; BH across the WHOLE sweep keeps the trap from catching noise.
 *  - THE NEAR-MISS LAW: a lookout is graded against its k-1 near-miss band.
 *    Outcome-rate cliff at the boundary = real fusion. No cliff = the
 *    condition was decoration — kill it, never claims-eligible.
 */

// ---------------------------------------------------------------------------
// log-gamma (Lanczos, g=7, n=9) — JS has no Math.lgamma. Accurate to ~15
// significant digits, which is what makes Fisher stable at n ~ 50,000:
// factorials up there overflow double floats by thousands of orders of
// magnitude, so everything stays in log space until the final exp.
// ---------------------------------------------------------------------------

const LANCZOS_G = 7;
const LANCZOS_C = [
  0.99999999999980993,
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7,
];

/** Natural log of the gamma function, Γ(x), for x > 0. */
function lgamma(x: number): number {
  if (x < 0.5) {
    // Reflection formula: Γ(x)Γ(1−x) = π / sin(πx)
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  }
  x -= 1;
  let a = LANCZOS_C[0];
  const t = x + LANCZOS_G + 0.5;
  for (let i = 1; i < LANCZOS_C.length; i++) a += LANCZOS_C[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** log of the binomial coefficient C(n, k), in log space for stability. */
function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
}

function assertCount(x: number, name: string): void {
  if (!Number.isInteger(x) || x < 0) {
    throw new Error(`${name} must be a non-negative integer, got ${x}`);
  }
}

// ---------------------------------------------------------------------------
// 1. Fisher's exact test (one-sided)
// ---------------------------------------------------------------------------

/**
 * One-sided Fisher's exact p-value (hypergeometric upper tail) for a 2×2
 * table, testing whether the EVENT group fired MORE than control:
 *
 *                 fired    did-not-fire
 *   event window    a          b        (n_eff = a + b)
 *   control window  c          d        (m     = c + d)
 *
 * p = P(X ≥ a) under the null hypergeometric with all margins fixed.
 *
 * Honesty rationale: this is the mine's core "crushes its control rate"
 * arbiter. It is EXACT — no normal approximation — because lookout counts are
 * often tiny (19 AO months in 68 years) and asymptotic tests lie in the tails,
 * which is exactly where the mine lives. One-sided by design: the mine only
 * registers lookouts that fire MORE before outcomes; a deficit is a different
 * (unregistered) hypothesis and gets no free half of the alpha.
 *
 * Numerically stable to n ≈ 50,000+ via log-gamma factorials; the tail is
 * summed term-by-term in linear space after exponentiating each log
 * probability (each term is ≤ 1, so no overflow; underflow of negligible
 * terms is harmless).
 */
export function fisherExactOneSided(a: number, b: number, c: number, d: number): number {
  assertCount(a, "a");
  assertCount(b, "b");
  assertCount(c, "c");
  assertCount(d, "d");

  const row1 = a + b; // event windows
  const row2 = c + d; // control windows
  const col1 = a + c; // total fires
  const N = row1 + row2;
  if (N === 0 || col1 === 0 || row1 === 0) return 1; // no data / no fires: nothing to reject

  const logDenom = logChoose(N, col1);
  const kMax = Math.min(row1, col1);
  let p = 0;
  for (let k = a; k <= kMax; k++) {
    if (col1 - k > row2) continue; // impossible configuration
    const logP = logChoose(row1, k) + logChoose(row2, col1 - k) - logDenom;
    p += Math.exp(logP);
  }
  return Math.min(p, 1); // guard tiny FP excess above 1
}

// ---------------------------------------------------------------------------
// 2. Wilson score interval
// ---------------------------------------------------------------------------

/**
 * Wilson score interval for a binomial rate k/n at z (default 1.96 ≈ 95%).
 *
 * Honesty rationale: every lookout carries its false-alarm denominator, and
 * that denominator is usually small. The naive Wald interval collapses to
 * zero width at k=0 or k=n and escapes [0,1] — i.e. it lets a lookout that
 * has never false-alarmed claim certainty. Wilson stays inside [0,1], never
 * has zero width for n > 0, and is the interval the product copy must quote.
 *
 * `mid` is the Wilson midpoint (the shrunk estimate), not k/n — quoting the
 * shrunk rate is deliberate: it pulls small-sample rates toward 1/2 instead
 * of letting 3-for-3 read as 100%.
 *
 * n = 0 returns the maximally ignorant {lo: 0, hi: 1, mid: 0.5}.
 */
export function wilsonInterval(
  k: number,
  n: number,
  z = 1.96
): { lo: number; hi: number; mid: number } {
  assertCount(k, "k");
  assertCount(n, "n");
  if (k > n) throw new Error(`k (${k}) cannot exceed n (${n})`);
  if (n === 0) return { lo: 0, hi: 1, mid: 0.5 };

  const z2 = z * z;
  const denom = n + z2;
  const mid = (k + z2 / 2) / denom;
  const half = (z / denom) * Math.sqrt((k * (n - k)) / n + z2 / 4);
  return {
    lo: Math.max(0, mid - half),
    hi: Math.min(1, mid + half),
    mid,
  };
}

// ---------------------------------------------------------------------------
// 3. Benjamini–Hochberg FDR
// ---------------------------------------------------------------------------

/**
 * Benjamini–Hochberg false-discovery-rate control at level q over a vector of
 * p-values. Returns the rejection threshold (largest p(i) with
 * p(i) ≤ (i/n)·q on the sorted vector; 0 if none) and, in the ORIGINAL input
 * order, which tests are rejected (p ≤ threshold).
 *
 * Honesty rationale — THE ONE-FAMILY LAW: the caller MUST pass every test in
 * the entire sweep (every lane × threshold × window combination) as ONE
 * family. Per-family BH — correcting each lane or each outcome class
 * separately — is FORBIDDEN. That is exactly how the 2,304-formula astrology
 * was born: each little family looked fine at q=0.05, and the union was a
 * zodiac. The mine runs one sweep, one family, one correction. If you are
 * calling this function more than once per sweep, you are cheating.
 */
export function benjaminiHochberg(
  pvals: number[],
  q = 0.05
): { threshold: number; rejected: boolean[] } {
  const n = pvals.length;
  if (n === 0) return { threshold: 0, rejected: [] };
  for (const p of pvals) {
    if (!(p >= 0 && p <= 1)) throw new Error(`p-value out of [0,1]: ${p}`);
  }

  const sorted = [...pvals].sort((x, y) => x - y);
  let threshold = 0;
  for (let i = n - 1; i >= 0; i--) {
    if (sorted[i] <= ((i + 1) / n) * q) {
      threshold = sorted[i];
      break;
    }
  }
  return { threshold, rejected: pvals.map((p) => p <= threshold && threshold > 0) };
}

// ---------------------------------------------------------------------------
// 4. Lift with the finite floor
// ---------------------------------------------------------------------------

/**
 * Lift of the event-window fire rate over the control fire rate:
 *   (a / nEff) / max(b / m, 1 / (2m))
 *
 * Honesty rationale: this is the court's grade_version 2 finite-lift
 * convention. A control window with ZERO fires must not produce an infinite
 * lift — infinity is not evidence, it is a small denominator. The floor
 * 1/(2m) is the standard "half a count" continuity convention: the most a
 * zero-fire control of size m can honestly certify is "less than about one
 * fire in 2m windows". Lift stays finite, comparable, and rankable across
 * lookouts with different control sizes.
 */
export function lift(a: number, nEff: number, b: number, m: number): number {
  assertCount(a, "a");
  assertCount(b, "b");
  if (nEff <= 0 || m <= 0) throw new Error(`nEff and m must be positive (got ${nEff}, ${m})`);
  const eventRate = a / nEff;
  const controlRate = Math.max(b / m, 1 / (2 * m));
  return eventRate / controlRate;
}

// ---------------------------------------------------------------------------
// 5. Cliff sweep
// ---------------------------------------------------------------------------

/**
 * Sweep the threshold τ in 0.01 steps over [τ* − 0.08, τ* + 0.04] and return
 * the outcome-follow rate curve: at each τ, how often did a fire at that
 * threshold have the outcome actually follow.
 *
 * Honesty rationale — NEAR-MISS LAW clause (a): near-misses set trap
 * thresholds EMPIRICALLY. The grid value τ* is where we guessed the cliff
 * sits; this curve shows where it ACTUALLY sits. The band is asymmetric
 * (8 steps below, 4 above) because the discovery zone is below the trigger —
 * the just-missed tell more. The mine reports the whole curve, never just the
 * grid point, so a lookout whose "cliff" is really a smooth slope is visible
 * as decoration before it ever reaches product copy.
 *
 * `rate` is followed/fires; NaN when a threshold produced zero fires (no
 * evidence is not the same as a 0% rate — do not silently coerce it).
 * `fires` and `followed` ride along so the reader always sees the
 * denominator.
 *
 * `fireRateAt` must itself be pure/deterministic for the sweep to be
 * reproducible.
 */
export function cliffSweep(
  fireRateAt: (tau: number) => { fires: number; followed: number },
  tauStar: number
): { tau: number; rate: number; fires: number; followed: number }[] {
  if (!Number.isFinite(tauStar)) throw new Error(`tauStar must be finite, got ${tauStar}`);
  const curve: { tau: number; rate: number; fires: number; followed: number }[] = [];
  for (let k = -8; k <= 4; k++) {
    const tau = tauStar + k / 100;
    const { fires, followed } = fireRateAt(tau);
    curve.push({ tau, rate: fires > 0 ? followed / fires : NaN, fires, followed });
  }
  return curve;
}

// ---------------------------------------------------------------------------
// 6. The near-miss verdict
// ---------------------------------------------------------------------------

/**
 * THE NEAR-MISS LAW, executable form. Grades a lookout's fire band against
 * its k-1 near-miss band (the windows that JUST missed the trigger):
 *
 *   fireRate = fireBand.followed / fireBand.fires
 *   nearRate = nearMissBand.followed / nearMissBand.fires,
 *              floored at max(baseRate, 1/(2·nearMissBand.fires))
 *   ratio    = fireRate / nearRate
 *   p        = one-sided Fisher on [followed, not-followed] fire vs near-miss
 *
 *   verdict  = FUSION      iff ratio ≥ 2 AND p < 0.05
 *              DECORATION  otherwise (killed, never claims-eligible)
 *
 * THE RULE, JUSTIFIED:
 *  - ratio ≥ 2 is the effect-size gate. The doctrine says the pre-event rate
 *    must CRUSH its control; a boundary that fails to at least DOUBLE the
 *    outcome rate is a slope, not a cliff, no matter how significant a huge
 *    n makes it. Statistically-detectable-but-tiny is decoration by decree.
 *  - p < 0.05 (one-sided Fisher) is the evidence gate. It stops a "doubling"
 *    built on 2 fires from passing on luck. It is RAW 0.05, not BH-corrected,
 *    deliberately: this is a single confirmatory test of one already-mined,
 *    already-BH-survived lookout at its own boundary — not a member of the
 *    discovery sweep. The sweep-wide correction happened upstream in
 *    benjaminiHochberg; correcting twice would double-count the protection
 *    and let genuinely cliff-shaped lookouts die to bookkeeping.
 *  - BOTH gates must pass. Either alone is a known failure mode: ratio alone
 *    = small-sample flukes; p alone = big-n trivia.
 *
 * Denominator floors (both push AGAINST fusion — conservative by design):
 *  - The near-miss rate is floored at baseRate: the sideband can never be
 *    credited an outcome rate below the archive base rate, otherwise a
 *    quiet-by-chance sideband inflates the cliff.
 *  - It is also floored at 1/(2·fires) (the same half-count convention as
 *    lift), so a zero-followed sideband cannot yield an infinite ratio.
 *
 * Degenerate evidence: zero fires in the fire band → DECORATION (ratio 0,
 * p 1). A lookout that never fired has no cliff to show.
 */
export function nearMissVerdict(
  fireBand: { fires: number; followed: number },
  nearMissBand: { fires: number; followed: number },
  baseRate: number
): { ratio: number; p: number; verdict: "FUSION" | "DECORATION" } {
  assertCount(fireBand.fires, "fireBand.fires");
  assertCount(fireBand.followed, "fireBand.followed");
  assertCount(nearMissBand.fires, "nearMissBand.fires");
  assertCount(nearMissBand.followed, "nearMissBand.followed");
  if (!(baseRate >= 0 && baseRate <= 1)) throw new Error(`baseRate out of [0,1]: ${baseRate}`);
  if (fireBand.followed > fireBand.fires || nearMissBand.followed > nearMissBand.fires) {
    throw new Error("followed cannot exceed fires");
  }

  if (fireBand.fires === 0) return { ratio: 0, p: 1, verdict: "DECORATION" };

  const fireRate = fireBand.followed / fireBand.fires;
  const nearFires = nearMissBand.fires;
  const rawNearRate = nearFires > 0 ? nearMissBand.followed / nearFires : 0;
  const floor = Math.max(baseRate, nearFires > 0 ? 1 / (2 * nearFires) : baseRate);
  // If both the sideband and baseRate are degenerate (0), fall back to the
  // fire band's own half-count floor so ratio stays finite.
  const nearRate = Math.max(rawNearRate, floor, 1 / (2 * (nearFires > 0 ? nearFires : fireBand.fires)));

  const ratio = fireRate / nearRate;
  const p = fisherExactOneSided(
    fireBand.followed,
    fireBand.fires - fireBand.followed,
    nearMissBand.followed,
    nearMissBand.fires - nearMissBand.followed
  );

  const verdict: "FUSION" | "DECORATION" = ratio >= 2 && p < 0.05 ? "FUSION" : "DECORATION";
  return { ratio, p, verdict };
}

// ---------------------------------------------------------------------------
// 7. Theil–Sen robust linear trend
// ---------------------------------------------------------------------------

/**
 * Theil–Sen estimator: slope = median of all pairwise slopes
 * (y_j − y_i)/(x_j − x_i) over pairs with x_j ≠ x_i; intercept =
 * median(y_i − slope·x_i).
 *
 * Honesty rationale — THE DETREND LAW (v1.1): the secular-trend confound lives
 * in the slot values themselves (tide-residual percentiles climb with sea-level
 * rise across the 1950–2026 pools), and the correction must not let a few
 * extreme years set the slope the way OLS would — one Katrina year would tilt
 * the whole gauge. Median-of-slopes has a ~29% breakdown point and is exact on
 * clean linear data.
 *
 * Degenerate inputs: n = 0 → {0, 0}; fewer than 2 distinct x values → slope 0,
 * intercept = median(y) (no trend estimable, series left as-is up to centering).
 */
export function theilSen(xs: number[], ys: number[]): { slope: number; intercept: number } {
  if (xs.length !== ys.length) {
    throw new Error(`theilSen: xs (${xs.length}) and ys (${ys.length}) must be the same length`);
  }
  const n = xs.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  const median = (arr: number[]): number => {
    const s = [...arr].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const slopes: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (xs[j] !== xs[i]) slopes.push((ys[j] - ys[i]) / (xs[j] - xs[i]));
    }
  }
  if (slopes.length === 0) return { slope: 0, intercept: median(ys) };
  const slope = median(slopes);
  const intercept = median(ys.map((y, i) => y - slope * xs[i]));
  return { slope, intercept };
}

// ---------------------------------------------------------------------------
// 8. Seeded PRNG
// ---------------------------------------------------------------------------

/**
 * Deterministic PRNG (mulberry32). Returns a function producing floats in
 * [0, 1). Same seed → the same sequence, forever, on every machine.
 *
 * Honesty rationale: control-window sampling and shuffle tests MUST be
 * replayable. Two runs of the mine with the same seed must be byte-identical
 * downstream, so a claim can be re-derived and audited months later — a
 * result that changes when nobody changed anything is indistinguishable from
 * a bug or a lie. Math.random() is therefore banned inside the mine.
 */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
