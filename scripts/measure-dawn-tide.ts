/**
 * measure-dawn-tide.ts — compute one station's LUNAR-LOCKED DAWN TIDE CLOCK.
 *
 * WHY THIS EXISTS. `src/data/dawnTide.ts` carries a hand-checked table of the
 * predicted water level at a fixed local hour, binned by lunar phase, for
 * stations somebody has actually measured. The dossier
 * (docs/MOONLIGHT-AND-THE-MORNING-2026-08-01.md §4.1) measured exactly one:
 * Bishops Head 8571421. Every other station on the coast refuses, correctly,
 * because THE SIGN FLIPS BY STATION — Bishops Head springs put LOW water at
 * dawn while Ocean City Inlet puts HIGH water at 07:57 — and a regional rule
 * would be a true statement about one station generalised into a false one
 * about all of them.
 *
 * This script is how a station stops refusing: measure it, don't infer it.
 *
 * THE MEASUREMENT. High water follows the moon's transit by a fixed lunitidal
 * interval, so full and new moon put high water at the SAME hours and the
 * quarters shift it by about six. That is the CLOCK, not the spring–neap RANGE
 * every tide app already draws. Bin predicted level at a fixed local hour by
 * lunar phase and the clock falls out — and full-vs-new is the control, because
 * the two are tidally identical and opposite in moonlight.
 *
 * ILLUMINATION COMES FROM src/lib/sky.ts, NOT A REIMPLEMENTATION. This project's
 * most expensive lesson is that two constructions of the same quantity cannot be
 * ranked against each other (43% band disagreement, no bias to subtract). The
 * app decides "near full" with sky.ts; so does this. Same arithmetic on both
 * sides of the comparison, or the table means nothing.
 *
 * Usage:
 *   npx tsx scripts/measure-dawn-tide.ts 8571807 "Woolford, Church Creek"
 *   npx tsx scripts/measure-dawn-tide.ts 8571421 "Bishops Head"   # reproduce the dossier
 *
 * Read-only. Hits NOAA CO-OPS (free, keyless, public domain) and writes nothing.
 */

import { moonState } from "../src/lib/sky";

const COOPS = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";

/** The dossier's bins, verbatim, so a new row is comparable to the old one. */
const NEAR_FULL = 0.96;
const NEAR_NEW = 0.04;
const QUARTER_MIN_DAYS_FROM_SYZYGY = 6.5;
const DAWN_HOUR_LOCAL = 7;
const SYNODIC_MONTH_DAYS = 29.530588;

const stationId = process.argv[2];
const stationName = process.argv[3] ?? "(unnamed)";
/** `--sub` forces the hi/lo clock path for a station NOAA marks `type: "S"`. */
const isSubordinate = process.argv.includes("--sub");
if (!stationId) {
  console.error("usage: npx tsx scripts/measure-dawn-tide.ts <stationId> [name] [--sub]");
  process.exit(1);
}

/** Season window, matching the dossier: Oct 15 – Jan 31, ten seasons. */
const SEASONS: Array<[string, string]> = [];
for (let y = 2015; y <= 2024; y++) SEASONS.push([`${y}1015`, `${y + 1}0131`]);

interface Row { date: string; level: number; illum: number; daysFromSyzygy: number }

/** Days from the nearest new-or-full moon. Phase age is 0..29.53 from new. */
function daysFromSyzygy(ageDays: number): number {
  const half = SYNODIC_MONTH_DAYS / 2;
  const toNew = Math.min(ageDays, SYNODIC_MONTH_DAYS - ageDays);
  const toFull = Math.abs(ageDays - half);
  return Math.min(toNew, toFull);
}

