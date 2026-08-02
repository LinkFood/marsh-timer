/**
 * ============================================================================
 *  LEGAL SURFACE — TRANSCRIBED BY AN AGENT — NOT YET HUMAN-VERIFIED
 * ============================================================================
 *
 *  A HUMAN MUST CHECK EVERY VALUE IN THIS FILE AGAINST THE PRINTED MARYLAND
 *  MIGRATORY GAME BIRD BOOKLET BEFORE THIS SHIPS TO A HUNTER.
 *
 *  What renders from this table is not a UI hint. It is the line between a
 *  legal shot and a federal citation. The clock a hunter reads at 05:40 in a
 *  marsh is this file. Treat a diff here the way you would treat a diff in a
 *  payments ledger: no "probably", no "close enough", no defaults.
 *
 *  Four rules govern this file, and they are load-bearing:
 *
 *   1. ONE STATE. Maryland only. Every other state is ABSENT — not guessed,
 *      not interpolated from its neighbours, not defaulted to the federal
 *      framework. `lookupShootingHours("DE", …)` returns a REFUSAL, and the
 *      refusal is a different TYPE than a rule, so a caller cannot render a
 *      clock for Delaware even by accident. See `ShootingHoursLookup`.
 *
 *   2. THERE IS NO SINGLE MARYLAND RULE. The general migratory-bird rule closes
 *      legal light at SUNSET. Two seasons close it at SUNSET+30. Which one
 *      applies is a function of SPECIES and DATE, so this module resolves
 *
 *          state + species + date  →  season  →  rule
 *
 *      and will not answer at rule level without the season. The general rule
 *      is not a fallback for "season unknown"; it is one season's rule among
 *      several, reachable only when a season actually selects it.
 *
 *      This was the original bug in both directions. `hunt-atlas-solunar`
 *      (~line 440) hard-codes `sunsetMin + 30` for everything — wrong for the
 *      regular duck season, RIGHT for the September resident goose season.
 *      The first version of this file swung the other way and hard-coded
 *      sunset+0 for everything, which is wrong on 2026-09-01, the exact date
 *      this app is being field-tested on. Neither number is universally
 *      correct. Do not collapse this back to one number.
 *
 *   3. ASYMMETRIC FAILURE — ALWAYS ERR NARROW.
 *
 *          showing SUNSET when the law allows SUNSET+30 → costs 30 legal minutes
 *          showing SUNSET+30 when the law says SUNSET   → an illegal shoot
 *
 *      Both are defects; only one is dangerous. So when the season cannot be
 *      determined, this module returns the NARROWEST rule the state publishes,
 *      under a status that is NOT `"transcribed"` and that carries a sentence
 *      saying why. It never widens on a guess.
 *
 *   4. NO FALLBACK, EVER. There is no `DEFAULT` state entry and there must
 *      never be one. A wrong shooting-hours rule is worse than no rule, because
 *      a missing clock sends the hunter to the printed booklet and a wrong clock
 *      does not.
 *
 * ---------------------------------------------------------------------------
 *  SOURCES — every URL below was fetched on 2026-08-01 and returned the text
 *  attributed to it. Season DATE bounds and their sources live in
 *  `./mdSeasons.ts`; this header covers the HOURS.
 *
 *  [1] MD DNR official digest, "Maryland Migratory Game Bird Seasons and Bag
 *      Limits" (the guide dnr.maryland.gov links to as the authority):
 *      https://www.eregulations.com/maryland/hunting/migratory-game-bird-seasons-limits
 *      → Ducks/coots: "one-half hour before sunrise to sunset"
 *      → Canada geese (Atlantic Population), Late Southern and Late Western
 *        resident zones: "one-half hour before sunrise to sunset"
 *      → Early Resident Canada Goose (September): "one-half hour before sunrise
 *        to one half hour after sunset"
 *      → This is also the URL already stored in `hunt_regulation_links` for
 *        MD / duck and MD / goose, so the app and the table agree.
 *
 *  [2] MD DNR waterfowl landing page (official dnr.maryland.gov domain):
 *      https://dnr.maryland.gov/wildlife/Pages/hunt_trap/waterfowl.aspx
 *      → Confirms DNR publishes [1] as the authority, and points hunters at
 *        50 CFR Part 20 for the federal rules. Does NOT itself state the hours.
 *
 *  [3] 50 CFR 20.23 "Shooting hours" (govinfo, authoritative XML):
 *      https://www.govinfo.gov/content/pkg/CFR-2024-title50-vol9/xml/CFR-2024-title50-vol9-sec20-23.xml
 *      → "No person shall take migratory game birds except during the hours
 *        open to shooting as prescribed in subpart K of this part and 50 CFR
 *        21.180 and 21.183 of this chapter."
 *      → Establishes that shooting hours are federally controlled; the numbers
 *        themselves come from the annual frameworks the state adopts.
 *
 *  [4] COMAR 08.03.07.13 "Shooting Hours for Resident Canada Geese in September":
 *      https://regs.maryland.gov/us/md/exec/comar/08.03.07.13
 *      → "A person may hunt resident Canada geese in September from 1/2 hour
 *        prior to sunrise to 1/2 after sunset ..."
 *
 *  [5] COMAR 08.03.07.12 "Shooting Hours for Light Goose Conservation Order
 *      Season": https://regs.maryland.gov/us/md/exec/comar/08.03.07.12
 *      → "A person may hunt light geese from 1/2 hour prior to sunrise to 1/2
 *        after sunset during the Light Goose Conservation Order season ..."
 *
 *  The negative-space argument still holds and is worth keeping: [4] and [5]
 *  exist *specifically to grant* a sunset+30 extension for two narrow seasons.
 *  They would be unnecessary if the regular season already ran to sunset+30.
 *  Their existence is the strongest evidence that [1]'s sunset+0 is the general
 *  rule — and their scope is the reason sunset+30 must not leak past it.
 *
 *  CARVE-OUTS FOUND AND DELIBERATELY NOT IMPLEMENTED — see `NOT_IMPLEMENTED`
 *  at the foot of this file. They are recorded so the next reader does not have
 *  to rediscover them, and so nobody mistakes silence for absence.
 * ============================================================================
 */

