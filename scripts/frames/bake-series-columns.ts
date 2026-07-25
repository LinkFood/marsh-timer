/**
 * bake-series-columns.ts — fill the transposed column store (plan §3 option c).
 *
 * ONE row per (instrument, metric) holding that series' entire history as a
 * contiguous int16 column, so the frequency card is a single bounded read
 * instead of a scan over the 8.11 MB frame store. See the migration
 * 20260726000000_board_series_columns.sql header for the shape, the encoding,
 * and why this stores VALUES rather than plan §3's packed board byte.
 *
 * SOURCE: the same warm scripts/frames/.frame-cache that backfill-frames.ts
 * writes and bake-luts.ts reads. Read-only — this script writes no cache file
 * and no checkpoint, and it touches no table but board_series_columns.
 *
 * (Plan §3 says "fills it from board_frames". It cannot: board_frames holds the
 * quantized board BYTE and this column holds physical values, which the byte
 * cannot be inverted back to without loss. The cache is the byte's own upstream,
 * so this is the same numbers one step earlier, and it costs no read against the
 * cluster while another pipe holds the write lane.)
 *
 * IDEMPOTENT: every run rewrites all 89 rows through an upsert on the primary
 * key. There is no checkpoint because there is nothing to resume — the whole
 * bake is ~90 rows and a few seconds. Re-running is always safe and always
 * converges to the cache's current contents.
 *
 * NOT COUPLED TO THE BOARD LAYOUT (2026-07-25). The job list comes from
 * scripts/frames/seriesCatalog.ts, which is the registry's board slots UNION the
 * card-only metrics. `board_series_columns` has no `layout_version`, so a card
 * metric is one new primary key and costs no frame re-bake — see that file's header.
 *
 * Usage:
 *   npx tsx scripts/frames/bake-series-columns.ts --verify        # offline: round-trip, pool parity, census, tie floor
 *   npx tsx scripts/frames/bake-series-columns.ts --card MD 10-10 # offline: every metric's real sentence at every band
 *   npx tsx scripts/frames/bake-series-columns.ts --card MD LA ND 10-10 --metric avg_precip_in
 *   npx tsx scripts/frames/bake-series-columns.ts --dry-run       # offline: the rows it would write, sized
 *   npx tsx scripts/frames/bake-series-columns.ts                 # THE BAKE (upserts board_series_columns)
 *   npx tsx scripts/frames/bake-series-columns.ts --only ghcn-md  # one instrument
 *   npx tsx scripts/frames/bake-series-columns.ts --metric snowfall_in   # one metric, all instruments
 *
 * Keys: SUPABASE_SERVICE_ROLE_KEY (env or Supabase CLI). Cache must be warm — see
 * scripts/frames/warm-series-cache.ts for the card metrics.
 */

import { doyOffset } from "../board/tailDepth.ts";
import { epochDay, isoOfEpochDay, mergeEpisodes, refusalReason, DEFAULT_EPISODE_GAP_DAYS } from "../board/episodes.ts";
import {
  CARD_METRICS, CARD_METRIC_BY_ID, DOY_HALF_WINDOW, MISSING, bandCensus, bandPhrase,
  decodeSeriesColumn, encodeSeriesColumn, mmddLabel, poolForDoy, sanitizeSeries, subjectPhrase, toByteaHex,
  windowPhrase, type SeriesColumn, type TailSide,
} from "../board/frequency.ts";
import { SUPABASE_URL, bootstrapKeys, fetchWithRetry, readSeriesCache, supaHeaders } from "./archive.ts";
import { SOURCE_BY_CT, buildSeriesCatalog, type SeriesJob } from "./seriesCatalog.ts";
import { type Instrument } from "./registry.ts";

/** A GHCN row is ~111 KB of hex; 8 rows is a ~900 KB POST. */
const UPSERT_BATCH = 8;
/** The three bands under test. Ruling 1a: the band is set from data, not taste — so it is
 *  an input the card exposes, never a constant hidden in a component. */
const BANDS = [0.01, 0.02, 0.05];

