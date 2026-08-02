/**
 * SeasonRail.tsx — which season he is standing in, and how firm those dates are.
 *
 * NOT ITS OWN LABELLED BAND. This renders as the bottom half of the legal-light
 * block, with no hairline above it and no heading of its own, because it is not
 * a second subject — it is the basis of the clock immediately above it. Giving
 * it its own band implied a hunter had two things to read where he has one, and
 * cost forty pixels of a screen that must not scroll.
 *
 * It earns its place twice.
 *
 * FIRST: THE ZONE IS THE HUNTER'S OWN CHECK ON THE CLOCK ABOVE IT. Maryland's
 * goose zones and duck zones use different boundaries and overlap, which the
 * digest says outright. If the rail names "Early Resident Canada Goose - Eastern
 * Zone" and he is standing in the Western Zone, he knows before he shoots that
 * the app has him in the wrong season — and he cannot know that from a clock
 * alone. The labels are printed VERBATIM as the digest writes them, never
 * summarised, so what he reads here is what he will find in the booklet.
 *
 * SECOND: THE DATES ARE PROVISIONAL AND THAT IS A DISPLAYED FIELD, NOT INTERNAL
 * METADATA. `MD_SEASONS` carries MD DNR's own contingency language — 2026-27
 * seasons are contingent on U.S. Fish and Wildlife Service approval — and it is
 * shown in DNR's words rather than paraphrased. An app that renders a confident
 * clock off dates the state itself has flagged as unapproved, without saying so,
 * is claiming a certainty the source does not have.
 *
 * THE FLAG AND THE PARAGRAPH ARE NOW TWO DIFFERENT THINGS, and separating them
 * is the whole of what changed here. `season · dates provisional` is a FLAG — it
 * rides on the rail label, in every mode, and it is the part a man in the water
 * can act on, because it tells him the clock above is standing on unapproved
 * dates. DNR's full sentence about Fish and Wildlife Service approval and
 * checking the website in September is a PARAGRAPH, verbatim, and it is the
 * night-before half: it prints once at the foot of the surface with the rest of
 * the provenance rather than four lines deep in the middle of the glass. Nothing
 * about it is hidden, dimmed or behind a tap. It moved down, and it moved once.
 *
 * The species override rides on the HEADER ROW, so it costs no vertical band of
 * its own. It is a repair tool, not a setting: `./fieldSeason.ts` derives the
 * species off the season calendar and on every date in the transcribed table
 * that derivation is exact, so this control should never be needed. It is
 * present because "should never" is not "cannot", and because the hunter always
 * wins — the same rule `setStation` follows in `src/lib/spot.ts`.
 */

import { TRANSCRIBED_SPECIES, type TranscribedSpecies } from "@/data/regs/shootingHours";
import { RailLabel, Reading, Receipt } from "./Instrument";
import type { FieldSeason } from "./fieldSeason";

export function SeasonRail({
  season,
  override,
  onOverride,
}: {
  season: FieldSeason;
  override: TranscribedSpecies | null;
  onOverride: (species: TranscribedSpecies | null) => void;
}) {
  const lookup = season.lookup;
  const provisional = lookup.status === "transcribed" ? lookup.season.provisional : false;

  return (
    <section className="px-4 pb-1">
      <RailLabel>{provisional ? "season · dates provisional" : "season"}</RailLabel>

      {/* Zones and the repair tool share ONE row. The zones take the space they
          need and the two 44px buttons sit beside them, so the override costs no
          vertical band of its own on a screen that must not scroll. */}
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          {/* VERBATIM, as the digest writes them. Never summarised — what he
              reads here is what he will find in the printed booklet, which is
              the whole point of showing him the zone at all. */}
          {season.zones.length > 0 ? (
            season.zones.map((z) => (
              <Reading key={z} size="xs" className="block">
                {z}
              </Reading>
            ))
          ) : (
            <Reading size="xs">no open season on this date</Reading>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {TRANSCRIBED_SPECIES.map((s) => {
            const active = override === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => onOverride(active ? null : s)}
                aria-pressed={active}
                aria-label={`Hunt ${s}`}
                className={[
                  "min-h-[44px] rounded-md border px-2 font-mono text-[10px] uppercase tracking-[0.1em]",
                  active
                    ? "border-amber-400 bg-amber-500/12 text-amber-300"
                    : "border-amber-500/15 text-amber-500/45",
                ].join(" ")}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>

      {/* Only when he has overridden. `bird read off the calendar` was the same
          fact the legal-light receipt already states as `species read off the
          season calendar`, one rail up and eighteen pixels away — printing it
          twice is the exact duplication this pass exists to remove. The
          override's own affordance is not duplication: nothing else on the
          surface says how to undo it. */}
      {override !== null ? (
        <Receipt items={["bird set by you — tap again to clear"]} className="mt-0.5" />
      ) : null}
    </section>
  );
}
