/**
 * liveGround.ts — what is standing on each state's ground right now.
 *
 * This is what the front-door map shades by while the tail-depth claim is
 * withheld (`rarity.ts`, THE TAIL-DEPTH GATE). It is deliberately the dullest
 * possible quantity, and that is the point: it is not a comparison.
 *
 * TWO LANES, BOTH VERIFIED, BOTH LIVE:
 *
 *  1. `hunt_nws_alerts` — NWS products at severity Severe or Extreme whose
 *     `expires` is still in the future. The event names are NWS's own words,
 *     carried verbatim. Nothing here is derived, ranked, or compared against a
 *     historical pool, so there is no construction to mismatch: a Flood Watch
 *     is a Flood Watch whether or not 1954 was measured the same way.
 *  2. `formation_watches` at `status = 'forming'` — the formation layer's
 *     known-physics leads, each one already carrying its own receipts.
 *
 * WHAT THE SHADE MEANS. Intensity is HOW MUCH is standing (distinct products
 * plus open watches, with an Extreme product topping the ramp). Hue is the only
 * direction we can honestly read off a live product: `alertTempDirection` maps
 * heat and fire-weather products to the warm side and freeze/winter products to
 * the cold side, and everything else — flood, wind, thunderstorm, tornado — is
 * direction-NEUTRAL and draws slate. Neutral is not a hedge; it is the true
 * answer for most NWS products, which say nothing at all about temperature.
 *
 * WHAT NOTHING MEANS. A state with no live product and no open watch is NOT
 * "quiet" and NOT "unknown" — it is a state with nothing live on it, which is
 * where most states sit on most days. That is a fact and it is drawn as one,
 * in its own flat fill. The absence hatch is reserved for the one case that is
 * genuinely missing: the lanes could not be read at all.
 */

import {
  alertTempDirection,
  stateFullName,
  FORMING_LEAD_WORD,
  type FormationWatch,
  type StateAlert,
} from "@/lib/board/frameStore";
import { COLD_RAMP, HOT_RAMP } from "@/lib/board/rarity";

// ── The reading ───────────────────────────────────────────────────────────────

/** 0 nothing live · 1 one thing standing · 2 several · 3 an Extreme product. */
export type LiveBand = 0 | 1 | 2 | 3;

/** Which way the live products point on the temperature axis, if at all. */
export type LiveAxis = "high" | "low" | null;

export interface LiveState {
  abbr: string;
  /** Distinct NWS event names naming this state, severity-ordered. Verbatim. */
  products: string[];
  /** True when at least one of them is severity Extreme. */
  extreme: boolean;
  /** Formation leads open over this state, as short words ("flood ground"). */
  leads: string[];
  axis: LiveAxis;
  band: LiveBand;
}

/**
 * Fold the two live lanes into one per-state reading. Both arguments are what
 * the page already fetched for the porch and the board's rings — this adds no
 * round trip.
 */
export function liveStates(
  alerts: Map<string, StateAlert>,
  watches: FormationWatch[],
): Map<string, LiveState> {
  const out = new Map<string, LiveState>();

  const ensure = (abbr: string): LiveState => {
    const cur = out.get(abbr);
    if (cur) return cur;
    const made: LiveState = { abbr, products: [], extreme: false, leads: [], axis: null, band: 0 };
    out.set(abbr, made);
    return made;
  };

  for (const [abbr, a] of alerts) {
    const s = ensure(abbr);
    s.products = [...a.allEventTypes];
    s.extreme = a.severity === "Extreme";
    s.axis = axisOf(a.allEventTypes);
  }

  for (const w of watches) {
    const word = FORMING_LEAD_WORD[w.lead_id];
    if (!word) continue; // an unknown lead is not given a name it does not have
    for (const abbr of w.states) {
      const s = ensure(abbr);
      if (!s.leads.includes(word)) s.leads.push(word);
    }
  }

  for (const s of out.values()) s.band = bandOfLive(s);
  return out;
}

/**
 * The direction the whole set of products points, or null. Products that
 * disagree — a Red Flag Warning beside a Freeze Warning — resolve to null
 * rather than to whichever came first. We do not break a tie we cannot read.
 */
function axisOf(products: string[]): LiveAxis {
  let seen: LiveAxis = null;
  for (const p of products) {
    const d = alertTempDirection(p);
    if (!d) continue;
    if (seen === null) seen = d;
    else if (seen !== d) return null;
  }
  return seen;
}

