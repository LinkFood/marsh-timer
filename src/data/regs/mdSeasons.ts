/**
 * ============================================================================
 *  MARYLAND SEASON WINDOWS — the date→season half of the shooting-hours chain
 *  TRANSCRIBED BY AN AGENT — NOT YET HUMAN-VERIFIED
 * ============================================================================
 *
 *  This file exists because Maryland's shooting hours are NOT one rule. They
 *  are season-scoped, and the season is a function of species and date. See
 *  `shootingHours.ts` for the rules themselves; this file only answers "which
 *  season is a Maryland hunter in on this date".
 *
 *  WHY IT HAD TO BE ITS OWN FILE. The general Maryland rule closes legal light
 *  at SUNSET. Two seasons close it at SUNSET+30. Getting that backwards in
 *  either direction is a defect, but only one direction is dangerous:
 *
 *    showing SUNSET when the law allows SUNSET+30  → costs 30 legal minutes
 *    showing SUNSET+30 when the law says SUNSET    → an illegal shoot
 *
 *  So every ambiguity in this file resolves toward the NARROWER window, and
 *  every unresolvable one refuses. There is no rounding in the hunter's favour.
 *
 * ---------------------------------------------------------------------------
 *  SOURCES — fetched 2026-08-01, each returned the text attributed to it.
 *
 *  [A] MD DNR official digest, "Maryland Migratory Game Bird Seasons and Bag
 *      Limits" (2026-2027), the authority dnr.maryland.gov links to:
 *      https://www.eregulations.com/maryland/hunting/migratory-game-bird-seasons-limits
 *      → Early Resident Canada Goose, Eastern Zone: "Sept. 1, 2026–Sept. 15, 2026"
 *      → Early Resident Canada Goose, Western Zone: "Sept. 1, 2026–Sept. 25, 2026"
 *      → Early Resident Canada Goose shooting hours: "one-half hour before
 *        sunrise to one half hour after sunset"
 *      → Regular Duck, Eastern Zone: "Oct. 10, 2026–Oct. 17, 2026 / Nov. 14,
 *        2026–Nov. 27, 2026 / Dec. 15, 2026–Jan. 30, 2027"
 *      → Regular Duck, Western Zone: "Oct. 3, 2026–Oct. 17, 2026 / Nov. 21,
 *        2026–Nov. 27, 2026 / Dec. 15, 2026–Jan. 30, 2027"
 *      → Ducks/coots, Canada geese (Atlantic Population), Late Southern and
 *        Late Western resident zones: "one-half hour before sunrise to sunset"
 *      → Light Goose Conservation Order: "To Be Determined: check back at the
 *        MD DNR Website in fall 2026 for status"
 *
 *  [B] COMAR 08.03.07.13 "Shooting Hours for Resident Canada Geese in September":
 *      https://regs.maryland.gov/us/md/exec/comar/08.03.07.13
 *      → ".13 Shooting Hours for Resident Canada Geese in September. A person
 *        may hunt resident Canada geese in September from 1/2 hour prior to
 *        sunrise to 1/2 after sunset if this method is allowed in Maryland
 *        pursuant to a final rule adopted by the Department of the Interior,
 *        U.S. Fish and Wildlife Service, as published in the Federal Register
 *        pursuant to 50 CFR 20."
 *      → NOTE WHAT IT DOES AND DOES NOT SAY. It carries NO calendar dates. Its
 *        only date bound is the word "September". The calendar dates come from
 *        [A]. That is why this file cites BOTH: the regulation grants the
 *        extension, the digest bounds it. Neither alone is sufficient, and the
 *        `hunt_seasons` opener row is sufficient for neither — it carries an
 *        `open` with no `close`.
 *
 *  [C] COMAR 08.03.07.12 "Shooting Hours for Light Goose Conservation Order
 *      Season": https://regs.maryland.gov/us/md/exec/comar/08.03.07.12
 *      → "A person may hunt light geese from 1/2 hour prior to sunrise to 1/2
 *        after sunset during the Light Goose Conservation Order season if this
 *        method is allowed in Maryland pursuant to a final rule adopted by the
 *        Department of the Interior, U.S. Fish and Wildlife Service, as
 *        published in the Federal Register pursuant to 50 CFR 21."
 *      → Also carries NO dates, and for 2026-27 [A] says the season's dates are
 *        not published yet. So its bounds CANNOT be established, and this file
 *        says so (`segments: null`) rather than guessing an end date.
 *
 *  [D] The in-repo capture `data/seasons/2026-27.json`, fetched from [A] on
 *      2026-07-25, agrees with [A] on every window below. It is a corroborating
 *      second read of the same authority, not an independent one.
 * ============================================================================
 */

/**
 * The shooting-hours regimes Maryland publishes. A season points at one of
 * these by id; the rules themselves live in `shootingHours.ts` so there is
 * exactly one place a `sunset+30` can be written down.
 */