import {
  MD_SEASONS,
  TRANSCRIBED_SPECIES,
  isCalendarDay,
  isTranscribedSpecies,
  monthOf,
  seasonsOpenOn,
  seasonsWithUnknownBounds,
  type MdHoursRuleId,
  type MdSeason,
  type TranscribedSpecies,
} from "./mdSeasons";

export type { MdHoursRuleId, MdSeason, TranscribedSpecies };
export { TRANSCRIBED_SPECIES, isTranscribedSpecies };

/**
 * The states we have actually transcribed. Adding to this list means: fetch the
 * state's own authority, quote it, date it, transcribe its SEASON WINDOWS as
 * well as its hours, and get a human to check the booklet. It does not mean
 * "copy Maryland's row".
 */
export const TRANSCRIBED_STATES = ["MD"] as const;

export type TranscribedState = (typeof TRANSCRIBED_STATES)[number];

/**
 * A solar-anchored offset, written the way the booklet writes it so a human
 * proofreading this file against print is comparing like with like.
 *
 * `sunrise-30` = thirty minutes BEFORE sunrise. `sunset+0` = at sunset.
 * The literal string is the source of truth; the minute count is derived from
 * it by `parseSolarOffset`, never typed in twice.
 */
export type SolarOffset = `sunrise${"+" | "-"}${number}` | `sunset${"+" | "-"}${number}`;

export type SolarAnchor = "sunrise" | "sunset";

export interface ShootingHoursRule {
  /** Stable id, so a season can point at a rule without restating it. */
  readonly id: MdHoursRuleId;
  /** Which regime this is, in the state's own words. */
  readonly season: string;
  /** Opening of legal shooting light, as an offset from sunrise. */
  readonly start: SolarOffset;
  /** Close of legal shooting light, as an offset from sunset. */
  readonly end: SolarOffset;
  /** The URL that states this rule in these words. Fetched and confirmed. */
  readonly cite: string;
  /** ISO date the cite was last fetched and read by a human or agent. */
  readonly verified: string;
  /** Plain-language note the hunter can act on. */
  readonly note: string;
  /** Corroborating authorities. Fetched and confirmed; see file header. */
  readonly corroboration: readonly string[];
  /**
   * The narrow seasons whose hours differ from this one. Unlike the first
   * version of this file, these are no longer inert: each is a real rule below
   * and the resolver APPLIES it when the season selects it. They stay listed
   * here so a surface rendering the general rule can name what it is not.
   */
  readonly exceptions: readonly {
    readonly season: string;
    readonly hours: string;
    readonly cite: string;
  }[];
}