// ─── Cache (READ-ONLY; backfill-frames.ts and warm-series-cache.ts own writes) ──
//
// SANITIZED ON THE WAY IN, once, so every path below — the bake, the dry run, the
// verifier's independent re-derivation, and `--card` — sees the same numbers. Doing
// it later would let `truthPool` and the encoded column disagree about which days
// exist, which is the class of split this codebase has already been burned by.
const dropLog = new Map<string, { iso: string; v: number }[]>();

function loadCachedSeries(instId: string): Map<string, Map<string, number>> {
  const cached = readSeriesCache(instId);
  if (!cached) {
    console.error(`  ✗ cache miss or legacy envelope: series-${instId}.json — run backfill-frames.ts (board metrics) and warm-series-cache.ts (card metrics) first.`);
    process.exit(1);
  }
  const m = new Map<string, Map<string, number>>();
  for (const [f, obj] of Object.entries(cached.fields)) {
    const { clean, dropped } = sanitizeSeries(f, new Map(Object.entries(obj)));
    if (dropped.length) dropLog.set(`${instId}:${f}`, dropped);
    m.set(f, clean);
  }
  return m;
}

/** Every sentinel this run refused to store, named. Silence here would be the bug. */
function reportDrops() {
  if (dropLog.size === 0) return;
  console.log(`\n  physically impossible readings dropped as no-reading (never stored, never zeroed):`);
  for (const [key, list] of dropLog) {
    const shown = list.slice(0, 4).map((d) => `${d.iso}=${d.v}`).join(", ");
    console.log(`    ${key.padEnd(28)} ${list.length} value(s): ${shown}${list.length > 4 ? ", …" : ""}`);
  }
}

// ─── The job list — the CATALOG, not the board layout ───────────────────────────
//
// This used to walk `buildRegistry()`, which tied every column in this store to the
// board's slot manifest. It walks `buildSeriesCatalog()` now: the same registry jobs
// (so every board slot still gets its column, and `--verify` still proves them), plus
// the card-only metrics that are NOT board dots. `board_series_columns` has no
// `layout_version` — see the migration header — so a card metric costs one new
// primary key and nothing else. No layout change, no version bump, no frame re-bake.
function jobs(only?: string, onlyMetric?: string): { list: SeriesJob[]; instruments: Map<string, Instrument> } {
  const { jobs: all, instruments } = buildSeriesCatalog();
  const list = all.filter((j) => (!only || j.instId === only) && (!onlyMetric || j.metric === onlyMetric));
  if (list.length === 0) { console.error(`  ✗ --only ${only ?? "*"} --metric ${onlyMetric ?? "*"}: nothing in the catalog matches.`); process.exit(1); }
  return { list, instruments };
}

function buildRow(job: SeriesJob, series: Map<string, number>) {
  const enc = encodeSeriesColumn(series);
  return {
    instrument_id: job.instId,
    metric: job.metric,
    first_day: enc.firstDay,
    n_days: enc.nDays,
    scale: enc.scale,
    readings: toByteaHex(enc.bytes),
    n_present: enc.nPresent,
    first_year: enc.firstYear,
    last_year: enc.lastYear,
    min_value: enc.minValue,
    max_value: enc.maxValue,
    source: SOURCE_BY_CT[job.sourceCt] ?? job.sourceCt,
  };
}

/** A row, decoded back the way the browser will decode it. */
function decodeRow(row: ReturnType<typeof buildRow>): SeriesColumn {
  return decodeSeriesColumn(row as any);
}

