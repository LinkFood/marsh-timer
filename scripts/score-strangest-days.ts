/**
 * Strangest-days scorer — ranks calendar days by cross-domain strangeness
 * over the panel built by build-strangest-days-panel.ts.
 *
 * Implements the aha-hunt judge's corrections (2026-07-02):
 *   1. temp_anom and temp_swing are MERGED into ONE temperature axis
 *      (axis z = max(|z_temp|, |z_swing|)) — they double-counted one event.
 *   2. space_wx is NOT an axis — it's one national scalar that inflated every
 *      state's count equally. The panel never includes it; this scorer only
 *      ever sees per-state ground-observed axes: TEMP, PRECIP, SNOW.
 *   3. Threshold sweep is mandatory before quoting any count (knife-edge
 *      superlative rule) — rankings are reported at z >= 1.5 / 2.0 / 2.5 / 3.0.
 *
 * A state-day is "strange" on an axis when its z clears the threshold
 * (TEMP two-sided; PRECIP and SNOW positive tail only — a dry day is not a
 * daily extreme). A day's primary score is BREADTH: the number of states
 * simultaneously strange on 2+ axes (multi-domain), tiebroken by total
 * extreme axes, then by any-axis state count. Days with thin state coverage
 * (early panel gaps, mid-backfill states) are flagged, not silently ranked.
 *
 * Pure local computation over panel-*.json — no DB access, no writes to
 * hunt_knowledge, naturally idempotent (re-runs regenerate the same output;
 * results are written atomically).
 *
 * Usage:
 *   npx tsx scripts/score-strangest-days.ts
 *
 * Env:
 *   OUT_DIR=analysis/strangest-days — panel dir (same as builder)
 *   ONLY_STATES=CO,WY,NE           — score only these panels (validation)
 *   TOP_N=25                        — how many days to print/detail (default 25)
 *   MIN_COVERAGE=0.8                — flag days where fewer than this fraction
 *                                     of loaded states have data (default 0.8)
 *
 * Output: <OUT_DIR>/strangest-days-ranked.json + console tables.
 */

import * as fs from "fs";
import * as path from "path";

const SCRIPTS_DIR = import.meta.dirname || __dirname;

const OUT_DIR = path.resolve(
  process.env.OUT_DIR || path.join(SCRIPTS_DIR, "..", "analysis", "strangest-days"),
);
const TOP_N = process.env.TOP_N ? parseInt(process.env.TOP_N, 10) : 25;
const MIN_COVERAGE = process.env.MIN_COVERAGE ? parseFloat(process.env.MIN_COVERAGE) : 0.8;
const THRESHOLDS = [1.5, 2.0, 2.5, 3.0];
const PRIMARY_THRESHOLD = 2.0;

const ONLY_STATES = process.env.ONLY_STATES
  ? process.env.ONLY_STATES.toUpperCase().split(",").map((s) => s.trim()).filter(Boolean)
  : null;

// ---------- Types (must match builder output) ----------

interface PanelDay {
  date: string;
  tmean: number;
  z_temp: number;
  swing: number | null;
  z_swing: number | null;
  precip: number;
  z_precip: number;
  snow: number;
  z_snow: number;
  n_stations: number;
}

interface StatePanel {
  state: string;
  days: PanelDay[];
  missingYears: number[];
  partialYears: { year: number; rows: number }[];
}

interface StateAxisHit {
  state: string;
  axes: string[]; // which of TEMP/PRECIP/SNOW cleared threshold
  detail: {
    z_temp: number;
    z_swing: number | null;
    z_precip: number;
    z_snow: number;
    tmean: number;
    swing: number | null;
    precip: number;
    snow: number;
  };
}

interface DayScore {
  date: string;
  statesMultiAxis: number; // states with >=2 axes strange — PRIMARY score
  statesAnyAxis: number;
  totalExtremeAxes: number;
  statesWithData: number;
  coverage: number; // statesWithData / statesLoaded
  lowCoverage: boolean;
  hits: StateAxisHit[]; // only states with >=1 axis strange
}

// ---------- Axis logic (the judge's merged-axis rule lives HERE) ----------

/** Merged temperature axis: one event, one axis. */
function tempAxisZ(d: PanelDay): number {
  const a = Math.abs(d.z_temp);
  const b = d.z_swing !== null ? Math.abs(d.z_swing) : 0;
  return Math.max(a, b);
}

function axesForDay(d: PanelDay, threshold: number): string[] {
  const axes: string[] = [];
  if (tempAxisZ(d) >= threshold) axes.push("TEMP");
  if (d.z_precip >= threshold) axes.push("PRECIP"); // positive tail only
  if (d.z_snow >= threshold) axes.push("SNOW"); // positive tail only
  return axes;
}

// ---------- Scoring ----------

