/**
 * stats.test.ts — plain-assertion tests for the Lookout Mine stats kernel.
 * Run: npx tsx scripts/mine/stats.test.ts
 * No framework. Exits non-zero on any failure.
 */

import {
  fisherExactOneSided,
  wilsonInterval,
  benjaminiHochberg,
  lift,
  cliffSweep,
  nearMissVerdict,
  seededRng,
} from "./stats";

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

function approx(actual: number, expected: number, tol: number, name: string): void {
  assert(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tol,
    name,
    `expected ${expected} ± ${tol}, got ${actual}`
  );
}

// ---------------------------------------------------------------------------
console.log("fisherExactOneSided");

// 1. Lady tasting tea, all 8 cups correct: [[4,0],[0,4]].
//    p = C(4,4)C(4,0)/C(8,4) = 1/70 ≈ 0.0142857.
approx(fisherExactOneSided(4, 0, 0, 4), 1 / 70, 1e-12, "tea all-correct = 1/70");

// 2. Tea 3-of-4 correct: [[3,1],[1,3]].
//    p = [C(4,3)C(4,1) + C(4,4)C(4,0)] / C(8,4) = (16+1)/70 = 17/70.
approx(fisherExactOneSided(3, 1, 1, 3), 17 / 70, 1e-12, "tea 3/4 = 17/70");

// 3. Wikipedia dieting example, oriented so row 1 fired MORE: [[11,3],[1,9]].
//    Margins: row1=14, row2=10, col1=12, N=24, C(24,12)=2,704,156.
//    Tail k=11: C(14,11)C(10,1)=3640; k=12: C(14,12)C(10,0)=91.
//    p = 3731/2704156 ≈ 0.00137973.
approx(fisherExactOneSided(11, 3, 1, 9), 3731 / 2704156, 1e-12, "[[11,3],[1,9]] = 3731/2704156");

// Null direction: a=0 means the tail is the entire distribution → p = 1.
approx(fisherExactOneSided(0, 10, 5, 5), 1, 1e-9, "a=0 null table → p = 1");

// Big-n stability at n = 50,000: 600/25,000 event vs 500/25,000 control.
// z ≈ 3 → one-sided p ≈ 1e-3. Must be finite, in (0, 0.05), no NaN/underflow.
const bigP = fisherExactOneSided(600, 24400, 500, 24500);
assert(
  Number.isFinite(bigP) && bigP > 0 && bigP < 0.05,
  "n=50,000 table is finite, 0 < p < 0.05",
  `got ${bigP}`
);

// ---------------------------------------------------------------------------
console.log("wilsonInterval");

// Known case: 5/10 at 95% → (0.2366, 0.7634), mid exactly 0.5.
const w = wilsonInterval(5, 10);
approx(w.mid, 0.5, 1e-12, "5/10 mid = 0.5");
approx(w.lo, 0.2366, 5e-4, "5/10 lo ≈ 0.2366");
approx(w.hi, 0.7634, 5e-4, "5/10 hi ≈ 0.7634");

// k = 0 edge: lo pinned to 0, everything in [0,1], nonzero width.
const w0 = wilsonInterval(0, 10);
assert(w0.lo === 0 && w0.hi > 0 && w0.hi < 1 && w0.mid > 0, "k=0 stays in [0,1], lo=0", JSON.stringify(w0));

// k = n edge: hi pinned to 1, everything in [0,1].
const wn = wilsonInterval(10, 10);
assert(wn.hi === 1 && wn.lo > 0 && wn.lo < 1 && wn.mid < 1, "k=n stays in [0,1], hi=1", JSON.stringify(wn));

// ---------------------------------------------------------------------------
console.log("benjaminiHochberg");

// Hand-derivable: n=5, q=0.05 → BH criteria are i/n·q = .01,.02,.03,.04,.05.
// Sorted p = [.01,.02,.03,.04,.2]: p(4)=.04 ≤ .04 is the largest pass →
// threshold .04, first four rejected. Input is UNSORTED to check
// original-order mapping.
const bh = benjaminiHochberg([0.2, 0.01, 0.04, 0.03, 0.02], 0.05);
approx(bh.threshold, 0.04, 1e-12, "threshold = 0.04");
assert(
  JSON.stringify(bh.rejected) === JSON.stringify([false, true, true, true, true]),
  "rejects exactly the four small p's in original order",
  JSON.stringify(bh.rejected)
);

// All-null vector: nothing rejected.
const bhNull = benjaminiHochberg([0.5, 0.6, 0.7, 0.8, 0.9, 0.95], 0.05);
assert(
  bhNull.threshold === 0 && bhNull.rejected.every((r) => !r),
  "all-null vector rejects nothing",
  JSON.stringify(bhNull)
);

// ---------------------------------------------------------------------------
console.log("lift");

