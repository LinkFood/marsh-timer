/**
 * fieldSeason.ts — WHICH BIRD, and WHICH MODE. Both derived, neither asked.
 *
 * PURE. No network, no storage, no React. Everything here is a total function of
 * a state abbreviation, a calendar day and a clock reading.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * PART ONE: THE SPECIES IS A FACT ON THE CALENDAR, NOT A QUESTION FOR THE HUNTER
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * `lookupShootingHours` is season-aware and it will not answer at rule level
 * without the season, which it resolves `state + species + date → season → rule`.
 * Called with the state alone it returns `"narrowed"` — the SHORTER window —
 * because without the species it genuinely cannot know which season applies.
 *
 * On 2026-09-01 at Blackwater that costs thirty legal minutes. Maryland's
 * regular seasons close at sunset; the September resident Canada goose season
 * closes at SUNSET+30 under COMAR 08.03.07.13. A card that renders the narrow
 * window on the opener is a card that walks the hunter off the marsh half an
 * hour early, and he will never know it did.
 *
 * The obvious fix — make him tap DUCK or GOOSE — is the wrong fix twice over.
 * It is a tap with cold hands in the dark before the app will tell him the one
 * thing he opened it for, and it is a question the app already has the answer
 * to. `MD_SEASONS` is a committed constant. On 2026-09-01 Maryland publishes
 * exactly one open waterfowl season, and it is goose: the duck seasons do not
 * begin until October 3. So the species is not a preference to be collected. It
 * is a fact to be READ OFF THE CALENDAR, and this module reads it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW IT RESOLVES, AND WHY EACH BRANCH IS SAFE. Note that no branch ever widens.
 *
 *   override         The hunter named his bird. He always wins — same rule as
 *                    `setStation` in `src/lib/spot.ts`. One lookup, his species.
 *
 *   sole-open-season Exactly one transcribed species has an open season on this
 *                    date. There is nothing to guess: he is hunting that or he
 *                    is not hunting. THIS IS THE 2026-09-01 PATH — goose, sole,
 *                    → `md-september-resident-canada-goose`, → sunset+30.
 *
 *   agreeing-seasons Both duck and goose are open (Maryland's December overlap)
 *                    and BOTH resolve to the same rule id. Which bird he is
 *                    after cannot change the answer, so not knowing it costs
 *                    nothing and the window is exact for either.
 *
 *   undetermined     Both are open and they DISAGREE about the hours. This is
 *                    the one case where the species would change the answer, and
 *                    it is handled by calling `lookupShootingHours` with NO
 *                    species and letting the regs module narrow in its own
 *                    words. We do not construct a narrowing here — the module
 *                    owns that vocabulary, its message is the one the hunter
 *                    reads, and routing through it means this file cannot invent
 *                    a rule even by accident. No date in the transcribed 2026-27
 *                    table reaches this branch today; it exists so a future
 *                    season edit cannot silently widen.
 *
 *   none-open        No transcribed species has an open season. NO CLOCK IS
 *                    RENDERED AT ALL. Shooting hours only mean something inside
 *                    a season; the refusals the module returned are what gets
 *                    shown. Deliberately NOT routed through the no-species
 *                    narrowing, which would hand back md-general and draw a
 *                    confident legal clock on a closed day.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * PART TWO: THE MODE IS A DISTANCE IN TIME, NOT A PLACE
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * FIELD, PREP and PLAN were tabs. They are not places — they are how far the
 * hunter is from the hunt, and the app already holds every input needed to know
 * that: the clock, the calendar day, the season windows in `mdSeasons.ts` and
 * the frozen spot. Making a cold hand tap a tab to tell the app something it can
 * compute is the opposite of an instrument.
 *
 * So the mode is selected, not navigated. The thresholds are below, named, in
 * one block, with the reasoning attached — because a magic number in a mode
 * selector is a number nobody can argue with later.
 */

import {
  TRANSCRIBED_SPECIES,
  lookupShootingHours,
  type ShootingHoursLookup,
  type TranscribedSpecies,
} from "@/data/regs/shootingHours";

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE MODE THRESHOLDS — one block, named, argued.                          */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * How long before legal light opens the surface becomes FIELD, in minutes.
 *
 * Two hours. That is the drive, the ramp, the walk in and the decoys — the whole
 * stretch during which the only number that matters is how long until he can
 * legally shoot. Setting this shorter would put PREP on the screen while he is
 * already standing in the water. Setting it much longer would put a huge
 * countdown in front of a man eating breakfast, which is PREP's job.
 */
export const FIELD_LEAD_MIN = 120;

/**
 * How long after legal light closes the surface stays FIELD, in minutes.
 *
 * Thirty. He is picking up birds and decoys in the dark and the bag counter is
 * still the thing under his thumb. Long enough to finish, short enough that the
 * surface has moved on by the time he is back at the truck.
 */
