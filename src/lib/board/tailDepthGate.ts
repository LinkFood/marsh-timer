/**
 * tailDepthGate.ts — ONE flag, and the reason it is where it is.
 *
 * This file exists on its own so that the switch that silences a claim across
 * four surfaces is a file you can open, not a line you have to find. It has no
 * imports, so nothing can create a cycle around it and nothing can be in a
 * temporal-dead-zone when it is read.
 */

/**
 * Whether a state's TAIL DEPTH may be shown to a reader. **false since
 * 2026-07-25.**
 *
 * The arithmetic in `rarity.ts` is right. Its INPUT is not, and no amount of
 * correct ranking fixes a mismatched measurement:
 *
 *  - the live day-0 value is Open-Meteo's FORECAST `temperature_2m_max` read at
 *    ONE state centroid (`hunt-weather-watchdog`);
 *  - the pool it is ranked against is a GHCN STATION-NETWORK MEAN — 39 stations
 *    in Maryland, 362 in Alaska, 424 in Texas.
 *
 * Measured over 45,059 state-days: the two constructions land in a DIFFERENT
 * shade band **43.0%** of the time, and disagree about hot vs cold — the thing
 * a reader takes in at a glance — **18.1%** of the time. One percentile point
 * at the real band edges is 0.2–0.4 °F; the systematic term alone is ~5.5
 * percentile points. A per-state offset fitted leave-one-day-out moved band
 * disagreement **30.61% → 30.61%**: there is no bias to subtract, because it is
 * not a bias. It is two instruments being asked to agree.
 *
 * FLIP THIS TO TRUE WHEN, AND ONLY WHEN, ALL FOUR HOLD:
 *
 *  1. `board_frames`' day-0 byte for every `state-temp` instrument is the rank
 *     of an ERA5 5-point `temp_2m_max_f` reading under the FROZEN scheme —
 *     `sampling_version = 1`, `scheme_hash 587429395`
 *     (docs/ERA5-SAMPLING-SCHEME.md §3a).
 *  2. `board_pool_luts`' day-of-year pool for that same instrument is built
 *     from the SAME five points, 1979 forward, same scheme hash.
 *  3. No GHCN station-network mean survives in either lane for `state-temp`.
 *     §3a rule 4: the two constructions must never be blended, and "one lane
 *     each" is blending.
 *  4. The band-disagreement number is RE-MEASURED against the new pairing and
 *     written down. It is not assumed to have gone to zero because the source
 *     changed; if it is still tens of percent, something else is wrong.
 *
 * Flipping it back on restores, in one edit: the depth shading and the deepest-
 * ground chips on `/`, the depth words and percentile sentences on `/atlas`,
 * and `porchLine`'s corroborated-extreme lead and its deep-reading fallback.
 */
export const TAIL_DEPTH_IS_COMPARABLE = false;

/**
 * Why the depth is not on the page, in the product's own voice. One copy deck,
 * shared by every surface that used to make the claim, so they cannot drift.
 */
export const DEPTH_WITHHELD = {
  /** Fits a hover readout or an aria-label. */
  short: "depth withheld",
  /** The summary line — always visible, tappable open on a phone. */
  summary: "Why this map no longer ranks the day",
  body: [
    "This map used to shade each state by how deep its reading sat in its own 72–76 year record. It should not have, and the reason is not a bug in the shading — it is that the two numbers being compared were never the same measurement.",
    "Today's reading is a forecast high taken at a single point in the middle of the state. The record it was ranked against is the average of every weather station that state has: 39 in Maryland, 362 in Alaska, 424 in Texas. A point wanders further than an average does, so it reaches the ends of the record for free. Across 45,059 state-days the two constructions land in a different shade band 43% of the time, and disagree about hot versus cold — the one thing a reader takes from a colour — 18% of the time.",
    "We fitted a per-state correction and tested it against days it had never seen. It moved the disagreement from 30.61% to 30.61%. There was nothing to correct: not one instrument with an offset, two instruments.",
    "A percentile is a rank, and a rank is only worth reading when the day and the record were measured the same way. The archive that makes them the same — ERA5, five fixed points per state, the same five points for 1979 as for this morning — is on its way. The depth comes back the day it lands and not one day earlier. A number chosen before then would be a guess wearing a rank's clothes.",
  ],
  /** What is on the map instead, and why that one is safe to draw. */
  instead:
    "What it shades now is what is standing on the ground at this minute: severe and extreme NWS products, and open formation watches. Both are live, both are hourly, and neither is a comparison — nothing has to match a 1954 measurement for a Flood Watch to be a Flood Watch. A state with neither is not calm and is not unknown. It is a state with nothing live on it, which is most states on most days.",
} as const;

/** Fill for a state whose depth exists but is withheld. Not the absence hatch:
 *  the archive is not silent about these states, we are. */
export const WITHHELD_FILL = "#12181f";

/**
 * What a `state-temp` ember is worth on the instrument board while the gate is
 * closed. The board sizes and brightens every dot by its tail depth, which is a
 * depth ranking rendered as light — the same withheld claim, drawn instead of
 * written. So every reporting thermometer is given the SAME value: fifty
 * identical marks say "this one reported today" and nothing else, and no reader
 * can rank them off the picture because there is no order in it to read.
 *
 * It is deliberately low. A mid value would read as "moderately deep" to anyone
 * who knows the ramp, and that is a claim too. Flip the flag and every dot gets
 * its own depth back; nothing else about the board changes.
 */
export const WITHHELD_MARK_PCT = 0.25;