/**
 * SUBORDINATE STATIONS. NOAA marks a station `type: "S"` when its predictions
 * are the reference station's, shifted by published time and height offsets.
 * Those stations serve HI/LO ONLY — `interval=60` returns
 * "No Predictions data was found. Please make sure the Datum input is valid",
 * which is a red herring: the datum is fine, the curve does not exist.
 * Woolford 8571807 — the nearest station to Blackwater and the one the
 * reference spot binds to — is one of these. Its reference is Baltimore 8574680.
 *
 * We do NOT synthesise a curve from the hi/lo pairs to get a 07:00 level. A
 * rule-of-twelfths interpolation would print three decimal places of invented
 * water, which is the exact failure this codebase keeps finding.
 *
 * Instead we measure what NOAA actually publishes for these stations: the CLOCK.
 * That is the better measurement anyway — the dossier's mechanism is that high
 * water follows the moon's transit by a fixed lunitidal interval, so the hour of
 * low water binned by lunar phase IS the finding, stated in the units the
 * station serves rather than in units it does not.
 */
async function fetchSeasonHiLo(from: string, to: string): Promise<HiLo[]> {
  const url =
    `${COOPS}?begin_date=${from}&end_date=${to}&station=${stationId}` +
    `&product=predictions&datum=MLLW&units=english&time_zone=lst_ldt&format=json&interval=hilo`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${from}..${to}`);
  const body = await res.json();
  if (!body?.predictions) throw new Error(`no hilo: ${JSON.stringify(body).slice(0, 200)}`);

  const out: HiLo[] = [];
  for (const p of body.predictions) {
    if (typeof p?.t !== "string" || typeof p?.v !== "string" || typeof p?.type !== "string") continue;
    const [date, time] = p.t.split(" ");
    const [hh, mm] = time.split(":").map(Number);
    const level = Number(p.v);
    if (!Number.isFinite(level) || !Number.isFinite(hh) || !Number.isFinite(mm)) continue;
    const m = moonState(new Date(`${date}T07:00:00Z`));
    if (!Number.isFinite(m.age) || !Number.isFinite(m.illumination)) continue;
    out.push({
      date,
      hourLocal: hh + mm / 60,
      level,
      kind: p.type === "H" ? "H" : "L",
      illum: m.illumination,
      daysFromSyzygy: daysFromSyzygy(m.age),
    });
  }
  return out;
}

interface HiLo {
  date: string; hourLocal: number; level: number; kind: "H" | "L";
  illum: number; daysFromSyzygy: number;
}

async function fetchSeason(from: string, to: string): Promise<Row[]> {
  // interval=60 gives the hourly curve; we read the 07:00 local sample.
  const url =
    `${COOPS}?begin_date=${from}&end_date=${to}&station=${stationId}` +
    `&product=predictions&datum=MLLW&units=english&time_zone=lst_ldt&format=json&interval=60`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${from}..${to}`);
  const body = await res.json();
  if (!body?.predictions) throw new Error(`no predictions: ${JSON.stringify(body).slice(0, 200)}`);

  const out: Row[] = [];
  for (const p of body.predictions) {
    // "YYYY-MM-DD HH:MM". Guard on typeof BEFORE Number — Number(null),
    // Number("") and Number([]) are all a finite 0, and 0.0 ft is a believable
    // tide at MLLW, so a fabricated reading here would be invisible.
    if (typeof p?.t !== "string" || typeof p?.v !== "string") continue;
    const [date, time] = p.t.split(" ");
    if (time !== `${String(DAWN_HOUR_LOCAL).padStart(2, "0")}:00`) continue;
    const level = Number(p.v);
    if (!Number.isFinite(level)) continue;

    // Illumination at local dawn, via the app's own lunar theory.
    const m = moonState(new Date(`${date}T${String(DAWN_HOUR_LOCAL).padStart(2, "0")}:00:00Z`));
    // `age`, not `ageDays`. Reading a field that does not exist yields NaN
    // through Math.min, and `NaN > 6.5` is false — so the quarter bin emptied
    // silently rather than filling with garbage. It failed safe and said
    // nothing, which is exactly why the count is printed beside every mean.
    if (!Number.isFinite(m.age) || !Number.isFinite(m.illumination)) continue;
    out.push({
      date,
      level,
      illum: m.illumination,
      daysFromSyzygy: daysFromSyzygy(m.age),
    });
  }
  return out;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Bin label for a day, or null if it sits between the bins. */