export type MdHoursRuleId =
  | "md-general"
  | "md-september-resident-canada-goose"
  | "md-light-goose-conservation-order";

/** The species this file has transcribed. Nothing else resolves. */
export const TRANSCRIBED_SPECIES = ["duck", "goose"] as const;
export type TranscribedSpecies = (typeof TRANSCRIBED_SPECIES)[number];

export function isTranscribedSpecies(v: unknown): v is TranscribedSpecies {
  return typeof v === "string" && (TRANSCRIBED_SPECIES as readonly string[]).includes(v);
}

/** One continuous open window, ISO calendar days, both ends INCLUSIVE. */
export interface SeasonSegment {
  readonly open: string;
  readonly close: string;
}

export interface MdSeason {
  readonly id: string;
  readonly species: TranscribedSpecies;
  /** The digest's own zone/season label. Displayed verbatim, never inferred. */
  readonly zone: string;
  /**
   * The published windows, or `null` when the state has NOT published them.
   * `null` is not "no season" — it is "we do not know", and it is handled as a
   * named uncertainty rather than as an absence.
   */
  readonly segments: readonly SeasonSegment[] | null;
  readonly hoursRuleId: MdHoursRuleId;
  /** The URL that publishes these dates. Fetched and confirmed. */
  readonly cite: string;
  readonly verified: string;
  /** MD DNR's own contingency language for 2026-27. Displayed, not internal. */
  readonly provisional: boolean;
  readonly provisionalNote: string | null;
  /** Why the bounds are absent, when they are. */
  readonly boundsNote: string | null;
}

const DIGEST = "https://www.eregulations.com/maryland/hunting/migratory-game-bird-seasons-limits";
const VERIFIED = "2026-08-01";
const USFWS_CONTINGENT =
  "Season dates and bag limits for 2026-2027 are contingent upon approval from the United " +
  "States Fish and Wildlife Service. Check the MD DNR website in September for final dates.";

/**
 * MARYLAND 2026-27. Every window below is quoted in the header from [A].
 *
 * These are SEASONS, not a geographic partition. Maryland's goose seasons
 * overlap and use different zone boundaries from the duck seasons (the digest
 * says so explicitly for the Early Resident zones). So this table must never be
 * read as "the state is in exactly one of these on a given day" — the resolver
 * in `shootingHours.ts` collects EVERY season open on the date and refuses to
 * answer if they disagree about the hours.
 */
