/**
 * warm-series-cache.ts — pull the card's metrics out of the archive into the warm
 * series cache. READS ONLY. Writes nothing but local files under `.frame-cache`.
 *
 * The frequency card counted one field, `avg_high_f`, while `hunt_knowledge`'s
 * `ghcn-daily` rows have carried six more for all 50 states since 1950:
 * `avg_low_f, min_temp_f, avg_precip_in, max_precip_in, snowfall_in, snow_depth_in`.
 * A duck hunter's two other real questions — *how often has it rained this much
 * here in mid-October* and *how often has it been this cold overnight* — are
 * already answerable. This script makes them reachable, with no new ingest.
 *
 * ── READ SHAPE, and why it is safe ────────────────────────────────────────────
 * 50 instruments × 77 calendar years, one bounded request per (state, year),
 * `effective_date` gte/lte only (btree), ≤1000 rows per page, no `order=` at all.
 * That is the same discipline `backfill-frames.ts` has always used and the reason
 * it does not hit the 57014 statement timeout on a 7.6M-row table. ~3,850
 * requests, ~1.4M rows, measured at ~0.21 s each.
 *
 * ── IT CANNOT CLOBBER ─────────────────────────────────────────────────────────
 * `archive.ts` merges: `avg_high_f` is already cached at full coverage, is not in
 * the fetch list, and is carried through byte-for-byte with its own coverage year.
 * The reverse is also now true — a later board re-bake that fetches only
 * `avg_high_f` can no longer wipe these columns, which is the failure this merge
 * rule was written for.
 *
 * Usage:
 *   npx tsx scripts/frames/warm-series-cache.ts --plan       # offline: what it would fetch
 *   npx tsx scripts/frames/warm-series-cache.ts              # THE WARM (reads, local writes)
 *   npx tsx scripts/frames/warm-series-cache.ts --only MD    # one state
 *   npx tsx scripts/frames/warm-series-cache.ts --measure    # offline: the distribution report
 *
 * Keys: SUPABASE_SERVICE_ROLE_KEY (env or Supabase CLI).
 */

import { CARD_METRIC_BY_ID, MISSING, SCALES, sanitizeSeries } from "../board/frequency.ts";
import { bootstrapKeys, coverageOf, loadSeries, readSeriesCache, type DedupSide } from "./archive.ts";
import { buildSeriesCatalog, fieldsByInstrument, sourceOf } from "./seriesCatalog.ts";

const END_YEAR = Number(process.env.WARM_END_YEAR ?? new Date().toISOString().slice(0, 4));

/**
 * Measured, examined, and NOT shipped — but still warmed, so the measurement that
 * rejected it stays reproducible by anyone who doubts the call. `snow_depth_in` is
 * the seventh `ghcn-daily` field; see the note under `CARD_METRICS` for the four
 * reasons it carries no card. It is warmed and never baked: it appears in
 * `--measure`, never in `buildSeriesCatalog()`.
 */
const MEASURED_NOT_SHIPPED = ["snow_depth_in"];

function targets(only?: string) {
  const { jobs, instruments } = buildSeriesCatalog();
  const byInst = fieldsByInstrument(jobs);
  const out: { instId: string; fields: string[]; dedup: Record<string, DedupSide> }[] = [];
  for (const [instId, list] of byInst) {
    const inst = instruments.get(instId)!;
    if (inst.source_ct !== "ghcn-daily") continue; // the card's metrics are state-day fields
    if (only && instId !== `ghcn-${only.toLowerCase()}`) continue;
    const dedup: Record<string, DedupSide> = {};
    for (const j of list) dedup[j.metric] = j.dedup;
    for (const f of MEASURED_NOT_SHIPPED) dedup[f] = "high";
    out.push({ instId, fields: [...list.map((j) => j.metric), ...MEASURED_NOT_SHIPPED], dedup });
  }
  if (only && out.length === 0) { console.error(`  ✗ --only ${only}: no such state instrument.`); process.exit(1); }
  return { out, instruments };
}

async function runWarm(only?: string, plan = false) {
  const { out, instruments } = targets(only);
  let short = 0, complete = 0;
  const shortList: { instId: string; fields: string[] }[] = [];
  for (const t of out) {
    const cached = readSeriesCache(t.instId);
    const missing = t.fields.filter((f) => !cached || coverageOf(cached, f) < END_YEAR);
    if (missing.length) { short++; shortList.push({ instId: t.instId, fields: missing }); }
    else complete++;
  }

  console.log(`=== WARM SERIES CACHE === ${out.length} state instrument(s), ${CARD_METRIC_BY_ID ? Object.keys(CARD_METRIC_BY_ID).length : 0} card metrics, through ${END_YEAR}`);
  console.log(`  ${complete} already covered · ${short} short`);
  if (short) {
    const reqs = shortList.length * (END_YEAR - 1950 + 1);
    console.log(`  would issue ~${reqs} bounded (state, year) reads · effective_date-bounded, no order=, ≤1000/page`);
    console.log(`  first short: ${shortList[0].instId} missing ${shortList[0].fields.join(", ")}`);
  }
  if (plan) { console.log(`\n=== PLAN ONLY — no connection opened, nothing written ===`); return; }
  if (!short) { console.log(`\n=== NOTHING TO DO — every requested field is covered through ${END_YEAR} ===`); return; }

  bootstrapKeys();
  const t0 = Date.now();
  let done = 0;
  for (const t of out) {
    const series = await loadSeries(sourceOf(instruments.get(t.instId)!), END_YEAR, {
      fields: t.fields,
      dedup: t.dedup,
    });
    done++;
    const sizes = t.fields.map((f) => `${f}=${series.get(f)?.size ?? 0}`).join(" ");
    console.log(`  ✓ [${String(done).padStart(2)}/${out.length}] ${t.instId.padEnd(10)} ${sizes}`);
  }
  console.log(`\n=== DONE — ${done} instrument(s) in ${((Date.now() - t0) / 1000).toFixed(1)}s. Cache only; no table was written. ===`);
}

