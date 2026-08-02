/**
 * fieldTime.ts — the frame conversion, and nothing else.
 *
 * `sky.ts` and `tide.ts` both publish honest UTC instants and both say the same
 * thing in their headers: "localizing to the spot's timezone is the caller's
 * job". FIELD is that caller. This module is where the job is done, in one
 * place, so no card has to do it twice and get it slightly different.
 *
 * THERE IS NO NETWORK HERE and there is nowhere to put one — every function is
 * synchronous and takes a `Date` or a string.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHICH CLOCK, AND WHY.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * The hunter's phone is standing in the marsh. Its own timezone IS the marsh's
 * timezone, so the device clock is the correct localization and there is no
 * timezone database to ship and no coordinate-to-zone lookup to get wrong. That
 * is a deliberate limit, not an oversight: it is right for a hunter in his own
 * blind and it would be wrong for someone in Chicago reading about Blackwater.
 * FIELD is only ever the former.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * MINUTES-AFTER-LOCAL-MIDNIGHT IS ELAPSED, NOT WALL-CLOCK, AND THAT IS CORRECT.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * `resolveShootingWindow` in `src/data/regs/shootingHours.ts` wants sunrise and
 * sunset as "minutes after local midnight". This module measures that as REAL
 * ELAPSED MILLISECONDS from the instant of local midnight, which on the 25-hour
 * local day of 2026-11-01 — inside Maryland duck season — differs from the wall
 * clock by sixty minutes after 2 a.m.
 *
 * That difference cancels exactly, and it has to, or FIELD would be an hour
 * wrong on a hunting day:
 *
 *   • the rule offsets (`sunrise-30`, `sunset+30`) are durations, and thirty
 *     elapsed minutes is thirty wall minutes on any day, DST or not;
 *   • `openMin`/`closeMin` come back in the same elapsed frame they went out in
 *     and `instantFromLocalMinutes` inverts the conversion exactly, so the
 *     instant that comes out is the instant that went in, plus the offset;
 *   • the "are we inside the window" comparison is done between two numbers in
 *     the elapsed frame, so it never mixes frames either.
 *
 * Nothing in FIELD ever prints a minutes-after-midnight number. Displayed times
 * are always formatted from the INSTANT, by `Intl`, which knows about DST. The
 * minute count is arithmetic plumbing between two committed modules and it never
 * reaches the screen.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * NO `?? 0`. Every function that cannot answer returns `null`.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * An unformattable instant is not midnight and an unmeasurable duration is not
 * zero seconds. Each of these returns `null` and every call site has to render
 * an absence rather than a number. That is the same rule `formatTideHeight`
 * follows in `src/lib/tide.ts`, for the same reason.
 */

const MS_PER_MINUTE = 60_000;

/* -------------------------------------------------------------------------- */
/*  THE CALENDAR DAY                                                          */
/* -------------------------------------------------------------------------- */

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

/**
 * The hunter's own local calendar day as `YYYY-MM-DD`.
 *
 * This is the exact shape `lookupShootingHours` demands, and its header says
 * why in as many words: a `Date` there "would drag UTC into a question that is
 * purely about which day it is where the hunter is standing, and that shift is
 * how a September 1 opener becomes an August 31 refusal". At Blackwater, local
 * midnight on 2026-09-01 is 04:00Z — so `toISOString().slice(0,10)` on the first
 * four hours of the opener returns "2026-08-31" and refuses the season. Local
 * getters, always.
 *
 * Returns `null` for an unreadable instant rather than a plausible day.
 */