const DIGEST = "https://www.eregulations.com/maryland/hunting/migratory-game-bird-seasons-limits";
const VERIFIED = "2026-08-01";
const CORROBORATION = [
  "https://dnr.maryland.gov/wildlife/Pages/hunt_trap/waterfowl.aspx",
  "https://www.govinfo.gov/content/pkg/CFR-2024-title50-vol9/xml/CFR-2024-title50-vol9-sec20-23.xml",
] as const;

const COMAR_13 = "https://regs.maryland.gov/us/md/exec/comar/08.03.07.13";
const COMAR_12 = "https://regs.maryland.gov/us/md/exec/comar/08.03.07.12";

const MD_CARVE_OUTS = [
  {
    season: "September resident Canada goose season",
    hours: "one-half hour before sunrise to one-half hour after sunset",
    cite: COMAR_13,
  },
  {
    season: "Light Goose Conservation Order season",
    hours: "one-half hour before sunrise to one-half hour after sunset",
    cite: COMAR_12,
  },
] as const;

const MD_RULES: Readonly<Record<MdHoursRuleId, ShootingHoursRule>> = {
  "md-general": {
    id: "md-general",
    season: "Maryland regular duck and goose seasons",
    start: "sunrise-30",
    end: "sunset+0",
    cite: DIGEST,
    verified: VERIFIED,
    note:
      "Maryland migratory game birds (ducks and geese), regular seasons: one-half hour " +
      "before sunrise to sunset. Legal light ENDS AT SUNSET — there is no half-hour of " +
      "grace in the evening. The morning half-hour is not a courtesy either; it is the " +
      "rule. Times are local and vary by location, so they must be computed for the " +
      "hunter's own coordinates, never for the state centroid.",
    corroboration: CORROBORATION,
    exceptions: MD_CARVE_OUTS,
  },
  "md-september-resident-canada-goose": {
    id: "md-september-resident-canada-goose",
    season: "September resident Canada goose season",
    start: "sunrise-30",
    end: "sunset+30",
    cite: COMAR_13,
    verified: VERIFIED,
    note:
      "September resident Canada goose season ONLY: one-half hour before sunrise to " +
      "one-half hour AFTER sunset. This is the one Maryland waterfowl season with " +
      "evening grace, granted by COMAR 08.03.07.13, and it ends when the September " +
      "season ends. The regular duck and goose seasons close at sunset.",
    corroboration: [DIGEST, ...CORROBORATION],
    exceptions: [],
  },
  "md-light-goose-conservation-order": {
    id: "md-light-goose-conservation-order",
    season: "Light Goose Conservation Order season",
    start: "sunrise-30",
    end: "sunset+30",
    cite: COMAR_12,
    verified: VERIFIED,
    note:
      "Light Goose Conservation Order season ONLY: one-half hour before sunrise to " +
      "one-half hour AFTER sunset, granted by COMAR 08.03.07.12. Maryland has not " +
      "published 2026-27 Conservation Order dates, so this app will never select this " +
      "rule for you — it cannot know when the season runs, and guessing an end date " +
      "here is the shot that gets written up.",
    corroboration: [DIGEST, ...CORROBORATION],
    exceptions: [],
  },
};

/**
 * Everything transcribed for one state. `narrowestRuleId` is not derived at
 * runtime on purpose: it is a claim about the state's published rules that a
 * human can check against the booklet in one glance, and the `narrowestIsReallyNarrowest`
 * test proves the claim against the table rather than trusting it.
 */
interface StateRegs {
  readonly rules: Readonly<Record<MdHoursRuleId, ShootingHoursRule>>;
  readonly seasons: readonly MdSeason[];
  /**
   * The narrowest window this state grants any transcribed species. Used ONLY
   * when the season cannot be determined, and never as a default answer.
   */
  readonly narrowestRuleId: MdHoursRuleId;
}