function bin(illum: number, dfs: number): "full" | "new" | "quarter" | null {
  if (illum > NEAR_FULL) return "full";
  if (illum < NEAR_NEW) return "new";
  if (dfs > QUARTER_MIN_DAYS_FROM_SYZYGY) return "quarter";
  return null;
}

/** The clock measurement, for stations that serve hi/lo only. */
async function runSubordinate(): Promise<void> {
  const all: HiLo[] = [];
  for (const [from, to] of SEASONS) {
    process.stderr.write(`  ${from}..${to}\n`);
    all.push(...(await fetchSeasonHiLo(from, to)));
    await new Promise((r) => setTimeout(r, 400));
  }

  // The MORNING LOW: the low water nearest 07:00 on each date. That is the
  // number a marsh hunter feels — when the water leaves the grass beds.
  const byDate = new Map<string, HiLo[]>();
  for (const e of all) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date)!.push(e);
  }

  const groups: Record<string, number[]> = { full: [], new: [], quarter: [] };
  const levels: Record<string, number[]> = { full: [], new: [], quarter: [] };
  for (const [, events] of byDate) {
    const lows = events.filter((e) => e.kind === "L");
    if (lows.length === 0) continue;
    const nearest = lows.reduce((a, b) =>
      Math.abs(a.hourLocal - DAWN_HOUR_LOCAL) <= Math.abs(b.hourLocal - DAWN_HOUR_LOCAL) ? a : b,
    );
    const g = bin(nearest.illum, nearest.daysFromSyzygy);
    if (!g) continue;
    groups[g].push(nearest.hourLocal);
    levels[g].push(nearest.level);
  }

  const fmt = (h: number) => {
    const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  };

  console.log(`\n=== ${stationName} (${stationId}) — SUBORDINATE station, hi/lo only ===`);
  console.log(`  NOAA serves no curve here, so this measures the CLOCK, not a level at ${DAWN_HOUR_LOCAL}:00.`);
  console.log(`  Morning low water — the low nearest ${DAWN_HOUR_LOCAL}:00 local — Oct 15 – Jan 31, ${SEASONS.length} seasons.\n`);
  for (const g of ["full", "new", "quarter"] as const) {
    const hs = groups[g], ls = levels[g];
    if (hs.length === 0) { console.log(`  ${g.padEnd(8)} n=0 — no days in bin`); continue; }
    console.log(`  ${g.padEnd(8)} low at ${fmt(mean(hs))}  ·  ${mean(ls).toFixed(2)} ft  ·  n=${hs.length}`);
  }
  const spring = [...groups.full, ...groups.new];
  const shift = mean(spring) - mean(groups.quarter);
  console.log(`\n  SPRING − QUARTER = ${shift.toFixed(2)} h  (${(shift * 60).toFixed(0)} minutes of clock)`);
  console.log(`  full − new       = ${(mean(groups.full) - mean(groups.new)).toFixed(3)} h  ← the control`);
  console.log(`\n  Springs put the morning low ${shift < 0 ? "EARLIER" : "LATER"} here than quarters.\n`);
}

/**
 * WIND RESIDUAL — observed minus predicted, in feet.
 *
 * Why the table carries it: wind setup shifts the water LEVEL but not its
 * PHASE, so it does not erase the lunar clock. But a phase difference smaller
 * than the weather noise is a difference the hunter will never see through the
 * weather, and the resolver has to be able to say so rather than printing a
 * number that is real and illegible. A station's clock is only worth rendering
 * when it is large against this.
 */