export const FIELD_TRAIL_MIN = 30;

/**
 * The local hour after which "tomorrow is an open day" makes today PREP.
 *
 * Noon. Before noon, a hunt that is eighteen hours away is not what he is doing
 * with his day; after noon, packing shells is. The threshold is deliberately a
 * blunt local hour rather than a computed offset from tomorrow's sunrise — the
 * evening before is a human category, not an astronomical one, and dressing it
 * up in solar arithmetic would be false precision.
 */
export const PREP_EVENING_HOUR = 12;

/**
 * The mode the surface is in. There is exactly one screen; this is which face
 * of it is showing.
 */
export type FieldMode = "field" | "prep" | "plan";

const MS_PER_MINUTE = 60_000;

export interface ModeInputs {
  readonly now: Date;
  /** Instant legal light opens today, or `null` when today has no window. */
  readonly openAt: Date | null;
  /** Instant legal light closes today, or `null`. */
  readonly closeAt: Date | null;
  /** Does the NEXT calendar day carry an open season for any transcribed species. */
  readonly tomorrowOpen: boolean;
  /** The hunter's own local hour, 0-23. Passed in so this stays a total function. */
  readonly localHour: number;
  /**
   * Is this a day the state closes outright — a Maryland Sunday.
   *
   * SEPARATE FROM `openAt`/`closeAt` ON PURPOSE, and it has to be. A Sunday
   * inside the September goose season still HAS a computed window: the season is
   * open, the sun still rises, and `resolveShootingWindow` returns real times.
   * Only the day is shut. Without this flag the selector saw a window forty-five
   * minutes out and annunciated FIELD on a morning he is not permitted to hunt —
   * putting the field face, and its countdown, in front of a closed day.
   */
  readonly closedDay: boolean;
}

/**
 * Which face of the surface is true right now.
 *
 * FIELD wins over everything EXCEPT a closed day: if he can shoot within the
 * hour, nothing else is worth showing him big — but if he cannot shoot at all,
 * the field face is a lie no matter what the sun is doing. PLAN is the
 * fallthrough and never the answer on a day with a season on it.
 */
export function selectMode(input: ModeInputs): FieldMode {
  const nowMs = input.now?.getTime?.();
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) return "plan";

  const openMs = input.openAt?.getTime?.();
  const closeMs = input.closeAt?.getTime?.();
  const haveWindow =
    typeof openMs === "number" &&
    typeof closeMs === "number" &&
    Number.isFinite(openMs) &&
    Number.isFinite(closeMs);

  // A day the state shuts is never FIELD. It is PREP while the season is live
  // around it — he is not hunting today, but he is hunting this week, and the
  // next open morning is the thing in front of him.
  if (input.closedDay) {
    return haveWindow || input.tomorrowOpen ? "prep" : "plan";
  }

  if (haveWindow) {
    const from = (openMs as number) - FIELD_LEAD_MIN * MS_PER_MINUTE;
    const to = (closeMs as number) + FIELD_TRAIL_MIN * MS_PER_MINUTE;
    if (nowMs >= from && nowMs <= to) return "field";
    // Today is a hunting day and he is outside the window — that is PREP,
    // whether the window is still ahead of him or already behind.
    return "prep";
  }

  if (input.tomorrowOpen && Number.isFinite(input.localHour) && input.localHour >= PREP_EVENING_HOUR) {
    return "prep";
  }

  return "plan";
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE SPECIES                                                              */
/* ══════════════════════════════════════════════════════════════════════════ */

/** How the species was arrived at. Displayed, so the derivation is never hidden. */
export type QuarryBasis =
  | "override"
  | "sole-open-season"
  | "agreeing-seasons"
  | "undetermined"
  | "none-open";

export interface FieldSeason {
  /** What to render. A `refused` lookup means NO CLOCK — see `none-open`. */
  readonly lookup: ShootingHoursLookup;
  /** Species with an open season on this date, or the override. May be empty. */
  readonly species: readonly TranscribedSpecies[];
  readonly basis: QuarryBasis;
  /** Every open season's own zone label, from the digest, verbatim. */
  readonly zones: readonly string[];
  /**
   * The refusal sentences, when nothing is open. Distinct, in the regs module's
   * own words. Empty on every other branch.
   */
  readonly closedMessages: readonly string[];
}

/**
 * Resolve the season, and with it the species, for a state and a calendar day.
 *
 * `state` and `day` are passed straight through to `lookupShootingHours`, which
 * validates both and refuses rather than guessing. This function never inspects
 * `MD_SEASONS` itself and never compares dates — every season question is asked
 * of the regs module, so there is exactly one implementation of "is this date in
 * a season" in the codebase and it is the cited one.
 */