/**
 * MARYLAND ONLY. Do not add a row without doing the full transcription pass.
 * Do not add a `DEFAULT`.
 */
const SHOOTING_HOURS: Readonly<Record<TranscribedState, StateRegs>> = {
  MD: {
    rules: MD_RULES,
    seasons: MD_SEASONS,
    narrowestRuleId: "md-general",
  },
};

/* -------------------------------------------------------------------------- */
/*  THE REFUSAL                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Why a lookup refused, or why it narrowed. Kept as a closed union so a caller
 * can branch on cause without string-matching a message.
 */
export type RefusalReason =
  | "not-transcribed"
  | "malformed-state"
  | "no-sun-times"
  /** Species missing, or one this table has not transcribed (e.g. dove). */
  | "species-not-transcribed"
  /** Not enough given to pick a season, or the open seasons disagree. */
  | "season-undetermined"
  /** A season was asked for on a date Maryland publishes no open season for. */
  | "no-open-season"
  /** The state grants this species a season whose dates it has not published. */
  | "season-bounds-unpublished";

/** What a caller supplies so the module can identify the season. */
export interface SeasonQuery {
  /** "duck" | "goose". Anything else refuses rather than approximating. */
  readonly species?: unknown;
  /** The hunter's own LOCAL calendar day, `YYYY-MM-DD`. Never a `Date`. */
  readonly date?: unknown;
  /**
   * Optional. The digest's own zone label, e.g.
   * "Early Resident Canada Goose - Eastern Zone". Supplying it narrows the
   * answer to that season; omitting it means every season open on that date is
   * considered and disagreement is reported rather than resolved.
   */
  readonly zone?: unknown;
}

/** The season this lookup landed in. Present only on a `transcribed` result. */
export interface ResolvedSeason {
  readonly species: TranscribedSpecies;
  readonly date: string;
  /** Every season open on that date, by the digest's own labels. */
  readonly zones: readonly string[];
  readonly seasonIds: readonly string[];
  /** MD DNR's own contingency language, when the dates are provisional. */
  readonly provisional: boolean;
  readonly provisionalNote: string | null;
  /** The URL that publishes these dates. */
  readonly cite: string;
}

/**
 * The result of asking this table about a state, species and date.
 *
 * THIS IS THE SAFETY MECHANISM, and it works because of what is ABSENT from
 * the refusal branch: there is no `rule` property on it. TypeScript will not
 * let a caller write `lookupShootingHours(st).rule` at all — property access
 * on a union requires the property to exist on every member. The only way to
 * reach a rule is to narrow on `status` first, which is exactly the check that
 * keeps a Delaware clock off the screen.
 *
 * There is deliberately no `rule: ShootingHoursRule | null`, and no optional
 * `rule?`. Both of those would compile at the call site and blow up (or worse,
 * render zeros) at 05:40 in a marsh.
 *
 * THE THIRD BRANCH IS NEW AND IT IS THE POINT. `"narrowed"` means: the state is
 * transcribed, but the SEASON is not determined, so what you are holding is the
 * narrowest window Maryland publishes rather than your season's window. It
 * carries a rule (a hunter inside it is legal in every Maryland waterfowl
 * season) AND a message (so the surface must say why it is narrow). It is not
 * `"transcribed"`, so nothing that only accepts a confirmed rule will take it,
 * and a caller cannot silently receive the general rule when a season-specific
 * one applies.
 */
export type ShootingHoursLookup =
  | {
      readonly status: "transcribed";
      readonly state: TranscribedState;
      readonly rule: ShootingHoursRule;
      readonly season: ResolvedSeason;
    }
  | {
      readonly status: "narrowed";
      readonly state: TranscribedState;
      readonly reason: RefusalReason;
      /** Sentence that can be shown to the hunter verbatim. */
      readonly message: string;
      /** The NARROWEST rule available. Never the widest, never a guess. */
      readonly rule: ShootingHoursRule;
      /** The candidate rules this was narrowed from, by id. */
      readonly narrowedFrom: readonly MdHoursRuleId[];
    }
  | {
      readonly status: "refused";
      readonly state: string;
      readonly reason: RefusalReason;
      /** Sentence that can be shown to the hunter verbatim. */
      readonly message: string;
    };