export const MD_SEASONS: readonly MdSeason[] = [
  {
    id: "md-duck-eastern",
    species: "duck",
    zone: "Eastern Zone",
    segments: [
      { open: "2026-10-10", close: "2026-10-17" },
      { open: "2026-11-14", close: "2026-11-27" },
      { open: "2026-12-15", close: "2027-01-30" },
    ],
    hoursRuleId: "md-general",
    cite: DIGEST,
    verified: VERIFIED,
    provisional: true,
    provisionalNote: USFWS_CONTINGENT,
    boundsNote: null,
  },
  {
    id: "md-duck-western",
    species: "duck",
    zone: "Western Zone",
    segments: [
      { open: "2026-10-03", close: "2026-10-17" },
      { open: "2026-11-21", close: "2026-11-27" },
      { open: "2026-12-15", close: "2027-01-30" },
    ],
    hoursRuleId: "md-general",
    cite: DIGEST,
    verified: VERIFIED,
    provisional: true,
    provisionalNote: USFWS_CONTINGENT,
    boundsNote: null,
  },
  {
    id: "md-goose-early-resident-eastern",
    species: "goose",
    zone: "Early Resident Canada Goose - Eastern Zone",
    segments: [{ open: "2026-09-01", close: "2026-09-15" }],
    hoursRuleId: "md-september-resident-canada-goose",
    cite: DIGEST,
    verified: VERIFIED,
    provisional: true,
    provisionalNote: USFWS_CONTINGENT,
    boundsNote: null,
  },
  {
    id: "md-goose-early-resident-western",
    species: "goose",
    zone: "Early Resident Canada Goose - Western Zone",
    segments: [{ open: "2026-09-01", close: "2026-09-25" }],
    hoursRuleId: "md-september-resident-canada-goose",
    cite: DIGEST,
    verified: VERIFIED,
    provisional: true,
    provisionalNote: USFWS_CONTINGENT,
    boundsNote: null,
  },
  {
    id: "md-goose-atlantic-population",
    species: "goose",
    zone: "Atlantic Population Hunt Zone",
    segments: [
      { open: "2026-11-24", close: "2026-11-27" },
      { open: "2026-12-15", close: "2027-01-30" },
    ],
    hoursRuleId: "md-general",
    cite: DIGEST,
    verified: VERIFIED,
    provisional: true,
    provisionalNote: USFWS_CONTINGENT,
    boundsNote: null,
  },
  {
    id: "md-goose-late-southern-resident",
    species: "goose",
    zone: "Late Southern Maryland Resident Canada Goose Zone",
    segments: [
      { open: "2026-11-21", close: "2026-11-23" },
      { open: "2026-11-24", close: "2026-11-27" },
      { open: "2026-12-15", close: "2027-01-30" },
      { open: "2027-02-01", close: "2027-03-10" },
    ],
    hoursRuleId: "md-general",
    cite: DIGEST,
    verified: VERIFIED,
    provisional: true,
    provisionalNote: USFWS_CONTINGENT,
    boundsNote: null,
  },
  {
    id: "md-goose-late-western-resident",
    species: "goose",
    zone: "Late Western Maryland Resident Canada Goose Zone",
    segments: [
      { open: "2026-11-21", close: "2026-11-27" },
      { open: "2026-12-15", close: "2027-03-10" },
    ],
    hoursRuleId: "md-general",
    cite: DIGEST,
    verified: VERIFIED,
    provisional: true,
    provisionalNote: USFWS_CONTINGENT,
    boundsNote: null,
  },
  {
    id: "md-goose-light-statewide",
    species: "goose",
    zone: "Light Goose - Statewide",
    segments: [
      { open: "2026-11-07", close: "2026-11-27" },
      { open: "2026-11-30", close: "2027-02-06" },
    ],
    hoursRuleId: "md-general",
    cite: DIGEST,
    verified: VERIFIED,
    provisional: true,
    provisionalNote: USFWS_CONTINGENT,
    boundsNote: null,
  },
  {
    id: "md-goose-light-eastern",
    species: "goose",
    zone: "Light Goose - Eastern Zone",
    segments: [{ open: "2027-02-08", close: "2027-03-10" }],
    hoursRuleId: "md-general",
    cite: DIGEST,
    verified: VERIFIED,
    provisional: true,
    provisionalNote: USFWS_CONTINGENT,
    boundsNote: null,
  },
  {
    id: "md-goose-brant",
    species: "goose",
    zone: "Brant - Statewide",
    segments: [{ open: "2026-12-28", close: "2027-01-30" }],
    hoursRuleId: "md-general",
    cite: DIGEST,
    verified: VERIFIED,
    provisional: true,
    provisionalNote: USFWS_CONTINGENT,
    boundsNote: null,
  },
  {
    // THE ONE WITH NO BOUNDS. COMAR 08.03.07.12 grants this season sunset+30,
    // but Maryland has not published its 2026-27 dates ([A]: "To Be
    // Determined"). So it can never MATCH a date — a season whose bounds are
    // unknown cannot be shown to contain one.
    //
    // That omission is safe in exactly one direction, and it is the safe one:
    // this season's window (sunset+30) is WIDER than the general rule, so a
    // hunter inside an unannounced Conservation Order who follows the general
    // sunset is legal, merely early. The reverse — inferring a Conservation
    // Order window and handing out sunset+30 — is the illegal shoot. The
    // resolver therefore uses this row only to WARN, never to widen.
    id: "md-goose-light-conservation-order",
    species: "goose",
    zone: "Light Goose Conservation Order",
    segments: null,
    hoursRuleId: "md-light-goose-conservation-order",
    cite: DIGEST,
    verified: VERIFIED,
    provisional: true,
    provisionalNote: USFWS_CONTINGENT,
    boundsNote:
      "Maryland has not published 2026-27 Light Goose Conservation Order dates — the digest " +
      "says \"To Be Determined: check back at the MD DNR Website in fall 2026 for status\". " +
      "This app will not invent an end date for it.",
  },
];

/* -------------------------------------------------------------------------- */
/*  DATE HANDLING                                                             */
/* -------------------------------------------------------------------------- */

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A calendar day, as the hunter's own local date. Deliberately string-only:
 * a `Date` here would drag UTC into a question that is purely about which day
 * it is where the hunter is standing, and that shift is how a September 1
 * opener becomes an August 31 refusal.
 */
export function isCalendarDay(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = ISO_DAY.exec(v);
  if (!m) return false;
  const month = Number(m[2]);
  const day = Number(m[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/** Month of an already-validated calendar day, 1-12. */
export function monthOf(day: string): number {
  return Number(day.slice(5, 7));
}

/** Inclusive on both ends, which is how the digest prints its windows. */
export function segmentContains(seg: SeasonSegment, day: string): boolean {
  return day >= seg.open && day <= seg.close;
}

/** Seasons whose bounds are published and which contain `day`. */
export function seasonsOpenOn(
  seasons: readonly MdSeason[],
  species: TranscribedSpecies,
  day: string,
): MdSeason[] {
  return seasons.filter(
    (s) =>
      s.species === species &&
      s.segments !== null &&
      s.segments.some((seg) => segmentContains(seg, day)),
  );
}

/** Seasons for this species whose bounds the state has not published. */
export function seasonsWithUnknownBounds(
  seasons: readonly MdSeason[],
  species: TranscribedSpecies,
): MdSeason[] {
  return seasons.filter((s) => s.species === species && s.segments === null);
}
