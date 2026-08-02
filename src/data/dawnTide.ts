/**
 * ============================================================================
 *  THE LUNAR-LOCKED DAWN TIDE CLOCK — measured, per station, never generalized
 * ============================================================================
 *
 *  Source: `docs/MOONLIGHT-AND-THE-MORNING-2026-08-01.md` §4.1, the confounder
 *  the dossier ranks first and says nobody in the waterfowl literature has ever
 *  named.
 *
 *  THE MECHANISM. High water follows the moon's transit by a fixed lunitidal
 *  interval. So full and new moon — which put the moon overhead at the same
 *  hours — put HIGH WATER at the same hours too, and the quarter moons shift it
 *  by about six. That is not the spring–neap RANGE, which is the thing every
 *  tide app already shows. It is the CLOCK, and at a station where the phase
 *  lands wrong it is feet of water on the marsh at shooting time, deterministic,
 *  locked to lunar phase, with no photons involved at all.
 *
 *  It produces the hunter's exact symptom — "the full moon ruined my morning" —
 *  by a completely different cause than the one he believes in.
 *
 * ---------------------------------------------------------------------------
 *  ⚠  THE SIGN FLIPS BY STATION. THIS IS THE WHOLE REASON THIS IS A TABLE.
 * ---------------------------------------------------------------------------
 *
 *  Bishops Head springs put LOW water at dawn. **Ocean City Inlet 8570283 puts
 *  HIGH water at 07:57 on the same springs, and Kiptopeke VA 8632200 the same.**
 *  A tidal mechanism must reverse sign between those sites; a photon mechanism
 *  cannot. The dossier calls that a free test.
 *
 *  It is also a trap, and it is the exact class of error this project keeps
 *  finding: a true statement about one station, generalised into a false one
 *  about all of them. So there is NO default row, NO nearest-station fallback,
 *  and NO regional rule. A station absent from this table gets a refusal, and
 *  the refusal is the correct render — not a failure, and not a reason to reach
 *  for the nearest row that happens to have numbers in it.
 *
 *  Woolford / Church Creek 8571807 — the nearest CO-OPS prediction station to
 *  Blackwater NWR and the one the reference spot binds to — IS NOT IN THIS
 *  TABLE. Nobody has measured it. Bishops Head is 8571421 and its numbers are
 *  Bishops Head's.
 *
 * ---------------------------------------------------------------------------
 *  WHY THE MEASUREMENT CANNOT BE DERIVED ON THE PHONE.
 * ---------------------------------------------------------------------------
 *
 *  Working out a station's dawn clock needs a season or more of harmonic
 *  predictions binned by lunar phase — ten seasons, in the row below. The field
 *  path holds a tide POCKET: one day's curve, written at PREP with signal (see
 *  `src/components/field/tidePocket.ts`). One day cannot answer a question about
 *  the lunar cycle. So this arrives as PACKED DATA, computed elsewhere, cited
 *  here, and every station without a pack refuses out loud.
 * ============================================================================
 */

import type { TideDatum, TideUnits } from "@/lib/tide";

/**
 * One station's measured dawn water level, binned by lunar phase.
 *
 * Every field carries its own `n`. A mean with no count behind it is the shape
 * of the practitioner claims this dossier exists to answer.
 */
