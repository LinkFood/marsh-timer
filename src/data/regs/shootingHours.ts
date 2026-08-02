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
 *  Three rules govern this file, and they are load-bearing:
 *
 *   1. ONE STATE. Maryland only. Every other state is ABSENT — not guessed,
 *      not interpolated from its neighbours, not defaulted to the federal
 *      framework. `lookupShootingHours("DE")` returns a REFUSAL, and the
 *      refusal is a different TYPE than a rule, so a caller cannot render a
 *      clock for Delaware even by accident. See `ShootingHoursLookup`.
 *
 *   2. END OF LEGAL LIGHT IS **SUNSET**, NOT SUNSET+30.
 *      The federal migratory-bird frameworks close legal shooting light at
 *      sunset. Maryland adopts that. The half-hour of grace exists only at the
 *      MORNING end (sunrise-30).
 *
 *      This is worth stating loudly because this repo already contains the
 *      wrong version of it. `supabase/functions/hunt-atlas-solunar/index.ts`
 *      (~line 440) computes `shootingEnd = sunsetMin + 30`. That edge function
 *      is WRONG and is being deliberately left behind, not repaired here — it
 *      has its own consumers and its own blast radius. Nothing in this file
 *      imports it, and nothing that imports this file should fall back to it.
 *
 *      The strongest evidence that sunset+0 is the regular-season rule is
 *      negative space in Maryland's own code: COMAR 08.03.07.12 and .13 exist
 *      *specifically to grant* a sunset+30 extension, and only for two narrow
 *      seasons (the Light Goose Conservation Order, and September resident
 *      Canada geese). Those two regulations would be unnecessary if the
 *      regular season already ran to sunset+30. They are cited below.
 *
 *   3. NO FALLBACK, EVER. There is no `DEFAULT` entry and there must never be
 *      one. A wrong shooting-hours rule is worse than no rule, because a
 *      missing clock sends the hunter to the printed booklet and a wrong clock
 *      does not.
 *
 * ---------------------------------------------------------------------------
 *  SOURCES — every URL below was fetched on 2026-08-01 and returned the text
 *  attributed to it. What each one actually establishes:
 *
 *  [1] MD DNR official digest, "Maryland Migratory Game Bird Seasons and Bag
 *      Limits" (the guide dnr.maryland.gov links to as the authority):
 *      https://www.eregulations.com/maryland/hunting/migratory-game-bird-seasons-limits
 *      → States shooting hours for ducks and geese as
 *        "one-half hour before sunrise to sunset".
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
 *        prior to sunrise to 1/2 after sunset"
 *
 *  [5] COMAR 08.03.07.12 "Shooting Hours for Light Goose Conservation Order Season":
 *      https://regs.maryland.gov/us/md/exec/comar/08.03.07.12
 *      → "A person may hunt light geese from 1/2 hour prior to sunrise to 1/2
 *        after sunset during the Light Goose Conservation Order season ..."
 *
 *  [4] and [5] are the two carve-outs. They are recorded in `exceptions` below
 *  as DATA, not as behaviour: this module does not decide which season a hunter
 *  is in, and it must never silently apply an extension. It surfaces the
 *  carve-outs as text so the hunter can recognise their own season and go read
 *  the booklet.
 * ============================================================================
 */

/**
 * The states we have actually transcribed. Adding to this list means: fetch the
 * state's own authority, quote it, date it, and get a human to check the
 * booklet. It does not mean "copy Maryland's row".
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
   * Narrow seasons where the state's own code grants different hours. DATA
   * ONLY — this module never applies them. If a hunter's season appears here,
   * the answer is the booklet, not this file.
   */
  readonly exceptions: readonly {
    readonly season: string;
    readonly hours: string;
    readonly cite: string;
  }[];
}

/**
 * MARYLAND ONLY. Do not add a row without doing the full transcription pass.
 * Do not add a `DEFAULT`.
 */
const SHOOTING_HOURS: Readonly<Record<TranscribedState, ShootingHoursRule>> = {
  MD: {
    start: "sunrise-30",
    end: "sunset+0",
    cite: "https://www.eregulations.com/maryland/hunting/migratory-game-bird-seasons-limits",
    verified: "2026-08-01",
    note:
      "Maryland migratory game birds (ducks and geese), regular seasons: one-half hour " +
      "before sunrise to sunset. Legal light ENDS AT SUNSET — there is no half-hour of " +
      "grace in the evening. The morning half-hour is not a courtesy either; it is the " +
      "rule. Times are local and vary by location, so they must be computed for the " +
      "hunter's own coordinates, never for the state centroid.",
    corroboration: [
      "https://dnr.maryland.gov/wildlife/Pages/hunt_trap/waterfowl.aspx",
      "https://www.govinfo.gov/content/pkg/CFR-2024-title50-vol9/xml/CFR-2024-title50-vol9-sec20-23.xml",
    ],
    exceptions: [
      {
        season: "September resident Canada goose season",
        hours: "one-half hour before sunrise to one-half hour after sunset",
        cite: "https://regs.maryland.gov/us/md/exec/comar/08.03.07.13",
      },
      {
        season: "Light Goose Conservation Order season",
        hours: "one-half hour before sunrise to one-half hour after sunset",
        cite: "https://regs.maryland.gov/us/md/exec/comar/08.03.07.12",
      },
    ],
  },
};

/* -------------------------------------------------------------------------- */
/*  THE REFUSAL                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Why a lookup refused. Kept as a closed union so a caller can branch on cause
 * without string-matching a message.
 */
export type RefusalReason =
  | "not-transcribed"
  | "malformed-state"
  | "no-sun-times";

/**
 * The result of asking this table about a state.
 *
 * THIS IS THE SAFETY MECHANISM, and it works because of what is ABSENT from
 * the refusal branch: there is no `rule` property on it. TypeScript will not
 * let a caller write `lookupShootingHours(st).rule` at all — property access
 * on a union requires the property to exist on every member. The only way to
 * reach a rule is to narrow on `status === "transcribed"` first, which is
 * exactly the check that keeps a Delaware clock off the screen.
 *
 * There is deliberately no `rule: ShootingHoursRule | null`, and no optional
 * `rule?`. Both of those would compile at the call site and blow up (or worse,
 * render zeros) at 05:40 in a marsh.
 */
export type ShootingHoursLookup =
  | {
      readonly status: "transcribed";
      readonly state: TranscribedState;
      readonly rule: ShootingHoursRule;
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

/**
 * The ONLY door into the table.
 *
 * Never throws, never falls back, never guesses. An unknown state comes back
 * as a refusal carrying a sentence the hunter can read.
 */
export function lookupShootingHours(state: unknown): ShootingHoursLookup {
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

  return { status: "transcribed", state: abbr, rule: SHOOTING_HOURS[abbr] };
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
 * a plausible-looking rule for a state we never transcribed and feed it in.
 *
 * Sun times are guarded with `Number.isFinite`. A missing sunset is not
 * midnight; it is a refusal.
 */
export function resolveShootingWindow(
  lookup: ShootingHoursLookup,
  sun: SunTimes | null | undefined,
): ShootingWindow {
  if (lookup.status !== "transcribed") {
    return { status: "refused", reason: lookup.reason, message: lookup.message };
  }

  if (
    !sun ||
    !Number.isFinite(sun.sunriseMin) ||
    !Number.isFinite(sun.sunsetMin)
  ) {
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

  return {
    status: "ok",
    state: lookup.state,
    openMin: anchorFor(start.anchor) + start.minutes,
    closeMin: anchorFor(end.anchor) + end.minutes,
    rule: lookup.rule,
  };
}