export function resolveFieldSeason(
  state: unknown,
  day: string,
  override?: TranscribedSpecies | null,
): FieldSeason {
  if (override) {
    const lookup = lookupShootingHours(state, { species: override, date: day });
    return {
      lookup,
      species: [override],
      basis: "override",
      zones: lookup.status === "transcribed" ? lookup.season.zones : [],
      closedMessages: [],
    };
  }

  const probes = TRANSCRIBED_SPECIES.map((species) => ({
    species,
    lookup: lookupShootingHours(state, { species, date: day }),
  }));

  const open = probes.filter((p) => p.lookup.status === "transcribed");
  const zones: string[] = [];
  for (const p of open) {
    if (p.lookup.status !== "transcribed") continue;
    for (const z of p.lookup.season.zones) if (!zones.includes(z)) zones.push(z);
  }

  if (open.length === 1) {
    return {
      lookup: open[0].lookup,
      species: [open[0].species],
      basis: "sole-open-season",
      zones,
      closedMessages: [],
    };
  }

  if (open.length > 1) {
    const ruleIds: string[] = [];
    for (const p of open) {
      if (p.lookup.status !== "transcribed") continue;
      if (!ruleIds.includes(p.lookup.rule.id)) ruleIds.push(p.lookup.rule.id);
    }
    if (ruleIds.length === 1) {
      return {
        lookup: open[0].lookup,
        species: open.map((p) => p.species),
        basis: "agreeing-seasons",
        zones,
        closedMessages: [],
      };
    }
    // They disagree, and the species would change the answer. Hand the question
    // back to the regs module with no species and let it narrow, in its words.
    return {
      lookup: lookupShootingHours(state, { date: day }),
      species: open.map((p) => p.species),
      basis: "undetermined",
      zones,
      closedMessages: [],
    };
  }

  // Nothing open. Collect the distinct refusal sentences and render no clock.
  const messages: string[] = [];
  for (const p of probes) {
    if (p.lookup.status === "refused" && !messages.includes(p.lookup.message)) {
      messages.push(p.lookup.message);
    }
  }
  return {
    lookup: probes[0].lookup,
    species: [],
    basis: "none-open",
    zones: [],
    closedMessages: messages,
  };
}

/** Is any transcribed species open on this day. Used for the PREP lookahead. */
export function anySeasonOpen(state: unknown, day: string): boolean {
  return TRANSCRIBED_SPECIES.some(
    (species) => lookupShootingHours(state, { species, date: day }).status === "transcribed",
  );
}

export interface NextOpen {
  readonly day: string;
  /** Whole days from the day asked about to `day`. Never negative. */
  readonly daysAway: number;
}

/**
 * The next calendar day the state publishes an open season on, walking forward.
 *
 * THIS IS THE HERO OF THE PLAN FACE, and it is the reason the mode is not merely
 * decorative. The instrument always shows "time until the next thing that
 * matters" — minutes in FIELD, hours in PREP, days here. Same gauge, different
 * scale.
 *
 * IT COUNTS, IT DOES NOT PREDICT. Every day is asked of `lookupShootingHours`,
 * so the answer is a fact about the transcribed digest and nothing else. When
 * the horizon runs out it returns `null` rather than the end of the horizon —
 * "no open day in the next 400" is not "the season opens in 400 days", and a
 * caller that got the horizon back as an answer would print the second sentence.
 *
 * The horizon is walked one day at a time rather than read off `MD_SEASONS`
 * directly on purpose: this file never inspects the season table itself, so
 * there is exactly one implementation of "is this date in a season" in the
 * codebase and it is the cited one. 400 iterations of an array filter is
 * microseconds and it happens once per day change, not per tick.
 */
export function findNextOpen(
  state: unknown,
  fromDay: string,
  opts: {
    readonly horizonDays?: number;
    /**
     * Days the state closes outright. A season being open on a date is NOT the
     * same as the date being huntable — Maryland does not permit Sunday
     * waterfowl hunting, which is why its 69 calendar days span 60 huntable
     * ones. Injected rather than imported so this module keeps no opinion about
     * closed days and `legalLight.ts` stays the one place that claim is made.
     * Without it this function would happily count a hunter down to a Sunday.
     */
    readonly isClosedDay?: (day: string) => boolean;
  } = {},
): NextOpen | null {
  const horizonDays = opts.horizonDays ?? 400;
  const start = Date.parse(`${fromDay}T00:00:00Z`);
  if (!Number.isFinite(start)) return null;

  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  for (let i = 1; i <= horizonDays; i++) {
    const d = new Date(start + i * 86_400_000);
    const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    if (opts.isClosedDay?.(day)) continue;
    if (anySeasonOpen(state, day)) return { day, daysAway: i };
  }
  return null;
}