export interface DawnTideStation {
  /** NOAA CO-OPS station id. The key. Never a name, never a region. */
  readonly stationId: string;
  readonly stationName: string;
  /** Local hour the levels below were evaluated at, 0–23. Printed verbatim. */
  readonly dawnHourLocal: number;
  /** Predicted level at `dawnHourLocal` on days with illumination > 0.96. */
  readonly nearFullFt: number;
  readonly nearFullN: number;
  /** Same, on days with illumination < 0.04. Tidally identical to full. */
  readonly nearNewFt: number;
  readonly nearNewN: number;
  /** Same, on days more than 6.5 days from syzygy. */
  readonly quarterFt: number;
  readonly quarterN: number;
  /**
   * Standard deviation of observed-minus-predicted water level at this station,
   * feet. Wind setup shifts LEVEL but not PHASE, so it does not erase the
   * clock — but a phase difference smaller than this is a difference the hunter
   * will never see through the weather, and the resolver says so instead of
   * printing it as if it were legible.
   */
  readonly windResidualSdFt: number;
  readonly windResidualN: number;
  readonly windResidualWindow: string;
  readonly datum: TideDatum;
  readonly units: TideUnits;
  /** The measurement window, printed verbatim in the receipt. */
  readonly window: string;
  readonly source: string;
  readonly cite: string;
  readonly verified: string;
}

const DOSSIER = "docs/MOONLIGHT-AND-THE-MORNING-2026-08-01.md §4.1";
/** Rows measured directly, reproducible by re-running the script. */
const SCRIPT = "scripts/measure-dawn-tide.ts, 2026-08-01";

/**
 * THE TABLE. One row. That is not an oversight — it is the measured extent of
 * what anyone has actually computed, and the empty rest of the coast is the
 * honest state of this question.
 *
 * Ocean City Inlet 8570283 is deliberately ABSENT even though the dossier
 * establishes its sign, because the dossier gives its high-water CLOCK (07:57
 * on springs) and not its dawn LEVELS. A row here with a known sign and guessed
 * feet would be worse than no row: it would render with full confidence and the
 * numbers would be invented. The sign alone does not fill this shape.
 */