export function isTranscribedState(value: unknown): value is TranscribedState {
  return typeof value === "string" && (TRANSCRIBED_STATES as readonly string[]).includes(value);
}

/* -------------------------------------------------------------------------- */
/*  OFFSET PARSING                                                            */
/* -------------------------------------------------------------------------- */

export interface ParsedOffset {
  readonly anchor: SolarAnchor;
  /** Signed minutes from the anchor. `sunrise-30` → -30. `sunset+0` → 0. */
  readonly minutes: number;
}

/**
 * Parse `"sunrise-30"` / `"sunset+0"` into an anchor and signed minutes.
 *
 * Returns `null` on anything it does not fully understand. No partial parses,
 * no `?? 0` — an unreadable rule is not a zero-minute rule.
 */
export function parseSolarOffset(offset: string): ParsedOffset | null {
  const m = /^(sunrise|sunset)([+-])(\d{1,3})$/.exec(offset);
  if (!m) return null;
  const minutes = Number(m[3]);
  if (!Number.isFinite(minutes)) return null;
  return { anchor: m[1] as SolarAnchor, minutes: m[2] === "-" ? -minutes : minutes };
}

/* -------------------------------------------------------------------------- */
/*  NARROWNESS                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Is `a` no wider than `b` at both ends?
 *
 * Narrower means opening LATER and closing EARLIER. Rules with different solar
 * anchors are not comparable and return `false`, which pushes the caller into
 * a refusal rather than into a made-up ordering.
 */
export function isNoWiderThan(a: ShootingHoursRule, b: ShootingHoursRule): boolean {
  const as = parseSolarOffset(a.start);
  const ae = parseSolarOffset(a.end);
  const bs = parseSolarOffset(b.start);
  const be = parseSolarOffset(b.end);
  if (!as || !ae || !bs || !be) return false;
  if (as.anchor !== bs.anchor || ae.anchor !== be.anchor) return false;
  return as.minutes >= bs.minutes && ae.minutes <= be.minutes;
}

/**
 * The one candidate that is no wider than every other candidate.
 *
 * Returns `null` when no candidate dominates — two rules that cross (one opens
 * later, the other closes earlier) have no narrowest MEMBER, and this function
 * will not synthesise their intersection. A fabricated rule is exactly the
 * thing this file exists to prevent, so the caller refuses instead.
 */
