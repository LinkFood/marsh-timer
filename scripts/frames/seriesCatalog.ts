/**
 * seriesCatalog.ts — WHAT THE COLUMN STORE HOLDS, decoupled from the board layout.
 *
 * ── THE ARCHITECTURAL FACT THIS FILE EXISTS TO EXPLOIT ────────────────────────
 *
 * `board_series_columns` has `PRIMARY KEY (instrument_id, metric)` and NO
 * `layout_version` column — deliberately, and the migration says why: that column
 * guards the BYTE PACKING ORDER of `board_frames`, and a value column has no
 * packing order.
 *
 * The consequence is the whole point of this file. Adding a metric to the CARD is
 * not adding an instrument to the BOARD:
 *
 *   a board slot            → `board_layout` changes → `layout_version` changes
 *                           → all 27,964 frames must be re-baked. Expensive.
 *   a `board_series_columns` row → a new primary key. Nothing else moves.
 *                           No layout, no version, no re-bake, no frame touched.
 *
 * Only `bake-series-columns.ts` was coupled to the layout, and only because it
 * built its job list by walking `buildRegistry()`. It walks THIS instead, which is
 * the registry's jobs UNION the card-only ones. The registry-driven path is
 * unchanged and still produces every board slot's column — the board still needs
 * it, and `--verify` still proves those columns against the committed pool.
 *
 * ── WHY THE CARD METRICS ARE NOT IN `registry.ts` ─────────────────────────────
 * Putting `avg_low_f` into `STATE_METRICS` would give every one of the 50 state
 * instruments another slot (two, for a two-sided metric), change the manifest,
 * change `layout_version`, and force exactly the re-bake this design avoids. The
 * card's extra metrics are NOT board dots. They are archive columns the card
 * counts. Keeping them out of the registry is what makes them cheap.
 */

import { CARD_METRICS } from "../board/frequency.ts";
import type { DedupSide, SeriesSource } from "./archive.ts";
import { buildRegistry, type Instrument } from "./registry.ts";

/** One (instrument, metric) column to warm and to bake. */
export type SeriesJob = {
  instId: string;
  metric: string;
  sourceCt: string;
  sourceKey: Record<string, string>;
  /** Which duplicate wins when two archive rows land on one date. */
  dedup: DedupSide;
  /** Does the board also carry this metric as a packed byte? Card-only ⇒ false. */
  boardSlot: boolean;
};

/** The lane a row came from, for the card's methods note. */
export const SOURCE_BY_CT: Record<string, string> = {
  "ghcn-daily": "GHCN-Daily state-day means (NOAA ACIS)",
  "tide-gauge": "NOAA CO-OPS verified tide residuals",
  "ocean-buoy-historical": "NDBC buoy standard meteorological archive",
  "climate-index": "NOAA CPC / PSL monthly climate indices",
  "climate-index-daily": "NOAA CPC daily climate indices",
  "cpc-daily-ao": "NOAA CPC daily Arctic Oscillation",
};

/** The card's metrics that the board does NOT already carry. */
export const CARD_ONLY_STATE_METRICS = CARD_METRICS.filter((m) => m.metric !== "avg_high_f");

/**
 * Every column the store should hold: the registry's board slots first (unchanged
 * order, so a `--dry-run` diff against the shipped 82 rows is readable), then the
 * card-only state metrics.
 */
export function buildSeriesCatalog(): { jobs: SeriesJob[]; instruments: Map<string, Instrument> } {
  const { rows } = buildRegistry();
  const instruments = new Map<string, Instrument>(rows.map((r) => [r.id, r]));
  const jobs: SeriesJob[] = [];
  const seen = new Set<string>();

  for (const inst of rows) {
    for (const m of inst.metrics) {
      jobs.push({
        instId: inst.id,
        metric: m.field,
        sourceCt: inst.source_ct,
        sourceKey: inst.source_key,
        dedup: m.direction === "two-sided" ? "last" : m.direction,
        boardSlot: true,
      });
      seen.add(`${inst.id}:${m.field}`);
    }
  }

  for (const inst of rows) {
    if (inst.source_ct !== "ghcn-daily") continue;
    for (const cm of CARD_ONLY_STATE_METRICS) {
      if (seen.has(`${inst.id}:${cm.metric}`)) continue;
      jobs.push({
        instId: inst.id,
        metric: cm.metric,
        sourceCt: inst.source_ct,
        sourceKey: inst.source_key,
        // Keep the extreme on the side the card counts, so a twin row can only
        // ever be resolved toward the reading the card would have shown anyway.
        dedup: cm.side,
        boardSlot: false,
      });
    }
  }

  return { jobs, instruments };
}

/** The archive fields one instrument needs warmed, board slots and card metrics together. */
export function fieldsByInstrument(jobs: SeriesJob[]): Map<string, SeriesJob[]> {
  const out = new Map<string, SeriesJob[]>();
  for (const j of jobs) {
    const list = out.get(j.instId) ?? [];
    list.push(j);
    out.set(j.instId, list);
  }
  return out;
}

/** An instrument reduced to what `loadSeries` needs. */
export function sourceOf(inst: Instrument): SeriesSource {
  return { id: inst.id, source_ct: inst.source_ct, source_key: inst.source_key };
}