function scoreAtThreshold(
  panels: StatePanel[],
  threshold: number,
): DayScore[] {
  const statesLoaded = panels.length;

  // date -> accumulator
  const days = new Map<
    string,
    { statesWithData: number; hits: StateAxisHit[] }
  >();

  for (const panel of panels) {
    for (const d of panel.days) {
      let acc = days.get(d.date);
      if (!acc) {
        acc = { statesWithData: 0, hits: [] };
        days.set(d.date, acc);
      }
      acc.statesWithData++;
      const axes = axesForDay(d, threshold);
      if (axes.length > 0) {
        acc.hits.push({
          state: panel.state,
          axes,
          detail: {
            z_temp: d.z_temp,
            z_swing: d.z_swing,
            z_precip: d.z_precip,
            z_snow: d.z_snow,
            tmean: d.tmean,
            swing: d.swing,
            precip: d.precip,
            snow: d.snow,
          },
        });
      }
    }
  }

  const scores: DayScore[] = [];
  for (const [date, acc] of days) {
    const multi = acc.hits.filter((h) => h.axes.length >= 2).length;
    const total = acc.hits.reduce((a, h) => a + h.axes.length, 0);
    const coverage = acc.statesWithData / statesLoaded;
    scores.push({
      date,
      statesMultiAxis: multi,
      statesAnyAxis: acc.hits.length,
      totalExtremeAxes: total,
      statesWithData: acc.statesWithData,
      coverage: Math.round(coverage * 100) / 100,
      lowCoverage: coverage < MIN_COVERAGE,
      hits: acc.hits,
    });
  }

  scores.sort(
    (a, b) =>
      b.statesMultiAxis - a.statesMultiAxis ||
      b.totalExtremeAxes - a.totalExtremeAxes ||
      b.statesAnyAxis - a.statesAnyAxis ||
      a.date.localeCompare(b.date),
  );
  return scores;
}

// ---------- Main ----------

function main() {
  const files = fs
    .readdirSync(OUT_DIR)
    .filter((f) => /^panel-[A-Z]{2}\.json$/.test(f))
    .filter((f) => !ONLY_STATES || ONLY_STATES.includes(f.slice(6, 8)));

  if (files.length === 0) {
    console.error(`No panel-XX.json files in ${OUT_DIR} — run build-strangest-days-panel.ts first`);
    process.exit(1);
  }

  console.log("=== Strangest-Days Scorer ===");
  console.log(
    `Panels: ${files.length} states | axes: TEMP(merged anom+swing, two-sided), PRECIP(+), SNOW(+) | space_wx: EXCLUDED`,
  );

  const panels: StatePanel[] = files.map((f) =>
    JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), "utf8")),
  );

  const gapStates = panels.filter(
    (p) => p.missingYears.length > 0 || p.partialYears.length > 0,
  );
  if (gapStates.length > 0) {
    console.log(
      `NOTE: ${gapStates.length} states have year gaps (${gapStates.map((p) => p.state).join(",")}) — low-coverage days are flagged in output`,
    );
  }

  const results: Record<string, DayScore[]> = {};
  for (const threshold of THRESHOLDS) {
    const scores = scoreAtThreshold(panels, threshold);
    results[threshold.toFixed(1)] = scores.slice(0, Math.max(TOP_N * 4, 100));

    console.log(`\n=== Threshold z >= ${threshold} — top ${Math.min(TOP_N, 20)} ===`);
    console.log("rank  date        multi  any  axesTot  cov   flag");
    scores.slice(0, Math.min(TOP_N, 20)).forEach((s, i) => {
      console.log(
        `${String(i + 1).padStart(4)}  ${s.date}  ${String(s.statesMultiAxis).padStart(5)}  ${String(s.statesAnyAxis).padStart(3)}  ${String(s.totalExtremeAxes).padStart(7)}  ${s.coverage.toFixed(2)}  ${s.lowCoverage ? "LOW-COV" : ""}`,
      );
    });
  }

  // Detail for the primary threshold's top days
  const primary = results[PRIMARY_THRESHOLD.toFixed(1)];
  console.log(`\n=== Detail: top ${Math.min(TOP_N, 10)} at primary threshold z >= ${PRIMARY_THRESHOLD} ===`);
  for (const s of primary.slice(0, Math.min(TOP_N, 10))) {
    const multiHits = s.hits
      .filter((h) => h.axes.length >= 2)
      .map(
        (h) =>
          `${h.state}[${h.axes.join("+")} zT=${h.detail.z_temp}/${h.detail.z_swing ?? "-"} zP=${h.detail.z_precip} zS=${h.detail.z_snow}]`,
      )
      .join(" ");
    console.log(`${s.date}  multi=${s.statesMultiAxis} any=${s.statesAnyAxis}${s.lowCoverage ? " LOW-COV" : ""}`);
    if (multiHits) console.log(`   ${multiHits}`);
  }

  // Threshold-stability check on the primary top day (knife-edge rule)
  const top = primary[0];
  if (top) {
    console.log(`\n=== Knife-edge check for ${top.date} (multi-axis state count across thresholds) ===`);
    for (const t of THRESHOLDS) {
      const s = results[t.toFixed(1)].find((x) => x.date === top.date);
      console.log(`  z>=${t}: multi=${s ? s.statesMultiAxis : 0} any=${s ? s.statesAnyAxis : 0}`);
    }
  }

  const outFile = path.join(OUT_DIR, "strangest-days-ranked.json");
  const tmp = outFile + ".tmp";
  fs.writeFileSync(
    tmp,
    JSON.stringify(
      {
        scoredAt: new Date().toISOString(),
        statesLoaded: panels.map((p) => p.state),
        axes: ["TEMP (merged z_temp+z_swing, two-sided)", "PRECIP (positive)", "SNOW (positive)"],
        spaceWxExcluded: true,
        thresholds: THRESHOLDS,
        primaryThreshold: PRIMARY_THRESHOLD,
        minCoverage: MIN_COVERAGE,
        results,
      },
      null,
      2,
    ),
  );
  fs.renameSync(tmp, outFile);
  console.log(`\nWrote ${outFile}`);
}

main();
