/**
 * legalLight.ts — the whole chain, in one pure function, in the right order.
 *
 * PURE. `sky.ts` for the astronomy, the regs table for the law, `fieldTime.ts`
 * for the frame conversion. No network, no storage, no React.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE CHAIN, AND THE ONE HANDOFF THAT MUST NOT BE MISSED.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 *   coordinates + UTC day   ──sunTimes()──▶        sunrise / sunset instants
 *   instants + local midnight ──fieldTime──▶       minutes after local midnight
 *   state + SPECIES + DATE  ──lookupShootingHours──▶ the season, then the rule
 *   rule + sun minutes      ──resolveShootingWindow──▶ open / close minutes
 *   minutes + local midnight ──fieldTime──▶        open / close instants
 *
 * THE THIRD STEP IS THE ONE THAT COSTS THIRTY MINUTES IF IT IS GOT WRONG.
 * `lookupShootingHours` is season-aware. Handed the state ALONE it returns
 * `"narrowed"` — the shorter window — because without the species it cannot know
 * which season applies, and Maryland does not have one rule. The regular duck
 * and goose seasons close at SUNSET. The September resident Canada goose season
 * closes at SUNSET+30, granted by COMAR 08.03.07.13.
 *
 * So `{ species, date }` is always passed, and the species is DERIVED from the
 * calendar by `resolveFieldSeason` rather than asked for — see `./fieldSeason.ts`
 * for why that derivation is a fact and not a guess. On 2026-09-01 at Blackwater
 * that chain lands on `md-september-resident-canada-goose` and the card closes
 * at sunset+30. Break the handoff and it closes at sunset, silently, and the
 * hunter walks off the marsh half an hour early having done nothing wrong.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHAT THIS FUNCTION WILL NOT DO.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * It never widens a window. It never substitutes a rule. `resolveShootingWindow`
 * takes the LOOKUP rather than a bare rule precisely so a refusal cannot be
 * routed around, and this file passes the lookup straight through — a `narrowed`
 * lookup produces a `narrowed` window with the shorter times AND the message,
 * and a `refused` lookup produces no times at all.
 *
 * The Sunday question is answered SEPARATELY and it is answered first, because
 * it is a different question. Maryland does not permit Sunday waterfowl hunting
 * — that is why 69 calendar days span 60 huntable ones — and that is a closed
 * DAY, not different hours. `NOT_IMPLEMENTED` in the regs table names it and
 * carries its cite; this module reads the cite out of that constant rather than
 * retyping it, so there is one place the claim lives.
 */

import {
  NOT_IMPLEMENTED,
  resolveShootingWindow,
  type ShootingWindow,
  type TranscribedSpecies,
} from "@/data/regs/shootingHours";
import { sunTimes, type SunTimes as SkySunTimes } from "@/lib/sky";
import { resolveFieldSeason, type FieldSeason } from "./fieldSeason";
import {
  instantFromLocalMinutes,
  isSunday,
  localMidnightOf,
  minutesFromLocalMidnight,
  skyDayFor,
} from "./fieldTime";

/**
 * Maryland's Sunday closure, read out of the committed regs table.
 *
 * Looked up by `what` rather than by index so a reordering of `NOT_IMPLEMENTED`
 * cannot silently repoint this at the falconry entry. `null` if the entry is
 * ever removed, and a null closure means this app makes no Sunday claim at all
 * rather than making one it can no longer cite.
 */
const SUNDAY_CLOSURE =
  NOT_IMPLEMENTED.find((n) => n.what === "Sunday waterfowl hunting") ?? null;

/** States this closure is known to apply to. Maryland is the only one transcribed. */
const SUNDAY_CLOSURE_STATES = ["MD"] as const;

export interface ClosedDay {
  readonly headline: string;
  readonly message: string;
  readonly cite: string;
}