export function narrowestRule(candidates: readonly ShootingHoursRule[]): ShootingHoursRule | null {
  if (candidates.length === 0) return null;
  for (const c of candidates) {
    if (candidates.every((other) => isNoWiderThan(c, other))) return c;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  THE DOOR                                                                  */
/* -------------------------------------------------------------------------- */

function narrowed(
  state: TranscribedState,
  reason: RefusalReason,
  message: string,
  candidates: readonly MdHoursRuleId[],
): ShootingHoursLookup {
  const regs = SHOOTING_HOURS[state];
  const rules = candidates.map((id) => regs.rules[id]);
  const pick = narrowestRule(rules) ?? regs.rules[regs.narrowestRuleId];
  return {
    status: "narrowed",
    state,
    reason,
    message,
    rule: pick,
    narrowedFrom: candidates.length > 0 ? candidates : [regs.narrowestRuleId],
  };
}

/**
 * THE ONLY DOOR into the table.
 *
 * Never throws, never falls back, never guesses. Resolution runs
 * `state → species → date → season → rule`, and every step that cannot be
 * completed produces a typed outcome rather than a plausible one:
 *
 *   unknown state            → refused,  `not-transcribed`
 *   unknown species          → refused,  `species-not-transcribed`
 *   species/date omitted     → narrowed, `season-undetermined`
 *   malformed date           → refused,  `season-undetermined`
 *   date in no open season   → refused,  `no-open-season`
 *                              (or `season-bounds-unpublished` when Maryland
 *                               grants this species a season whose dates it has
 *                               not published — the honest "we cannot say")
 *   open seasons disagree    → narrowed, `season-undetermined`
 *   exactly one regime       → transcribed
 *
 * @example
 *   lookupShootingHours("MD", { species: "goose", date: "2026-09-01" })
 *   // → transcribed, sunrise-30 → sunset+30, cited to COMAR 08.03.07.13
 */
export function lookupShootingHours(state: unknown, query?: SeasonQuery): ShootingHoursLookup {
  if (typeof state !== "string" || !/^[A-Za-z]{2}$/.test(state)) {
    return {
      status: "refused",
      state: typeof state === "string" ? state : "",
      reason: "malformed-state",
      message:
        "No state given. Shooting hours are state law — this app will not show a clock " +
        "without knowing which state you are standing in.",
    };
  }

  const abbr = state.toUpperCase();

  if (!isTranscribedState(abbr)) {
    return {
      status: "refused",
      state: abbr,
      reason: "not-transcribed",
      message:
        `Shooting hours for ${abbr} have not been transcribed from that state's own ` +
        `regulations. This app will not guess them. Check ${abbr}'s printed migratory ` +
        `game bird booklet. (Transcribed so far: ${TRANSCRIBED_STATES.join(", ")}.)`,
    };
  }

  const regs = SHOOTING_HOURS[abbr];
  const rawSpecies = query?.species;
  const rawDate = query?.date;

  // ---- SPECIES -----------------------------------------------------------
  if (rawSpecies === undefined || rawSpecies === null || rawSpecies === "") {
    return narrowed(
      abbr,
      "season-undetermined",
      "Which bird you are after decides your shooting hours in Maryland — the September " +
        "resident Canada goose season runs to one-half hour after sunset, the regular duck " +
        "and goose seasons stop at sunset. Without the species this app shows the SHORTER " +
        "window, which is legal in every Maryland waterfowl season.",
      [regs.narrowestRuleId],
    );
  }

  const species = typeof rawSpecies === "string" ? rawSpecies.toLowerCase() : rawSpecies;
  if (!isTranscribedSpecies(species)) {
    return {
      status: "refused",
      state: abbr,
      reason: "species-not-transcribed",
      message:
        `Shooting hours for "${String(rawSpecies)}" in ${abbr} have not been transcribed. ` +
        `Only ${TRANSCRIBED_SPECIES.join(" and ")} are. Maryland publishes genuinely ` +
        `different hours for other birds — mourning dove runs 12 noon to sunset — so this ` +
        `app will not reuse the waterfowl clock for them. Check the printed booklet.`,
    };
  }

  // ---- DATE --------------------------------------------------------------
  if (rawDate === undefined || rawDate === null || rawDate === "") {
    return narrowed(
      abbr,
      "season-undetermined",
      "The date decides your shooting hours in Maryland — the September resident Canada " +
        "goose season runs to one-half hour after sunset, every other duck and goose season " +
        "stops at sunset. Without a date this app shows the SHORTER window, which is legal " +
        "in every Maryland waterfowl season.",
      [regs.narrowestRuleId],
    );
  }

  if (!isCalendarDay(rawDate)) {
    return {
      status: "refused",
      state: abbr,
      reason: "season-undetermined",
      message:
        `"${String(rawDate)}" is not a calendar day this app can read (expected YYYY-MM-DD, ` +
        `the hunter's own local date). Without a readable date the season cannot be ` +
        `identified, and no clock is shown rather than a wrong one.`,
    };
  }
  const date = rawDate;

  // ---- ZONE (optional) ---------------------------------------------------
  let pool = regs.seasons.filter((s) => s.species === species);
  if (zoneIsGiven(query)) {
    const wanted = String(query?.zone).trim().toLowerCase();
    const zoned = pool.filter((s) => s.zone.toLowerCase() === wanted);
    if (zoned.length === 0) {
      return {
        status: "refused",
        state: abbr,
        reason: "no-open-season",
        message:
          `${abbr} publishes no ${species} season called "${String(query?.zone)}". The zones ` +
          `this app has transcribed are: ${pool.map((s) => s.zone).join("; ")}. Nothing is ` +
          `shown for a zone we cannot name.`,
      };
    }
    pool = zoned;
  }

  // ---- SEASON ------------------------------------------------------------
  const open = seasonsOpenOn(pool, species, date);

  if (open.length === 0) {
    const unpublished = seasonsWithUnknownBounds(pool, species);
    if (unpublished.length > 0) {
      return {
        status: "refused",
        state: abbr,
        reason: "season-bounds-unpublished",
        message:
          `${abbr} publishes no open ${species} season on ${date} among the seasons whose ` +
          `dates it has released — but it also grants a season whose dates it has NOT ` +
          `released: ${unpublished.map((s) => s.zone).join("; ")}. ` +
          `${unpublished.map((s) => s.boundsNote ?? "").join(" ")} ` +
          `So this app cannot tell you whether you are in a season, and shows no clock.`,
      };
    }
    return {
      status: "refused",
      state: abbr,
      reason: "no-open-season",
      message:
        `${abbr} has no open ${species} season on ${date} in the 2026-27 dates this app has ` +
        `transcribed. Shooting hours only mean something inside a season, so none are shown. ` +
        `Season dates are provisional until the U.S. Fish and Wildlife Service signs off — ` +
        `check the MD DNR digest.`,
    };
  }

  // COMAR 08.03.07.13 grants its extension to resident Canada geese "in
  // September" — the regulation's only date bound is the month itself. Every
  // published segment currently sits inside September, so this guard changes
  // nothing today; it is here so that a future date edit which pushes a
  // September season into October cannot carry sunset+30 out of the month the
  // regulation names.
  const ruleIds: MdHoursRuleId[] = [];
  for (const s of open) {
    const id =
      s.hoursRuleId === "md-september-resident-canada-goose" && monthOf(date) !== 9
        ? "md-general"
        : s.hoursRuleId;
    if (!ruleIds.includes(id)) ruleIds.push(id);
  }

  if (ruleIds.length > 1) {
    return narrowed(
      abbr,
      "season-undetermined",
      `More than one ${species} season is open in ${abbr} on ${date} and they do not agree ` +
        `on shooting hours (${open.map((s) => s.zone).join("; ")}). Without knowing which ` +
        `zone you are standing in, this app shows the SHORTER window — it is legal in all ` +
        `of them. Name your zone, or read the printed booklet, to get the longer one.`,
      ruleIds,
    );
  }

  const rule = regs.rules[ruleIds[0]];
  return {
    status: "transcribed",
    state: abbr,
    rule,
    season: {
      species,
      date,
      zones: open.map((s) => s.zone),
      seasonIds: open.map((s) => s.id),
      provisional: open.some((s) => s.provisional),
      provisionalNote: open.find((s) => s.provisionalNote)?.provisionalNote ?? null,
      cite: open[0].cite,
    },
  };
}

/** A zone was actually supplied (not just an absent key or an empty string). */
function zoneIsGiven(query: SeasonQuery | undefined): boolean {
  const z = query?.zone;
  return typeof z === "string" && z.trim() !== "";
}

/* -------------------------------------------------------------------------- */
/*  THE WINDOW                                                                */
/* -------------------------------------------------------------------------- */

/** Sunrise/sunset for the hunter's own coordinates, as minutes after local midnight. */
export interface SunTimes {
  readonly sunriseMin: number;
  readonly sunsetMin: number;
}

export type ShootingWindow =
  | {
      readonly status: "ok";
      readonly state: TranscribedState;
      /** Minutes after local midnight when legal light opens. */
      readonly openMin: number;
      /** Minutes after local midnight when legal light closes. */
      readonly closeMin: number;
      readonly rule: ShootingHoursRule;
      readonly season: ResolvedSeason;
    }
  | {
      readonly status: "narrowed";
      readonly state: TranscribedState;
      readonly openMin: number;
      readonly closeMin: number;
      readonly rule: ShootingHoursRule;
      readonly reason: RefusalReason;
      readonly message: string;
    }
  | {
      readonly status: "refused";
      readonly reason: RefusalReason;
      readonly message: string;
    };

/**
 * Turn a lookup into wall-clock minutes.
 *
 * Note the signature: this takes the LOOKUP, not a bare `ShootingHoursRule`.
 * That is on purpose. It means the refusal cannot be routed around — there is
 * no exported path that accepts a rule directly, so a caller cannot construct
 * a plausible-looking rule for a state we never transcribed, or for a season a
 * hunter is not in, and feed it in.
 *
 * A `narrowed` lookup produces a `narrowed` window, never an `ok` one. The
 * numbers are real and safe to shoot inside; the status is what stops a surface
 * printing them as though the season were known.
 *
 * Sun times are guarded with `Number.isFinite`. A missing sunset is not
 * midnight; it is a refusal.
 */
export function resolveShootingWindow(
  lookup: ShootingHoursLookup,
  sun: SunTimes | null | undefined,
): ShootingWindow {
  if (lookup.status === "refused") {
    return { status: "refused", reason: lookup.reason, message: lookup.message };
  }

  if (!sun || !Number.isFinite(sun.sunriseMin) || !Number.isFinite(sun.sunsetMin)) {
    return {
      status: "refused",
      reason: "no-sun-times",
      message:
        "Sunrise and sunset for this spot are not available, so legal light cannot be " +
        "computed. No clock is shown rather than a wrong one.",
    };
  }

  const start = parseSolarOffset(lookup.rule.start);
  const end = parseSolarOffset(lookup.rule.end);
  if (!start || !end) {
    return {
      status: "refused",
      reason: "not-transcribed",
      message:
        "The stored shooting-hours rule for this state could not be read. This is a bug " +
        "in the rule table, not a rule about your season — use the printed booklet.",
    };
  }

  const anchorFor = (a: SolarAnchor) => (a === "sunrise" ? sun.sunriseMin : sun.sunsetMin);
  const openMin = anchorFor(start.anchor) + start.minutes;
  const closeMin = anchorFor(end.anchor) + end.minutes;

  if (lookup.status === "narrowed") {
    return {
      status: "narrowed",
      state: lookup.state,
      openMin,
      closeMin,
      rule: lookup.rule,
      reason: lookup.reason,
      message: lookup.message,
    };
  }

  return {
    status: "ok",
    state: lookup.state,
    openMin,
    closeMin,
    rule: lookup.rule,
    season: lookup.season,
  };
}

/* -------------------------------------------------------------------------- */
/*  FOUND, NOT BUILT                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Maryland carve-outs read out of source [1] on 2026-08-01 and deliberately
 * NOT implemented. Listed so the next reader does not have to rediscover them,
 * and so that silence is never mistaken for absence. None of them can widen an
 * answer this module gives — every one either applies to a species this table
 * refuses, or is no wider than `md-general`.
 */
export const NOT_IMPLEMENTED = [
  {
    what: "Mourning dove",
    hours: "12 noon to sunset (Sept. 1 - Oct. 17 segment)",
    why:
      "A different species with a genuinely different clock. `species` refuses anything " +
      "outside duck and goose, so this can never be answered with the waterfowl rule.",
    cite: DIGEST,
  },
  {
    what: "Falconry",
    hours: "one-half hour before sunrise to sunset, Monday through Saturday",
    why:
      "A method carve-out, not a season carve-out, and this module takes no method input. " +
      "It is no wider than `md-general` at either end, so a falconer reading the general " +
      "rule is never sent past legal light — only possibly onto a closed day.",
    cite: DIGEST,
  },
  {
    what: "Sunday waterfowl hunting",
    hours: "n/a — a closed DAY, not different hours",
    why:
      "The digest notes Sunday waterfowl hunting is not permitted, which is why Maryland's " +
      "69 calendar days span 60 huntable ones. That is a question about whether the season " +
      "is open at all, not about where legal light falls, and it belongs to whatever surface " +
      "answers 'can I hunt today'. Named here because a hunter shown legal light on a closed " +
      "Sunday is being shown something true about the sun and misleading about the law.",
    cite: DIGEST,
  },
  {
    what: "Youth / Veteran / Military days (Nov. 7 2026, Feb. 6 2027)",
    hours: "one-half hour before sunrise to sunset",
    why:
      "Same hours as `md-general`, so there is nothing to apply. They are separate SEASONS " +
      "though, and are not in `MD_SEASONS` — a hunter on one of those days gets a " +
      "`no-open-season` refusal rather than a wrong clock.",
    cite: DIGEST,
  },
] as const;