export function localCalendarDay(now: Date): string | null {
  const ms = now?.getTime?.();
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** The instant local midnight began, for the local day `now` falls on. */
export function localMidnight(now: Date): Date | null {
  const ms = now?.getTime?.();
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The instant local midnight began on a NAMED calendar day.
 *
 * The multi-argument `Date` constructor is the local-time one, so this lands on
 * the correct instant across a DST boundary without any offset arithmetic — on
 * 2027-03-14 in Maryland it is still 00:00 wall clock, and the hour that goes
 * missing goes missing later in the day where it belongs. Building it as
 * `new Date(\`${day}T00:00\`)` would be at the mercy of engine-specific parsing
 * of bare datetime strings, which is exactly the class of bug that turns an
 * opener into the day before.
 */
export function localMidnightOf(localDay: string): Date | null {
  const m = ISO_DAY.exec(localDay);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const at = new Date(y, mo - 1, d, 0, 0, 0, 0);
  return Number.isFinite(at.getTime()) ? at : null;
}

/**
 * The UTC-midnight instant that `sky.ts` wants for a local calendar day.
 *
 * `sunTimes` and `moonEvents` are documented as answering for a UTC calendar
 * day, and they floor whatever they are handed through `utcDayStart`. Passing
 * `Date.UTC(y, m, d)` for the hunter's LOCAL day makes the sky module answer for
 * the UTC day of the same name.
 *
 * THE LIMIT, STATED: those two labels name the same 24 hours of sunlight only
 * where sunrise and sunset both fall inside the UTC day — which is true across
 * the Americas east of roughly 150°W and false in the far Pacific, where a local
 * evening sunset lands on the next UTC date. Maryland is the only state
 * `src/data/regs/shootingHours.ts` will answer for and Maryland is nowhere near
 * that line, so FIELD is inside the limit everywhere it is allowed to draw a
 * clock. Widening the regs table past the Rockies means revisiting this.
 */
export function skyDayFor(localDay: string): Date | null {
  const m = ISO_DAY.exec(localDay);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(Date.UTC(y, mo - 1, d));
}

/** The calendar day after `localDay`, same format. `null` if unreadable. */
export function nextCalendarDay(localDay: string): string | null {
  const base = skyDayFor(localDay);
  if (base === null) return null;
  const next = new Date(base.getTime() + 86_400_000);
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

/**
 * Day of the week for a calendar day, 0 = Sunday.
 *
 * Read out of the STRING through `Date.UTC`, never through a local `Date`
 * constructor, so the answer is a property of the date the hunter named and not
 * of the machine reading it.
 */
export function weekdayOf(localDay: string): number | null {
  const d = skyDayFor(localDay);
  return d === null ? null : d.getUTCDay();
}

/** Sunday, in the hunter's own calendar. */
export function isSunday(localDay: string): boolean {
  return weekdayOf(localDay) === 0;
}

/* -------------------------------------------------------------------------- */
/*  THE ELAPSED FRAME                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Elapsed minutes from local midnight to an instant. See the file header for
 * why elapsed rather than wall-clock, and why it cancels.
 */
export function minutesFromLocalMidnight(midnight: Date, instant: Date | null): number | null {
  if (instant === null) return null;
  const a = midnight?.getTime?.();
  const b = instant?.getTime?.();
  if (typeof a !== "number" || typeof b !== "number") return null;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const min = (b - a) / MS_PER_MINUTE;
  return Number.isFinite(min) ? min : null;
}

/** The exact inverse of `minutesFromLocalMidnight`. */
export function instantFromLocalMinutes(midnight: Date, minutes: number): Date | null {
  const a = midnight?.getTime?.();
  if (typeof a !== "number" || !Number.isFinite(a) || !Number.isFinite(minutes)) return null;
  const ms = a + minutes * MS_PER_MINUTE;
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/* -------------------------------------------------------------------------- */
/*  RENDERING                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One formatter, built once. Locale is the device's, because the device is the
 * hunter's. No timezone is passed, so `Intl` uses the phone's — which is the
 * marsh's, and which handles the November DST step by itself.
 */
const CLOCK = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** `"6:33 AM"`, or `null` for an instant that cannot be read. Never a fallback string. */
export function formatClock(instant: Date | null | undefined): string | null {
  const ms = instant?.getTime?.();
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  return CLOCK.format(instant as Date);
}

/** ISO instant for a `<time dateTime>` attribute, or `null`. Machine-readable truth. */
export function isoOf(instant: Date | null | undefined): string | null {
  const ms = instant?.getTime?.();
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/**
 * A countdown, as a hunter reads it at arm's length in the dark.
 *
 * THE UNIT FOLLOWS THE DISTANCE, and every step down is deliberate:
 *
 *   under an hour   `48m 12s`  — seconds, because the last minutes before legal
 *                                light are the ones he is actually watching.
 *   under a day     `6h 04m`   — the seconds column stops, because a ticking
 *                                seconds digit on a six-hour wait is motion
 *                                carrying no information, and motion is the one
 *                                thing this surface spends carefully.
 *   beyond a day    `31d 07h`  — days. This is the case the first draft of this
 *                                function got wrong: it rendered a month out as
 *                                `751h 23m`, which is arithmetically correct and
 *                                completely unreadable. A hunter looking at
 *                                September in August needs "31 days", and no
 *                                human converts 751 hours in their head.
 *
 * Negative durations return `null` rather than a minus sign — a caller holding
 * the sign backwards should render a different sentence, not a negative clock.
 */
export function formatDuration(ms: number): string | null {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${pad2(h)}h`;
  if (h > 0) return `${h}h ${pad2(m)}m`;
  return `${m}m ${pad2(s)}s`;
}

/**
 * A span of hours to one decimal, e.g. `"9.4"`. `null` when unmeasurable — a
 * night with no measurable dark is not a zero-hour night, it is an unanswered
 * question, and the caller has to say so.
 */
export function formatHours(ms: number): string | null {
  if (!Number.isFinite(ms) || ms < 0) return null;
  return (ms / 3_600_000).toFixed(1);
}
