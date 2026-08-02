/**
 * provenance.ts — EVERY METHOD ON THIS SURFACE, ONCE, IN ONE LIST.
 *
 * PURE. No React, no storage, no network. A total function of the readings the
 * page already holds.
 *
 * NOT NAMED `fieldProvenance.ts`, and the reason is a trap worth writing down:
 * macOS ships a case-INSENSITIVE filesystem, so `fieldProvenance.ts` and its
 * component `FieldProvenance.tsx` resolve to the same module specifier under
 * Vite. `tsc` honours the case and passes; the dev server hands back the wrong
 * file and the whole page renders blank with `does not provide an export named
 * FieldProvenance`. A sibling pair whose names differ only in the first letter's
 * case is a landmine on half the machines that will ever open this repo.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE DISTINCTION THIS FILE EXISTS TO ENFORCE.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * The field surface had collapsed two different things into the word "receipt",
 * and prising them apart is where the screen came from:
 *
 *   A DENOMINATOR IS PART OF THE READING. `22% of 162 season days`, `8.9 of 11.0
 *   dark hrs`, `1.4 ft MLLW`, `COMAR 08.03.07.13`, `next open day 2026-09-07`.
 *   These are what make a number honest and they are read IN THE MOMENT, against
 *   the number they sit under. NONE OF THEM ARE IN THIS FILE. They stayed on
 *   their rails, at reading weight, in every mode.
 *
 *   METHODOLOGY IS PROVENANCE. Which almanac the sun came out of. Which single
 *   variable a base rate counted and what it is collinear with. The confidence
 *   interval on the one study that exists. Which input the phone does not have.
 *   Whether the state has had its dates approved yet. This is what a man reads
 *   ONCE, at the kitchen table, to decide whether the instrument is worth
 *   carrying — and never at 05:15 with a gun in the other hand. ALL OF IT IS IN
 *   THIS FILE, and it is printed ONCE at the foot of the glass instead of six
 *   times up its length.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THIS IS A MOVE. IT IS NOT A DELETION, AND IT IS NOT A DISCLOSURE TRIANGLE.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Every source, every interval, every stated unknown that used to ride under a
 * rail rides here instead, on the same screen, with no tap, no accordion, no
 * modal and no `aria-hidden`. `FieldSurface.test.tsx` holds the whole surface to
 * that and will fail if a future edit "fixes" an overflow by putting a gate or
 * this block behind a control.
 *
 * ONE THING IS LOAD-BEARING ABOVE THE REST and it is repeated here so it cannot
 * be trimmed by accident: the link from last night's moon to this morning's
 * flight HAS NEVER BEEN MEASURED. `SkyRail.tsx` used to carry that sentence
 * beside its claim. The claim is now PREP-weight and the disclosure is not — the
 * disclosure prints in FIELD, in PREP and in PLAN, on every branch, because the
 * moon numbers themselves print on every branch and a number without it invites
 * exactly the inference the dossier went looking for and could not find.
 */

import { moonState } from "@/lib/sky";
import { dawnTideClock } from "./dawnTide";
import { skyDayFor } from "./fieldTime";
import { moonBaseRate } from "./moonBaseRate";
import type { NextOpen } from "./fieldSeason";
import type { LegalLight } from "./legalLight";
import type { PocketCurve } from "./tidePocket";
import type { TideResult } from "@/lib/tide";

const DAY_MS = 86_400_000;

/**
 * THE DISCLOSURE. One string, one place, printed on every path in every mode.
 *
 * It is a constant rather than a line inside a branch ON PURPOSE: a per-branch
 * copy is a per-branch opportunity to forget it, and the forgetting would be
 * silent and would look exactly like a surface that never said it.
 *
 * The clause before it is its antecedent and travels with it. `SkyRail.tsx`
 * states the mechanism half in PREP; this sentence has to stand on its own feet
 * in FIELD, where that claim is not on the glass, so it carries what it is
 * about.
 */
export const NEVER_MEASURED =
  "more light lengthens NIGHT feeding, and " +
  "whether that changes this morning has never been measured — not in ducks, not in anything";

/** Whole days between an ISO instant and now, or `null` if unreadable. */
function ageInDays(fetchedAt: string, now: Date): number | null {
  const then = Date.parse(fetchedAt);
  const nowMs = now?.getTime?.();
  if (!Number.isFinite(then) || typeof nowMs !== "number" || !Number.isFinite(nowMs)) return null;
  const days = Math.floor((nowMs - then) / DAY_MS);
  return Number.isFinite(days) && days >= 0 ? days : null;
}