export interface LegalLight {
  /** The season and species resolution, including how the species was arrived at. */
  readonly season: FieldSeason;
  /**
   * The window. `"ok"` means the season is known; `"narrowed"` means the times
   * are the SHORTER ones and `message` says why; `"refused"` means NO CLOCK.
   */
  readonly window: ShootingWindow;
  /** Instant legal light opens, or `null` when there is no window. */
  readonly openAt: Date | null;
  readonly closeAt: Date | null;
  readonly sunrise: Date | null;
  readonly sunset: Date | null;
  /** Why the sun has no rise or set, when it has none. */
  readonly polar: SkySunTimes["polar"] | null;
  /**
   * Set when the date is a day the state does not permit waterfowl hunting at
   * all. WHEN THIS IS PRESENT NO CLOCK IS RENDERED, whatever `window` says —
   * legal light on a closed day is something true about the sun and misleading
   * about the law.
   */
  readonly closedDay: ClosedDay | null;
}

/**
 * Everything the legal-light rail needs, for one spot on one calendar day.
 *
 * @example
 *   computeLegalLight(38.4436, -76.0722, "MD", "2026-09-01", null)
 *   // → window.status "ok", rule md-september-resident-canada-goose,
 *   //   closeAt = sunset + 30 min, cited to COMAR 08.03.07.13
 */
export function computeLegalLight(
  lat: number,
  lng: number,
  state: string | null,
  localDay: string,
  override: TranscribedSpecies | null,
): LegalLight {
  const season = resolveFieldSeason(state, localDay, override);

  const skyDay = skyDayFor(localDay);
  const midnight = localMidnightOf(localDay);

  const haveGeometry =
    Number.isFinite(lat) && Number.isFinite(lng) && skyDay !== null && midnight !== null;

  const sun = haveGeometry ? sunTimes(lat, lng, skyDay as Date) : null;

  const sunriseMin =
    sun && midnight ? minutesFromLocalMidnight(midnight, sun.sunrise) : null;
  const sunsetMin = sun && midnight ? minutesFromLocalMidnight(midnight, sun.sunset) : null;

  // `resolveShootingWindow` guards its own inputs with `Number.isFinite` and
  // refuses with `no-sun-times` when they are absent. Handing it `null` rather
  // than zeros is the point: a missing sunset is not midnight.
  const window = resolveShootingWindow(
    season.lookup,
    sunriseMin !== null && sunsetMin !== null ? { sunriseMin, sunsetMin } : null,
  );

  const openAt =
    midnight !== null && window.status !== "refused"
      ? instantFromLocalMinutes(midnight, window.openMin)
      : null;
  const closeAt =
    midnight !== null && window.status !== "refused"
      ? instantFromLocalMinutes(midnight, window.closeMin)
      : null;

  return {
    season,
    window,
    openAt,
    closeAt,
    sunrise: sun?.sunrise ?? null,
    sunset: sun?.sunset ?? null,
    polar: sun?.polar ?? null,
    closedDay: closedDayFor(state, localDay),
  };
}

/**
 * Is this a day the state closes outright.
 *
 * Only claimed for states the closure has actually been read for, and only when
 * the regs table still carries the entry to cite. An uncited legal claim is not
 * made at all — that is the same rule that keeps a Delaware clock off the
 * screen, applied to a closed day instead of to hours.
 */
export function closedDayFor(state: string | null, localDay: string): ClosedDay | null {
  if (SUNDAY_CLOSURE === null) return null;
  if (typeof state !== "string") return null;
  const abbr = state.toUpperCase();
  if (!(SUNDAY_CLOSURE_STATES as readonly string[]).includes(abbr)) return null;
  if (!isSunday(localDay)) return null;

  return {
    headline: "Sunday. No waterfowl hunting in Maryland today.",
    message:
      "This is a closed DAY, not different hours — so no shooting light is shown. It is why " +
      "Maryland's 69 calendar days of duck season span 60 huntable ones. The sun will still " +
      "come up; you cannot hunt waterfowl under it here.",
    cite: SUNDAY_CLOSURE.cite,
  };
}
