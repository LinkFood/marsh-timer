/**
 * rarity.ts — how unusual is this, here, against this state's own record.
 *
 * ONE NUMBER, ONE MEANING. Every state's shade on the rarity map is the packed
 * byte the frame store already holds: `board_frames.dots[slot]` / 254 is the
 * tail depth of that state's average daily high against its OWN day-of-year
 * pool (±10 days, every year on file). It is a RANK, not a z-score — which is
 * the same quantity the frequency card counts, so the map and the card cannot
 * disagree about the same state on the same screen.
 *
 * The two slots per instrument are complementary (low + high = 254), so the
 * resolved `pct` is the depth of whichever tail the reading actually sits in,
 * on [0.5, 1], and `side` is the direction. Direction is carried as HUE (ice
 * cold / amber hot) and depth as intensity — deep-cold and deep-hot are both
 * "unusual" and must never collapse to the same mark.
 *
 * What this module deliberately does NOT do: it never invents a reading. A
 * state with no byte on file renders as an explicit absence, never as "normal".
 *
 * Superseded: `hunt-atlas-anomaly`'s z-scores. That function is parametric AND
 * a year stale — it answers 2026-07-25 with `as_of_date: 2025-07-25` because
 * `ghcn-daily` stops at 2025-12-31, which had /atlas calling New York hot on a
 * day the frame store has it at the bottom of its July record. The frame store
 * is current (`day0_source: live`) and is the card's own quantity.
 *
 * WITHHELD SINCE 2026-07-25 — see THE TAIL-DEPTH GATE below. Everything in this
 * module still computes; nothing in it is currently allowed to speak.
 */

import { supabase } from "@/lib/supabase";
import { instrumentState, type ResolvedInstrument } from "@/lib/board/frameStore";
import { TAIL_DEPTH_IS_COMPARABLE, DEPTH_WITHHELD, WITHHELD_FILL } from "@/lib/board/tailDepthGate";

// ── THE TAIL-DEPTH GATE ───────────────────────────────────────────────────────
//
// The flag, the measurement that killed it, and the four conditions that bring
// it back live in `tailDepthGate.ts` — one file, no imports, nothing to hunt
// for. Re-exported here so every existing consumer of this module keeps one
// import line.

export { TAIL_DEPTH_IS_COMPARABLE, DEPTH_WITHHELD, WITHHELD_FILL } from "@/lib/board/tailDepthGate";

// ── The reading ───────────────────────────────────────────────────────────────

/** One state's tail depth for a day. `depth === null` means NO READING ON FILE. */
export interface StateRarity {
  abbr: string;
  depth: number | null; // [0.5, 1] — 1 = deepest the record holds
  side: "low" | "high" | null;
}

/**
 * Pull the per-state readings out of a resolved frame. Only `state-temp`
 * instruments carry a state; needles, tides and buoys are not areal and are
 * skipped. States the board does not instrument (DC) simply never appear —
 * the map renders their absence rather than this map inventing a zero.
 */
export function stateRarities(resolved: ResolvedInstrument[]): Map<string, StateRarity> {
  const out = new Map<string, StateRarity>();
  for (const r of resolved) {
    const abbr = instrumentState(r.inst);
    if (!abbr) continue;
    out.set(abbr, { abbr, depth: r.hasData ? r.pct : null, side: r.hasData ? r.side : null });
  }
  return out;
}

// ── The bands ─────────────────────────────────────────────────────────────────

/**
 * Four bands, and every threshold is one the codebase already uses out loud:
 * 0.85 is `porchLine`'s "deep in its tail", 249/254 is `EXTREME_DEPTH`. 0.75 is
 * the edge of the record's middle half — below it a state is inside its own
 * normal quartiles and the map says nothing.
 */
export const LEAN_DEPTH = 0.75;
export const DEEP_DEPTH = 0.85;
export const EDGE_DEPTH = 249 / 254;

/** 0 quiet · 1 leaning · 2 deep in its tail · 3 at the edge of its record. */
export type RarityBand = 0 | 1 | 2 | 3;

export function bandOf(depth: number | null): RarityBand | null {
  if (depth === null) return null;
  if (depth >= EDGE_DEPTH) return 3;
  if (depth >= DEEP_DEPTH) return 2;
  if (depth >= LEAN_DEPTH) return 1;
  return 0;
}

// ── The palette ───────────────────────────────────────────────────────────────
//
// Diverging on the board's near-black ground (#0a0f14): HUE carries direction
// (ice = cold tail, amber = hot tail — the same two words the front door's
// legend and boardPlayer's ember tints already use), intensity carries depth.
// The neutral centre is dark on purpose, so a state inside its own middle half
// recedes into the ground and only the unusual reads as lit.

export const QUIET_FILL = "#141b22";
/** Absence is a hatch, never a colour on the ramp — see RarityMap's <pattern>. */
export const ABSENT_FILL = "#0d1217";

/** Exported so the live-lane shading speaks the same two hues — the site has
 *  exactly one word for hot and one for cold, on every surface. */
export const COLD_RAMP = ["#22384f", "#3d7cb3", "#9ccdff"] as const;
export const HOT_RAMP = ["#5c3f21", "#a86a24", "#ffb060"] as const;

/** The fill for one state. `null` depth returns null — the caller must draw the
 *  absence hatch rather than any fill on the ramp. Under the gate a state that
 *  HAS a reading gets the withheld fill, which is not the hatch: the difference
 *  between "the archive is silent" and "we are". */
export function fillFor(r: StateRarity | undefined): string | null {
  if (!r || r.depth === null) return null;
  if (!TAIL_DEPTH_IS_COMPARABLE) return WITHHELD_FILL;
  const band = bandOf(r.depth);
  if (band === null || band === 0) return QUIET_FILL;
  const ramp = r.side === "high" ? HOT_RAMP : COLD_RAMP;
  return ramp[band - 1];
}