export function bandOfLive(s: LiveState): LiveBand {
  if (s.extreme) return 3;
  const n = s.products.length + s.leads.length;
  if (n >= 2) return 2;
  if (n >= 1) return 1;
  return 0;
}

// ── The palette ───────────────────────────────────────────────────────────────
//
// Same near-black ground, same two hue words the whole site uses for warm and
// cold, plus slate for the direction-neutral majority. Intensity is depth of
// the stack, never depth of a record.

/** No live product, no open watch. A fact, drawn flat — never on a ramp. */
export const NOTHING_LIVE_FILL = "#141b22";
/** The lanes could not be read. The caller draws the hatch over this. */
export const LANES_DARK_FILL = "#0d1217";

const SLATE_RAMP = ["#2b3846", "#4d6076", "#94a9c0"] as const;

function rampFor(axis: LiveAxis): readonly string[] {
  if (axis === "high") return HOT_RAMP;
  if (axis === "low") return COLD_RAMP;
  return SLATE_RAMP;
}

export function liveFill(s: LiveState | undefined): string {
  if (!s || s.band === 0) return NOTHING_LIVE_FILL;
  return rampFor(s.axis)[s.band - 1];
}

/** Legend swatches, lightest stack → heaviest, in the neutral hue. */
export const LIVE_LEGEND: { fill: string; label: string }[] = [
  { fill: NOTHING_LIVE_FILL, label: "nothing live" },
  { fill: SLATE_RAMP[0], label: "one thing standing" },
  { fill: SLATE_RAMP[1], label: "several" },
  { fill: SLATE_RAMP[2], label: "an Extreme product" },
];

// ── The voice ─────────────────────────────────────────────────────────────────

const list = (xs: string[]): string =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

/**
 * One state's live ground as an honest clause. Every noun in it is either an
 * NWS event name or a formation lead id — nothing is invented, nothing counts
 * anything the reader cannot go and check.
 */
export function liveClause(s: LiveState | undefined): string {
  if (!s || s.band === 0) return "nothing live on it right now";
  const parts: string[] = [];
  if (s.products.length === 1) parts.push(`under ${withArticle(s.products[0])}`);
  else if (s.products.length > 1) {
    parts.push(`under ${s.products.length} live NWS products — ${list(s.products.slice(0, 3))}${s.products.length > 3 ? ", and more" : ""}`);
  }
  if (s.leads.length) parts.push(`${list(s.leads)} forming`);
  return parts.join(" · ");
}

/** The same reading compressed for a hover strip or an aria-label. */
export function liveWord(s: LiveState | undefined): string {
  if (!s || s.band === 0) return "nothing live";
  const bits: string[] = [];
  if (s.products.length) {
    bits.push(s.products.length === 1 ? s.products[0] : `${s.products.length} NWS products`);
  }
  if (s.leads.length) bits.push(`${list(s.leads)} forming`);
  return bits.join(" · ");
}

/** "a Flood Watch" / "an Extreme Heat Warning" — NWS name verbatim. */
function withArticle(s: string): string {
  return /^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`;
}

// ── The national counts, for the porch coda ───────────────────────────────────

export interface LiveTally {
  states: number;
  extremeStates: number;
  watchStates: number;
  watches: number;
}

export function tallyLive(live: Map<string, LiveState>, watches: FormationWatch[]): LiveTally {
  let states = 0;
  let extremeStates = 0;
  let watchStates = 0;
  for (const s of live.values()) {
    if (s.band === 0) continue;
    states += 1;
    if (s.extreme) extremeStates += 1;
    if (s.leads.length) watchStates += 1;
  }
  return { states, extremeStates, watchStates, watches: watches.length };
}

/** The busiest ground first — the chips under the map, and the only touch and
 *  keyboard path small states have. Ties break to the state name so the list is
 *  stable between renders. */
export function busiestFirst(live: Map<string, LiveState>, limit: number): LiveState[] {
  return [...live.values()]
    .filter((s) => s.band > 0)
    .sort(
      (a, b) =>
        b.band - a.band ||
        b.products.length + b.leads.length - (a.products.length + a.leads.length) ||
        stateFullName(a.abbr).localeCompare(stateFullName(b.abbr)),
    )
    .slice(0, limit);
}