// Floor kicks in at b=0: denominator = 1/(2·200) = 0.0025, so
// lift(5,100,0,200) = 0.05 / 0.0025 = 20 (finite, not Infinity).
approx(lift(5, 100, 0, 200), 20, 1e-12, "b=0 floor → lift = 20, not Infinity");

// Ordinary case: (10/100)/(5/100) = 2.
approx(lift(10, 100, 5, 100), 2, 1e-12, "plain lift = 2");

// ---------------------------------------------------------------------------
console.log("cliffSweep");

// Step function: follow-rate jumps from 0.1 to 0.6 exactly at tau ≥ 0.5.
const curve = cliffSweep(
  (tau) => (tau >= 0.5 ? { fires: 100, followed: 60 } : { fires: 100, followed: 10 }),
  0.5
);
assert(curve.length === 13, "13 points over [τ*−0.08, τ*+0.04]", `got ${curve.length}`);
approx(curve[0].tau, 0.42, 1e-9, "first tau = 0.42");
approx(curve[12].tau, 0.54, 1e-9, "last tau = 0.54");
approx(curve[7].rate, 0.1, 1e-12, "rate below the cliff (τ=0.49) = 0.1");
approx(curve[8].rate, 0.6, 1e-12, "rate at the cliff (τ=0.50) = 0.6");
assert(
  curve.every((pt) => pt.fires === 100),
  "denominators ride along on every point"
);

// Zero-fire threshold reports NaN, not a fake 0% rate.
const curve2 = cliffSweep((tau) => (tau > 0.53 ? { fires: 0, followed: 0 } : { fires: 10, followed: 5 }), 0.5);
assert(Number.isNaN(curve2[12].rate), "zero fires → rate is NaN, not 0");

// ---------------------------------------------------------------------------
console.log("nearMissVerdict");

// Clear cliff: fire band follows 20/40 (50%), near-miss band 6/60 (10%),
// base rate 5%. ratio = 0.5/0.1 = 5 ≥ 2; Fisher on [20,20,6,54] is far
// below 0.05 → FUSION.
const cliff = nearMissVerdict({ fires: 40, followed: 20 }, { fires: 60, followed: 6 }, 0.05);
approx(cliff.ratio, 5, 1e-9, "cliff ratio = 5");
assert(cliff.p < 0.05, "cliff p < 0.05", `p=${cliff.p}`);
assert(cliff.verdict === "FUSION", "clear cliff → FUSION", cliff.verdict);

// Flat boundary: both bands follow at 20% → ratio 1, DECORATION.
const flat = nearMissVerdict({ fires: 40, followed: 8 }, { fires: 60, followed: 12 }, 0.05);
approx(flat.ratio, 1, 1e-9, "flat ratio = 1");
assert(flat.verdict === "DECORATION", "no cliff → DECORATION", flat.verdict);

// Zero-followed sideband: floors keep the ratio finite; strong fire band
// still earns FUSION on the evidence.
const zeroSide = nearMissVerdict({ fires: 10, followed: 5 }, { fires: 50, followed: 0 }, 0.02);
assert(Number.isFinite(zeroSide.ratio) && zeroSide.ratio > 2, "zero-followed sideband ratio finite and > 2", `ratio=${zeroSide.ratio}`);
assert(zeroSide.verdict === "FUSION", "5/10 vs 0/50 → FUSION", `p=${zeroSide.p}`);

// Big ratio on tiny evidence must NOT pass: 1/1 fire vs 0/3 near-miss.
// Fisher p = 0.25 → DECORATION despite a huge ratio.
const tiny = nearMissVerdict({ fires: 1, followed: 1 }, { fires: 3, followed: 0 }, 0.05);
assert(tiny.verdict === "DECORATION", "huge ratio on 1 fire → DECORATION (p gate)", `p=${tiny.p}`);

// Never-fired lookout is dead on arrival.
const dead = nearMissVerdict({ fires: 0, followed: 0 }, { fires: 50, followed: 5 }, 0.05);
assert(dead.verdict === "DECORATION" && dead.ratio === 0 && dead.p === 1, "zero fires → DECORATION");

// ---------------------------------------------------------------------------
console.log("seededRng");

const r1 = seededRng(42);
const r2 = seededRng(42);
const r3 = seededRng(43);
const seq1 = [r1(), r1(), r1(), r1(), r1()];
const seq2 = [r2(), r2(), r2(), r2(), r2()];
const seq3 = [r3(), r3(), r3(), r3(), r3()];
assert(JSON.stringify(seq1) === JSON.stringify(seq2), "same seed → identical first 5 draws");
assert(JSON.stringify(seq1) !== JSON.stringify(seq3), "different seed → different draws");
assert(seq1.concat(seq3).every((x) => x >= 0 && x < 1), "all draws in [0,1)");

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