/** Legend swatches, coldest → hottest, with the words each shade means. */
export const RARITY_LEGEND: { fill: string; label: string }[] = [
  { fill: COLD_RAMP[2], label: "cold edge" },
  { fill: COLD_RAMP[1], label: "deep cold" },
  { fill: COLD_RAMP[0], label: "cool" },
  { fill: QUIET_FILL, label: "middle half" },
  { fill: HOT_RAMP[0], label: "warm" },
  { fill: HOT_RAMP[1], label: "deep hot" },
  { fill: HOT_RAMP[2], label: "hot edge" },
];

// ── The voice ─────────────────────────────────────────────────────────────────

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "Julys" / "Marches" / "Februaries" — the plural of the frame day's month. */
export function monthPlural(day: string): string {
  const m = MONTHS[Number(day.slice(5, 7)) - 1] ?? "";
  if (m === "March") return "Marches";
  if (m.endsWith("ary")) return `${m.slice(0, -1)}ies`; // January, February
  return `${m}s`;
}

/** Short direction-aware word for a hover readout: "deep in its cold tail". */
export function depthWord(r: StateRarity | undefined): string {
  if (!r || r.depth === null) return "no reading on file";
  if (!TAIL_DEPTH_IS_COMPARABLE) return DEPTH_WITHHELD.short;
  const hot = r.side === "high";
  switch (bandOf(r.depth)) {
    case 3: return `at the ${hot ? "hot" : "cold"} edge of its record`;
    case 2: return `deep in its ${hot ? "warm" : "cold"} tail`;
    case 1: return `leaning ${hot ? "warm" : "cool"}`;
    default: return "inside its middle half";
  }
}

/** The same reading as a verb phrase: "sits deep in its cold tail". */
export function depthClause(r: StateRarity | undefined): string {
  if (!r || r.depth === null) return "has no reading on file";
  if (!TAIL_DEPTH_IS_COMPARABLE) return "has a reading on file that we are not ranking";
  const hot = r.side === "high";
  switch (bandOf(r.depth)) {
    case 3: return `is at the ${hot ? "hot" : "cold"} edge of its record`;
    case 2: return `sits deep in its ${hot ? "warm" : "cold"} tail`;
    case 1: return `is leaning ${hot ? "warm" : "cool"}`;
    default: return "is inside its middle half";
  }
}

/**
 * The full reading as one honest clause, denominator mandatory:
 * "hotter than 96% of its 72 Julys" / "as cold as its 72 Julys have ever run".
 * `years` is the state's own pool depth — never a site-wide constant, because
 * the pools are not the same depth (72 for most states, 76 for Texas).
 */
export function rarityClause(r: StateRarity | undefined, day: string, years: number | null): string {
  if (!r || r.depth === null) return "no reading on file for this day";
  if (!TAIL_DEPTH_IS_COMPARABLE) {
    return "its place in that record is withheld until the day and the record are measured the same way";
  }
  const hot = r.side === "high";
  const of = years ? `its ${years} ${monthPlural(day)}` : `its ${monthPlural(day)} on file`;
  if (r.depth >= 1 - 1e-9) return `as ${hot ? "hot" : "cold"} as ${of} have ever run`;
  return `${hot ? "hotter" : "colder"} than ${Math.floor(r.depth * 100)}% of ${of}`;
}

// ── The denominator, measured ─────────────────────────────────────────────────

/** doy key: leap-year/2000 ordinal — EXACTLY bake-luts.ts / hunt-frame-daily. */
export function doyOfIso(iso: string): number {
  const [, m, d] = iso.split("-").map(Number);
  return Math.round((Date.UTC(2000, m - 1, d) - Date.UTC(2000, 0, 1)) / 86400000) + 1;
}

/**
 * How many years each state's day-of-year pool actually holds, straight from
 * `board_pool_luts` — the same table the bake quantized the bytes against. One
 * bounded GET of ~100 small rows (both layout versions); the newest layout wins.
 *
 * A failed or empty read resolves to an empty map and the surfaces fall back to
 * "its record" — vaguer, still true. It never invents a year count.
 */
export async function fetchPoolYears(day: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!supabase) return out;
  try {
    const { data, error } = await supabase
      .from("board_pool_luts")
      .select("instrument_id,years,layout_version")
      .eq("metric", "avg_high_f")
      .eq("doy", doyOfIso(day))
      .limit(200);
    if (error || !data) return out;
    const rows = data as { instrument_id: string; years: number; layout_version: number }[];
    const newest = rows.reduce((m, r) => Math.max(m, r.layout_version), -Infinity);
    for (const r of rows) {
      if (r.layout_version !== newest) continue;
      const m = r.instrument_id.match(/^ghcn-([a-z]{2})$/i);
      if (m && r.years > 0) out.set(m[1].toUpperCase(), r.years);
    }
  } catch {
    /* honest absence — the clause degrades to "its record" */
  }
  return out;
}

/**
 * The map's own as-of line. `day0_source` is the frame's freshness label from
 * hunt-frame-daily: 'live' = the instruments reported on the frame's own day,
 * 'live-yesterday' = at least one last reported within two days, 'archive' =
 * the leading lane is historical. It is rendered, not swallowed — the whole
 * point of moving off hunt-atlas-anomaly was to stop a page implying currency
 * it does not have.
 */
export function freshnessNote(day0Source: string | null): string | null {
  switch (day0Source) {
    case "live": return null;
    case "live-yesterday": return "some instruments last reported the day before";
    case "archive": return "read from the archive, not a live feed";
    default: return null;
  }
}