// ─── THE BAKE ───────────────────────────────────────────────────────────────────
async function runBake(only?: string, onlyMetric?: string) {
  bootstrapKeys();
  const { list } = jobs(only, onlyMetric);
  console.log(`=== BAKE board_series_columns === ${list.length} (instrument,metric) row(s)`);
  console.log(`  ${list.filter((j) => j.boardSlot).length} board slots · ${list.filter((j) => !j.boardSlot).length} card-only metrics (no layout_version, no frame re-bake)`);
  console.log(`  source: warm .frame-cache (read-only) · upsert on (instrument_id, metric) · idempotent\n`);

  const batch: any[] = [];
  let bytes = 0;
  const flush = async () => {
    if (!batch.length) return;
    await fetchWithRetry(`${SUPABASE_URL}/rest/v1/board_series_columns?on_conflict=instrument_id,metric`, {
      method: "POST",
      headers: { ...supaHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(batch),
    }, "board_series_columns upsert");
    batch.length = 0;
  };

  for (const job of list) {
    const series = loadCachedSeries(job.instId).get(job.metric);
    if (!series || series.size === 0) { console.log(`  – ${job.instId}:${job.metric}: no readings in cache, skipped`); continue; }
    const row = buildRow(job, series);
    bytes += row.n_days * 2;
    console.log(`  ✓ ${job.instId}:${job.metric.padEnd(16)} ${row.first_day} +${row.n_days}d · ${row.n_present} present · scale ×${row.scale} · ${(row.n_days * 2 / 1024).toFixed(1)} KB`);
    batch.push(row);
    if (batch.length >= UPSERT_BATCH) await flush();
  }
  await flush();
  reportDrops();
  console.log(`\n=== DONE — ${list.length} row(s), ${(bytes / 1048576).toFixed(2)} MB of column ===`);
}

// ─── DRY RUN — the rows, sized, writing nothing ──────────────────────────────────
function runDryRun(only?: string, onlyMetric?: string) {
  const { list, instruments } = jobs(only, onlyMetric);
  console.log(`=== DRY RUN — board_series_columns — NOTHING IS WRITTEN ===\n`);
  console.log(`  instrument:metric              first_day    days  present  scale   column  wire(hex)`);
  let bytes = 0, hex = 0, written = 0, empty = 0;
  const byKind = new Map<string, { rows: number; bytes: number; days: string }>();
  const emptyList: string[] = [];
  for (const job of list) {
    const series = loadCachedSeries(job.instId).get(job.metric);
    if (!series || series.size === 0) { empty++; emptyList.push(`${job.instId}:${job.metric}`); continue; }
    const row = buildRow(job, series);
    bytes += row.n_days * 2;
    hex += row.readings.length;
    written++;
    const kind = job.boardSlot ? instruments.get(job.instId)!.kind : `card:${job.metric}`;
    const k = byKind.get(kind) ?? { rows: 0, bytes: 0, days: "" };
    k.rows++; k.bytes += row.n_days * 2;
    k.days = `${row.first_day} +${row.n_days}d`;
    byKind.set(kind, k);
    if (list.length <= 12 || job.instId.endsWith("-md") || job.instId.endsWith("-tx") || job.instId.endsWith("-nd")) {
      console.log(`  ${`${job.instId}:${job.metric}`.padEnd(30)} ${row.first_day}  ${String(row.n_days).padStart(6)}  ${String(row.n_present).padStart(7)}  ×${String(row.scale).padEnd(5)} ${(row.n_days * 2 / 1024).toFixed(1).padStart(7)} KB ${(row.readings.length / 1024).toFixed(1).padStart(8)} KB`);
    }
  }
  console.log(`\n  by kind:`);
  for (const [kind, k] of byKind) console.log(`    ${kind.padEnd(20)} ${String(k.rows).padStart(3)} rows  ${(k.bytes / 1048576).toFixed(2)} MB   (last: ${k.days})`);
  console.log(`\n  TOTAL ${written} rows written · ${empty} (instrument,metric) job(s) hold no readings in the cache and are skipped`);
  if (emptyList.length) console.log(`        skipped: ${emptyList.join(", ")}`);
  console.log(`        ${(bytes / 1048576).toFixed(2)} MB stored · ${(hex / 1048576).toFixed(2)} MB as PostgREST hex`);
  reportDrops();
  console.log(`\n=== DRY RUN COMPLETE — no database connection was opened ===`);
}

// ─── VERIFY — round trip, and parity with the committed definition of a match ────
function runVerify() {
  const { list, instruments } = jobs();
  const instById = instruments;
  let fails = 0;

  // 1. ENCODE → DECODE is lossless on every present day, and every absent day
  //    decodes as absent. A silent rounding here would move a hunter's number.
  console.log(`=== VERIFY board_series_columns ===\n--- 1. round trip, every reading of every series ---`);
  let checked = 0, bad = 0;
  for (const job of list) {
    const series = loadCachedSeries(job.instId).get(job.metric);
    if (!series || series.size === 0) continue;
    const col = decodeRow(buildRow(job, series));
    for (const [iso, v] of series) {
      if (!Number.isFinite(v)) continue;
      const i = epochDay(iso) - col.firstDay;
      checked++;
      if (col.raw[i] === MISSING || Math.abs(col.raw[i] / col.scale - v) > 1e-9) {
        bad++; if (bad <= 5) console.log(`    ✗ ${job.instId}:${job.metric} ${iso}: ${v} → ${col.raw[i]}/${col.scale}`);
      }
    }
    // and nothing was invented in the gaps
    for (let i = 0; i < col.raw.length; i++) {
      if (col.raw[i] === MISSING) continue;
      const iso = isoOfEpochDay(col.firstDay + i);
      if (!series.has(iso)) { bad++; if (bad <= 5) console.log(`    ✗ ${job.instId}:${job.metric} ${iso}: decoded a reading the cache does not hold`); }
    }
  }
  console.log(`  ${checked} readings across ${list.length} series → ${bad} mismatch(es)`);
  if (bad) fails++;

  // 2. The pool built from the DECODED column must be member-for-member the pool
  //    bake-luts.ts builds from the raw series. Same doyOffset window, same sort.
  //    This is the guarantee that the card counts the committed definition of a
  //    match and not a second one (the ±10-vs-±15 defect, never again).
  console.log(`\n--- 2. pool parity vs the committed definition (bake-luts.ts buildPool) ---`);
  const sample = ["ghcn-md", "ghcn-tx", "ghcn-nd", "ghcn-ca", "ghcn-me", "tide-8574680", "buoy-42035", "needle-ao"];
  const sampleJobs = list.filter((j) => sample.includes(j.instId));
  let poolChecks = 0, poolBad = 0;
  for (const job of sampleJobs) {
    const byField = loadCachedSeries(job.instId);
    const series = byField.get(job.metric);
    if (!series || series.size === 0) continue;
    // A card metric is not a board slot and so has no MetricDef window; the card's
    // window IS the shared DOY_HALF_WINDOW, which is the point of Ruling 1.
    const nDays = instById.get(job.instId)!.metrics.find((m) => m.field === job.metric)?.n_days ?? DOY_HALF_WINDOW;
    const col = decodeRow(buildRow(job, series));
    for (const mmdd of ["01-01", "02-28", "03-01", "06-21", "10-10", "12-24", "12-31"]) {
      const truth = truthPool(series, nDays, mmdd);
      const mine = poolForDoy(col, mmdd, nDays);
      poolChecks++;
      const a = truth.map((p) => `${p.day}:${p.v}`).join(",");
      const b = mine.map((p) => `${p.day}:${p.v}`).join(",");
      if (a !== b) { poolBad++; if (poolBad <= 5) console.log(`    ✗ ${job.instId}:${job.metric} ${mmdd}: ${truth.length} vs ${mine.length} members`); }
    }
  }
  console.log(`  ${poolChecks} (instrument × metric × doy) pools → ${poolBad} mismatch(es)`);
  if (poolBad) fails++;

  // 3. The census arithmetic, against an independent re-derivation — now on every
  //    card metric at its OWN side, not just the cold tail of the daytime high.
  console.log(`\n--- 3. census arithmetic vs an independent re-derivation ---`);
  let censusChecks = 0, censusBad = 0;
  for (const id of ["ghcn-md", "ghcn-tx", "ghcn-nd"]) {
    const byField = loadCachedSeries(id);
    for (const cm of CARD_METRICS) {
      const series = byField.get(cm.metric);
      if (!series || series.size === 0) continue;
      const col = decodeRow(buildRow({ instId: id, metric: cm.metric, sourceCt: "ghcn-daily", sourceKey: {}, dedup: cm.side, boardSlot: false }, series));
      for (const mmdd of ["01-15", "04-01", "10-10", "11-05"]) {
        for (const band of BANDS) {
          const truth = truthPool(series, DOY_HALF_WINDOW, mmdd);
          const c = bandCensus(poolForDoy(col, mmdd, DOY_HALF_WINDOW), band, cm.side);
          const n = truth.length;
          const take = Math.min(n, Math.ceil(band * n));
          const slice = cm.side === "low" ? truth.slice(0, take) : truth.slice(n - take, n);
          const eps = mergeEpisodes(slice.map((p) => p.day), DEFAULT_EPISODE_GAP_DAYS);
          const yrs = new Set(eps.map((e) => +isoOfEpochDay(e.startDay).slice(0, 4)));
          const edgeV = slice.length ? (cm.side === "low" ? slice[slice.length - 1].v : slice[0].v) : null;
          const edge = {
            ties: edgeV === null ? 0 : truth.filter((p) => p.v === edgeV).length,
            tiesInBand: edgeV === null ? 0 : slice.filter((p) => p.v === edgeV).length,
            take: slice.length,
          };
          censusChecks++;
          const ok = c.count === eps.length && c.years.length === yrs.size && c.matchedDays === take
            && c.edge.ties === edge.ties && c.edge.tiesInBand === edge.tiesInBand
            && c.refusal === refusalReason(eps.length, yrs.size, edge);
          if (!ok) { censusBad++; console.log(`    ✗ ${id}:${cm.metric} ${mmdd} ${band}: engine ${c.count}/${c.years.length}/ties ${c.edge.ties} vs truth ${eps.length}/${yrs.size}/ties ${edge.ties}`); }
        }
      }
    }
  }
  console.log(`  ${censusChecks} (state × metric × doy × band) censuses → ${censusBad} mismatch(es)`);
  if (censusBad) fails++;

  // 4. THE TIE FLOOR fires where the distribution says it must, and nowhere else.
  //    A precipitation series is mostly 0.00 in, so its LOW tail is a rank drawn
  //    through a pile of identical zeros — that band must refuse. Its HIGH tail is
  //    real weather and must not. If this inverts, the card is quoting a sort order.
  console.log(`\n--- 4. the tie floor: degenerate tails refuse, real tails do not ---`);
  let tieChecks = 0, tieBad = 0;
  for (const id of ["ghcn-md", "ghcn-la", "ghcn-nd", "ghcn-az"]) {
    const byField = loadCachedSeries(id);
    for (const cm of CARD_METRICS) {
      const series = byField.get(cm.metric);
      if (!series || series.size === 0) continue;
      const col = decodeRow(buildRow({ instId: id, metric: cm.metric, sourceCt: "ghcn-daily", sourceKey: {}, dedup: cm.side, boardSlot: false }, series));
      const pool = poolForDoy(col, "10-10", DOY_HALF_WINDOW);
      const low = bandCensus(pool, 0.05, "low");
      const high = bandCensus(pool, 0.05, "high");
      tieChecks++;
      const degenerateSide = cm.zeroInflated ? low : null;
      if (degenerateSide && !/share the band's edge value/.test(degenerateSide.refusal ?? "")) {
        tieBad++; console.log(`    ✗ ${id}:${cm.metric} low tail did NOT refuse (edge ties ${low.edge.ties}/${low.edge.take}) — a rank over a mass of zeros`);
      }
      const label = `${id}:${cm.metric.padEnd(14)}`;
      console.log(`    ${label} low: ties ${String(low.edge.ties).padStart(4)}/${String(low.edge.take).padStart(3)} ${low.refusal ? "REFUSES" : "states"} · high: ties ${String(high.edge.ties).padStart(4)}/${String(high.edge.take).padStart(3)} ${high.refusal ? "REFUSES" : "states"}`);
    }
  }
  console.log(`  ${tieChecks} (state × metric) tail pairs → ${tieBad} inversion(s)`);
  if (tieBad) fails++;

  console.log(`\n${fails ? "✗ FAIL" : "✓ PASS"} — ${fails} failure(s)`);
  process.exit(fails ? 1 : 0);
}

/** The committed pool, rebuilt from the raw series exactly as bake-luts.ts does. */
function truthPool(series: Map<string, number>, nDays: number, mmdd: string) {
  const target = `2000-${mmdd}`;
  const pool: { v: number; day: number; year: number }[] = [];
  for (const [d, v] of series) {
    if (doyOffset(d, target) <= nDays && Number.isFinite(v)) pool.push({ v, day: epochDay(d), year: +d.slice(0, 4) });
  }
  pool.sort((a, b) => a.v - b.v || a.day - b.day);
  return pool;
}

// ─── CARD — the real rendered numbers, offline, before anything is written ───────
//
// Every metric is printed at ITS OWN side (the cold tail of a temperature, the wet
// tail of a rain) unless --side forces one, so this prints what the card will
// actually say rather than what one direction would say about everything.
function runCard(states: string[], mmdd: string, metrics: string[], forceSide?: TailSide, eras = true) {
  const { instruments } = jobs();
  const w = windowPhrase(mmdd);
  console.log(`=== THE CARD, REAL NUMBERS === ${mmddLabel(mmdd)} · ${w.short} (${w.span}) · episode gap ${DEFAULT_EPISODE_GAP_DAYS}d\n`);

  for (const abbr of states) {
    const id = `ghcn-${abbr.toLowerCase()}`;
    const inst = instruments.get(id);
    if (!inst) { console.log(`  ✗ ${abbr}: no such instrument`); continue; }
    const byField = loadCachedSeries(id);

    for (const metric of metrics) {
      const cm = CARD_METRIC_BY_ID[metric];
      const side = forceSide ?? cm?.side ?? "low";
      const series = byField.get(metric);
      if (!series || series.size === 0) { console.log(`  ${inst.label} — ${metric}: NOT IN THE CACHE (warm it first)\n`); continue; }
      const col = decodeRow(buildRow({ instId: id, metric, sourceCt: inst.source_ct, sourceKey: inst.source_key, dedup: side, boardSlot: false }, series));

      const eraList: [number, string][] = eras
        ? [[-Infinity, "full record"], [1979, "1979+ (ERA5-shaped)"]]
        : [[-Infinity, "full record"]];
      for (const [minYear, label] of eraList) {
        const pool = poolForDoy(col, mmdd, DOY_HALF_WINDOW, minYear);
        const since = pool.length ? Math.min(...pool.map((p) => p.year)) : 0;
        const zeros = pool.filter((p) => p.v === 0).length;
        console.log(`  ${inst.label} — ${cm?.label ?? metric} (${metric}, ${side} tail) — ${label}: pool n=${pool.length}, ${new Set(pool.map((p) => p.year)).size} years (${since}+), ${((100 * zeros) / (pool.length || 1)).toFixed(1)}% of the window reads 0`);
        for (const band of BANDS) {
          const c = bandCensus(pool, band, side);
          const head = c.refusal
            ? `REFUSES — ${c.refusal}`
            : `${capitalize(subjectPhrase(metric, side, c.threshold, inst.label))}, ${w.short}, has happened ${c.count} times since ${since}. Most recently ${c.lastOccurrence}.`;
          console.log(`    ${bandPhrase(metric, band, side).padEnd(50)} days=${String(c.matchedDays).padStart(3)} times=${String(c.count).padStart(3)} years=${String(c.years.length).padStart(3)} edge-ties=${c.edge.ties}/${c.edge.take}`);
          console.log(`      ${head}`);
          if (!c.refusal) {
            console.log(`      bars: ${c.dist.bars.map((b) => `${b.decade}s ${b.count}/${b.yearsOfRecord}y=${b.perYear.toFixed(2)}${b.partial ? "*" : ""}`).join("  ") || "none"}`);
            if (c.dist.preBarCount || c.dist.preBarYears) console.log(`      pre-${c.dist.bars[0]?.decade ?? 1980} (counted, not drawn): ${c.dist.preBarCount} in ${c.dist.preBarYears}y`);
          }
        }
        console.log("");
      }
    }
  }
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ─── SWEEP — does a metric answer anywhere, or does it only ever refuse? ─────────
//
// The decision this exists for: a metric that refuses in every state on every day
// is not a card, it is a chip that always disappoints. Zero fraction says whether a
// percentile is meaningful; this says whether the floors and the episode merge
// leave anything to state after it is. Both had to be measured before wiring — the
// second one caught `snow_depth_in`, which is not zero-inflated in the north at all
// and still almost never answers, because lying snow is one continuous episode.
function runSweep(mmdds: string[]) {
  const { instruments } = jobs();
  const states = [...instruments.values()].filter((i) => i.source_ct === "ghcn-daily");
  console.log(`=== SWEEP — how often each metric can state a frequency at all ===`);
  console.log(`  ${states.length} states × ${mmdds.length} anchors (${mmdds.join(", ")}) × ${BANDS.length} bands, each metric at its own side\n`);
  console.log(`  metric           side   answers   refuses   %answer  by reason (ties / <5 matches / <10 years)   median zero%`);

  for (const cm of CARD_METRICS) {
    let answers = 0, tie = 0, few = 0, yrs = 0;
    const zeroFracs: number[] = [];
    const bestByAnchor = new Map<string, number>();
    for (const inst of states) {
      const series = loadCachedSeries(inst.id).get(cm.metric);
      if (!series || series.size === 0) continue;
      const col = decodeRow(buildRow({ instId: inst.id, metric: cm.metric, sourceCt: "ghcn-daily", sourceKey: {}, dedup: cm.side, boardSlot: false }, series));
      for (const mmdd of mmdds) {
        const pool = poolForDoy(col, mmdd, DOY_HALF_WINDOW);
        if (!pool.length) continue;
        zeroFracs.push(pool.filter((p) => p.v === 0).length / pool.length);
        for (const band of BANDS) {
          const c = bandCensus(pool, band, cm.side);
          if (!c.refusal) {
            answers++;
            bestByAnchor.set(mmdd, (bestByAnchor.get(mmdd) ?? 0) + 1);
          } else if (/edge value/.test(c.refusal)) tie++;
          else if (/match\(es\)/.test(c.refusal)) few++;
          else yrs++;
        }
      }
    }
    const total = answers + tie + few + yrs;
    zeroFracs.sort((a, b) => a - b);
    const medZero = zeroFracs.length ? zeroFracs[Math.floor(zeroFracs.length / 2)] : 0;
    console.log(`  ${cm.metric.padEnd(16)} ${cm.side.padEnd(5)} ${String(answers).padStart(8)} ${String(total - answers).padStart(9)} ${((100 * answers) / (total || 1)).toFixed(1).padStart(8)}%  ${String(tie).padStart(5)} / ${String(few).padStart(5)} / ${String(yrs).padStart(5)}                ${(100 * medZero).toFixed(1).padStart(6)}%`);
    console.log(`  ${"".padEnd(16)} answers by anchor: ${mmdds.map((m) => `${m} ${bestByAnchor.get(m) ?? 0}`).join("  ")}`);
  }
}

// ─── main ───────────────────────────────────────────────────────────────────────
function flagValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
}

async function main() {
  const argv = process.argv.slice(2);
  const only = flagValue(argv, "--only");
  const onlyMetric = flagValue(argv, "--metric");
  if (argv.includes("--verify")) return runVerify();
  if (argv.includes("--sweep")) {
    const given = argv.slice(argv.indexOf("--sweep") + 1).filter((a) => /^\d{2}-\d{2}$/.test(a));
    return runSweep(given.length ? given : ["01-15", "04-15", "07-15", "10-10", "11-15", "12-15"]);
  }
  if (argv.includes("--dry-run")) return runDryRun(only, onlyMetric);
  const cardIdx = argv.indexOf("--card");
  if (cardIdx !== -1) {
    const rest = argv.slice(cardIdx + 1).filter((a, i, arr) => !a.startsWith("--") && arr[i - 1] !== "--metric");
    const mmdd = rest.find((a) => /^\d{2}-\d{2}$/.test(a)) ?? "10-10";
    const states = rest.filter((a) => /^[A-Za-z]{2}$/.test(a)).map((a) => a.toUpperCase());
    const metrics = onlyMetric ? [onlyMetric] : CARD_METRICS.map((m) => m.metric);
    const forceSide: TailSide | undefined = argv.includes("--high") ? "high" : argv.includes("--low") ? "low" : undefined;
    return runCard(states.length ? states : ["MD"], mmdd, metrics, forceSide, !argv.includes("--no-eras"));
  }
  return runBake(only, onlyMetric);
}
main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