async function measureWindResidual(): Promise<{ sd: number; n: number; window: string }> {
  const diffs: number[] = [];
  const years = [2022, 2023, 2024];
  for (const y of years) {
    for (const [from, to] of [[`${y}1101`, `${y}1130`], [`${y}1201`, `${y}1231`], [`${y + 1}0101`, `${y + 1}0131`]]) {
      const base = `${COOPS}?begin_date=${from}&end_date=${to}&station=${stationId}&datum=MLLW&units=english&time_zone=lst_ldt&format=json`;
      const [obsRes, predRes] = await Promise.all([
        fetch(`${base}&product=water_level`),
        fetch(`${base}&product=predictions&interval=60`),
      ]);
      const obs = await obsRes.json();
      const pred = await predRes.json();
      if (!obs?.data || !pred?.predictions) continue;
      const p = new Map<string, number>();
      for (const r of pred.predictions) {
        if (typeof r?.t !== "string" || typeof r?.v !== "string") continue;
        const v = Number(r.v);
        if (Number.isFinite(v)) p.set(r.t, v);
      }
      for (const r of obs.data) {
        if (typeof r?.t !== "string" || typeof r?.v !== "string") continue;
        const v = Number(r.v);
        const q = p.get(r.t);
        if (!Number.isFinite(v) || q === undefined) continue;
        diffs.push(v - q);
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  if (diffs.length === 0) return { sd: NaN, n: 0, window: "Nov–Jan 2022–2025 (no observations)" };
  const m = mean(diffs);
  const sd = Math.sqrt(mean(diffs.map((d) => (d - m) ** 2)));
  return { sd, n: diffs.length, window: "Nov–Jan 2022–2025" };
}

(async () => {
  if (process.argv.includes("--residual")) {
    const r = await measureWindResidual();
    console.log(`\n=== ${stationName} (${stationId}) — wind residual ===`);
    console.log(`  observed − predicted SD = ${Number.isFinite(r.sd) ? r.sd.toFixed(2) : "NO OBSERVATIONS"} ft   n=${r.n}   ${r.window}\n`);
    return;
  }
  if (isSubordinate) { await runSubordinate(); return; }

  const rows: Row[] = [];
  for (const [from, to] of SEASONS) {
    process.stderr.write(`  ${from}..${to}\n`);
    rows.push(...(await fetchSeason(from, to)));
    await new Promise((r) => setTimeout(r, 400)); // be polite to a free public API
  }

  const full = rows.filter((r) => r.illum > NEAR_FULL);
  const nw = rows.filter((r) => r.illum < NEAR_NEW);
  const q = rows.filter((r) => r.daysFromSyzygy > QUARTER_MIN_DAYS_FROM_SYZYGY);

  const fullFt = mean(full.map((r) => r.level));
  const newFt = mean(nw.map((r) => r.level));
  const qFt = mean(q.map((r) => r.level));
  const springFt = mean([...full, ...nw].map((r) => r.level));

  console.log(`\n=== ${stationName} (${stationId}) — level at ${DAWN_HOUR_LOCAL}:00 local, MLLW ft ===`);
  console.log(`  day-samples: ${rows.length}   window: Oct 15 – Jan 31, ${SEASONS.length} seasons`);
  console.log(`  near-full (illum > ${NEAR_FULL})   ${fullFt.toFixed(2)}  n=${full.length}`);
  console.log(`  near-new  (illum < ${NEAR_NEW})   ${newFt.toFixed(2)}  n=${nw.length}`);
  console.log(`  quarter   (>${QUARTER_MIN_DAYS_FROM_SYZYGY}d from syzygy)  ${qFt.toFixed(2)}  n=${q.length}`);
  console.log(`\n  SPRING − QUARTER = ${(springFt - qFt).toFixed(2)} ft  (${((springFt - qFt) * 12).toFixed(0)} inches)`);
  console.log(`  full − new       = ${(fullFt - newFt).toFixed(3)} ft  ← the control; near zero means`);
  console.log(`                       the two are tidally identical and any full-vs-new`);
  console.log(`                       difference a hunter sees is NOT the water.`);
  console.log(`  sign at dawn: springs give ${springFt < qFt ? "LOWER" : "HIGHER"} water than quarters here.\n`);
})();