/* ─────────────────── the measurement that decides what ships ─────────────────── */

/**
 * Zero fraction, per metric per state — run BEFORE anything is wired.
 *
 * A "coldest 1%" band is a real tail. A "driest 1%" band is not: on a series where
 * half the days are exactly 0.00 in, a percentile rank inside that half is decided
 * by the sort's tiebreak, not by the weather. This measures the mass so the wiring
 * decision is made from the distribution rather than from taste — and it prints
 * the scale each metric needs, because `encodeSeriesColumn` throws rather than
 * rounds and a metric that will not fit int16 must be found here, not in the bake.
 */
function runMeasure() {
  const { out } = targets();
  const metrics = [...new Set(out.flatMap((t) => t.fields))];
  console.log(`=== ZERO FRACTION + SCALE, per metric per state — offline, from the warm cache ===\n`);

  type Agg = { n: number; zeros: number; min: number; max: number; scale: number | null; states: number; worstState: string; worstZero: number; bestZero: number; bestState: string };
  const agg = new Map<string, Agg>();
  const perState: Record<string, Record<string, number>> = {};
  const dropCount: Record<string, number> = {};

  for (const t of out) {
    const cached = readSeriesCache(t.instId);
    if (!cached) continue;
    const abbr = t.instId.slice(5).toUpperCase();
    perState[abbr] = {};
    for (const f of metrics) {
      const obj = cached.fields[f];
      if (!obj) continue;
      // Measure what the BAKE will see: the sentinels are dropped first. Measuring
      // the raw series would have reported a scale that the encoder then refuses.
      const { clean, dropped } = sanitizeSeries(f, new Map(Object.entries(obj)));
      const vals = [...clean.values()];
      dropCount[f] = (dropCount[f] ?? 0) + dropped.length;
      if (!vals.length) continue;
      let zeros = 0, min = Infinity, max = -Infinity;
      for (const v of vals) { if (v === 0) zeros++; if (v < min) min = v; if (v > max) max = v; }
      const frac = zeros / vals.length;
      perState[abbr][f] = frac;
      const a = agg.get(f) ?? { n: 0, zeros: 0, min: Infinity, max: -Infinity, scale: null, states: 0, worstState: "", worstZero: -1, bestZero: 2, bestState: "" };
      a.n += vals.length; a.zeros += zeros; a.states++;
      if (min < a.min) a.min = min;
      if (max > a.max) a.max = max;
      if (frac > a.worstZero) { a.worstZero = frac; a.worstState = abbr; }
      if (frac < a.bestZero) { a.bestZero = frac; a.bestState = abbr; }
      const s = pickScaleOrNull(vals);
      a.scale = a.scale === null ? s : (s === null ? null : Math.max(a.scale, s));
      agg.set(f, a);
    }
  }

  console.log(`  metric           states   readings   zero%   min      max      scale  dropped  verdict`);
  for (const f of metrics) {
    const a = agg.get(f);
    if (!a) { console.log(`  ${f.padEnd(16)} — absent from the cache`); continue; }
    const pct = (100 * a.zeros / a.n).toFixed(1);
    const cm = CARD_METRIC_BY_ID[f];
    const verdict = MEASURED_NOT_SHIPPED.includes(f)
      ? (a.scale === null ? "NOT SHIPPED — no exact int16 scale" : "NOT SHIPPED")
      : a.scale === null ? "NO EXACT int16 SCALE" : `${cm?.side ?? "?"} tail — SHIPPED`;
    console.log(`  ${f.padEnd(16)} ${String(a.states).padStart(4)} ${String(a.n).padStart(10)}  ${pct.padStart(6)}  ${String(a.min).padStart(7)}  ${String(a.max).padStart(7)}  ${String(a.scale ?? "—").padStart(5)}  ${String(dropCount[f] ?? 0).padStart(7)}  ${verdict}`);
    console.log(`  ${"".padEnd(16)} zero-fraction spread: ${a.bestState} ${(100 * a.bestZero).toFixed(1)}% … ${a.worstState} ${(100 * a.worstZero).toFixed(1)}%`);
  }

  console.log(`\n  ── per-state zero fraction, the metrics where it decides the product ──`);
  const show = metrics.filter((f) => CARD_METRIC_BY_ID[f]?.zeroInflated || MEASURED_NOT_SHIPPED.includes(f));
  const abbrs = Object.keys(perState).sort();
  console.log(`  state  ${show.map((f) => f.padStart(14)).join("")}`);
  for (const abbr of abbrs) {
    const cells = show.map((f) => (perState[abbr][f] === undefined ? "—" : (100 * perState[abbr][f]).toFixed(1) + "%").padStart(14)).join("");
    console.log(`  ${abbr.padEnd(6)} ${cells}`);
  }
}

function pickScaleOrNull(values: number[]): number | null {
  for (const scale of SCALES) {
    let ok = true;
    for (const v of values) {
      const scaled = v * scale;
      const r = Math.round(scaled);
      if (Math.abs(scaled - r) > 1e-9 || r > 32767 || r <= MISSING) { ok = false; break; }
    }
    if (ok) return scale;
  }
  return null;
}

async function main() {
  const argv = process.argv.slice(2);
  const onlyIdx = argv.indexOf("--only");
  const only = onlyIdx === -1 ? undefined : argv[onlyIdx + 1];
  if (argv.includes("--measure")) return runMeasure();
  return runWarm(only, argv.includes("--plan"));
}
main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