export interface ProvenanceInputs {
  readonly light: LegalLight;
  /** The calendar day the readings are for. */
  readonly day: string;
  /** The CO-OPS station bound to the frozen spot, or `null`. */
  readonly stationId: string | null;
  readonly pocket: TideResult<PocketCurve>;
  readonly now: Date;
  readonly nextOpen: NextOpen | null;
}

/**
 * The whole provenance of the surface, in reading order, as dot-separated
 * segments.
 *
 * Ordered by what a sceptic checks first: what computed it, then what the one
 * counted variable was and against how many days, then the disclosure and the
 * only direct estimate that exists, then the inputs this phone does not have,
 * then the legal chain, then the dossier.
 */
export function provenanceSegments(input: ProvenanceInputs): readonly string[] {
  const { light, day, stationId, pocket, now, nextOpen } = input;

  // Same input `SkyRail` uses: `sky.ts` floors whatever it is handed through
  // `utcDayStart`, so the UTC-midnight instant is exactly what it wants and no
  // engine-specific string parsing enters the path.
  const rate = moonBaseRate(moonState(skyDayFor(day) ?? new Date(NaN)).illumination);
  const dawn = dawnTideClock(stationId);
  const lookup = light.season.lookup;
  const provisionalNote = lookup.status === "transcribed" ? lookup.season.provisionalNote : null;
  const verified = light.window.status === "refused" ? null : light.window.rule.verified;

  const packAge = pocket.status === "ok" ? ageInDays(pocket.value.fetchedAt, now) : null;

  const out: (string | null)[] = [
    "sun + moon on this device: NOAA solar, Schlyter lunar",

    // Dossier §5 rule 1. Both halves are PRINTED on the rail; only one is
    // COUNTED, and a surface that prints two collinear numbers without saying
    // which one the denominator used is inviting the reader to double-count it.
    rate.status === "ok"
      ? `base rate = illumination only (hours-up is the same variable, r = 0.988), ` +
        `${rate.n} published MD duck + goose season days, ${rate.firstDay} → ${rate.lastDay}`
      : "base rate = illumination only (hours-up is the same variable, r = 0.988)",

    NEVER_MEASURED,

    "one direct test of last night on next morning: −0.4%, 95% CI −9% to +9%, " +
      "105 GPS ducks, 1,984 bird-days; same ducks moved 23% MORE on bright clear nights, " +
      "no less next day",

    // Dossier §5 rule 2. Naming the missing input is half of it; naming WHICH
    // WAY it can cut is the other half, because a cloud-subtracts rule is a
    // known-wrong physical model over most of Maryland tidewater.
    "overnight cloud cover is NOT known here — and cloud does not simply subtract; " +
      "near a town it reflects light back down",

    // Dossier §5 rule 3. The sign genuinely reverses between stations on this
    // coast, so the counts ride with the station that produced them.
    dawn.status === "ok" || dawn.status === "inside-the-noise"
      ? `dawn tide ${dawn.station.stationName} ${dawn.station.stationId}, ` +
        `n = ${dawn.station.nearFullN} full / ${dawn.station.nearNewN} new / ` +
        `${dawn.station.quarterN} quarter, ${dawn.station.window}`
      : "dawn tide read per station, never generalised — the spring sign at dawn reverses " +
        "between stations here",

    pocket.status === "ok"
      ? `tide ${pocket.value.stationName ?? pocket.value.curve.provenance.stationId}` +
        `${packAge === null ? "" : `, packed ${packAge}d ago`}, NOAA CO-OPS harmonic ` +
        "PREDICTION not an observed level — wind and pressure move real water a foot"
      : "tide packs come from NOAA CO-OPS at PREP with signal; a harmonic PREDICTION, " +
        "not an observed level — wind and pressure move real water a foot",

    verified === null
      ? "no clock is shown rather than a wrong one"
      : `hours verified ${verified}, booklet check pending`,
    nextOpen === null ? null : "next open day counted forward through the digest, never forecast",
    provisionalNote,

    "no bag limit shown — limits are species and sex specific and this app cannot know your " +
      "earlier take",

    "MOONLIGHT-AND-THE-MORNING-2026-08-01.md §2(c) §4.1 §5",
  ];

  return out.filter((s): s is string => typeof s === "string" && s.trim() !== "");
}