export const DAWN_TIDE_STATIONS: readonly DawnTideStation[] = [
  {
    stationId: "8571421",
    stationName: "Bishops Head",
    dawnHourLocal: 7,
    nearFullFt: -0.08,
    nearFullN: 141,
    nearNewFt: -0.07,
    nearNewN: 140,
    quarterFt: 1.51,
    quarterN: 128,
    windResidualSdFt: 0.59,
    windResidualN: 13248,
    windResidualWindow: "Nov–Jan 2019–2024",
    datum: "MLLW",
    units: "english",
    window: "Oct 15 – Jan 31, ten seasons 2015-16 → 2024-25",
    source: "NOAA CO-OPS harmonic predictions",
    cite: DOSSIER,
    verified: "2026-08-01",
  },

  // ── Measured 2026-08-01 with scripts/measure-dawn-tide.ts ──────────────────
  // The script was validated against the row above before it was trusted on
  // anything new: it returns -0.08 (n=140) / -0.07 (n=139) / 1.54 (n=130) for
  // Bishops Head against the dossier's -0.08/141, -0.07/140, 1.51/128. Same
  // lunar theory as the app (src/lib/sky.ts), so both sides of the comparison
  // are one construction.
  //
  // THE SIGN FLIPS INSIDE A SINGLE BAY, which is stronger than the dossier
  // claimed. Cambridge is 20 miles from Bishops Head, same sign, FOUR TIMES
  // smaller. Tolchester is the same Chesapeake and reverses outright. Any
  // regional rule would tell an Ocean City hunter the full moon brings low
  // water at dawn when it brings the HIGHEST water of the cycle.
  {
    stationId: "8571892",
    stationName: "Cambridge",
    dawnHourLocal: 7,
    nearFullFt: 0.55, nearFullN: 140,
    nearNewFt: 0.56, nearNewN: 139,
    quarterFt: 0.99, quarterN: 130,
    // 0.43 ft of clock against 0.64 ft of weather. The clock is REAL here and
    // ILLEGIBLE — a hunter will never see it through the wind. The resolver is
    // expected to refuse to draw it, which is what this field is for.
    windResidualSdFt: 0.64, windResidualN: 6624,
    windResidualWindow: "Nov–Jan 2022–2025",
    datum: "MLLW", units: "english",
    window: "Oct 15 – Jan 31, ten seasons 2015-16 → 2024-25",
    source: "NOAA CO-OPS harmonic predictions",
    cite: SCRIPT,
    verified: "2026-08-01",
  },
  {
    stationId: "8573364",
    stationName: "Tolchester Beach",
    dawnHourLocal: 7,
    nearFullFt: 0.86, nearFullN: 140,
    nearNewFt: 0.84, nearNewN: 139,
    quarterFt: 0.10, quarterN: 130,
    // 0.75 against 0.71 — barely above the weather. Marginal, and the resolver
    // should treat it as such rather than rounding it up into a claim.
    windResidualSdFt: 0.71, windResidualN: 6624,
    windResidualWindow: "Nov–Jan 2022–2025",
    datum: "MLLW", units: "english",
    window: "Oct 15 – Jan 31, ten seasons 2015-16 → 2024-25",
    source: "NOAA CO-OPS harmonic predictions",
    cite: SCRIPT,
    verified: "2026-08-01",
  },
  {
    stationId: "8570283",
    stationName: "Ocean City Inlet",
    dawnHourLocal: 7,
    // THE REVERSAL, measured rather than inherited. Springs put 2.43 ft here at
    // the same hour they put -0.08 at Bishops Head, 110 miles away.
    nearFullFt: 2.43, nearFullN: 140,
    nearNewFt: 2.40, nearNewN: 139,
    quarterFt: 0.34, quarterN: 130,
    windResidualSdFt: 0.60, windResidualN: 6624,
    windResidualWindow: "Nov–Jan 2022–2025",
    datum: "MLLW", units: "english",
    window: "Oct 15 – Jan 31, ten seasons 2015-16 → 2024-25",
    source: "NOAA CO-OPS harmonic predictions",
    cite: SCRIPT,
    verified: "2026-08-01",
  },
  {
    stationId: "8632200",
    stationName: "Kiptopeke",
    dawnHourLocal: 7,
    nearFullFt: 2.66, nearFullN: 140,
    nearNewFt: 2.65, nearNewN: 139,
    quarterFt: 0.52, quarterN: 130,
    windResidualSdFt: 0.55, windResidualN: 6624,
    windResidualWindow: "Nov–Jan 2022–2025",
    datum: "MLLW", units: "english",
    window: "Oct 15 – Jan 31, ten seasons 2015-16 → 2024-25",
    source: "NOAA CO-OPS harmonic predictions",
    cite: SCRIPT,
    verified: "2026-08-01",
  },
];

/**
 * THE FULL-MINUS-NEW CONTROL, measured at every station above.
 *
 * Full and new moon are tidally identical and opposite in moonlight, so the
 * difference between them is the clean separation of the tide from the light —
 * the experiment the dossier says nobody has run. Measured here it is 0.007 ft
 * at Bishops Head, 0.010 at Cambridge, 0.020 at Tolchester, 0.027 at Ocean
 * City, 0.010 at Kiptopeke. Two hundredths of a foot, everywhere.
 *
 * So: any difference a hunter reports between a full moon and a new moon at
 * these stations is NOT the water. That does not make it the light — it makes
 * it something this table cannot see, and the honest surface says exactly that.
 *
 * This is a BOUND, deliberately looser than the largest measured value (0.03 ft
 * at Ocean City). A constant pinned to the exact maximum fails on floating-point
 * epsilon the moment a row equals it — 2.43 − 2.40 is 0.030000000000000249 — and
 * a guard that trips on arithmetic noise teaches the next reader to loosen it
 * rather than to look at the data.
 */
export const FULL_MINUS_NEW_MAX_FT = 0.05;

/** The row for a station, or `null`. No fallback, by construction. */
export function dawnTideStation(stationId: string | null | undefined): DawnTideStation | null {
  if (typeof stationId !== "string" || stationId.trim() === "") return null;
  const want = stationId.trim();
  return DAWN_TIDE_STATIONS.find((s) => s.stationId === want) ?? null;
}
