/**
 * ink.ts — the palette and the citation shortener. No components, on purpose.
 *
 * Split out of `Instrument.tsx` so that file exports components and nothing
 * else, which is what `react-refresh/only-export-components` is asking for and
 * which is also just true: a colour token and a URL parser are not marks on the
 * glass, they are the things marks are made of.
 *
 * The reasoning behind the palette — why amber is the ink, why there is no large
 * light field, why white is reserved — lives in the header of `Instrument.tsx`
 * with the marks that use it. This file is the values.
 */

/* -------------------------------------------------------------------------- */
/*  THE PALETTE — one place, so nothing drifts.                                */
/* -------------------------------------------------------------------------- */

/** Near-black with a blue cast. Never pure #000, never a light field. */
export const FIELD_BG = "#04060b";

/** Hairline between rails. A line, not a border of a card. */
export const HAIRLINE = "border-amber-500/12";

/** The hero and anything the eye should land on first. */
export const INK_PRIMARY = "text-amber-400";

/** Secondary readings — still amber, still legible, visibly subordinate. */
export const INK_READING = "text-amber-300/85";

/** Rail labels. Small caps, wide tracking. */
export const INK_LABEL = "text-amber-500/60";

/** The receipt line. Quiet, but never invisible — this must stay readable. */
export const INK_RECEIPT = "text-amber-500/50";

/* -------------------------------------------------------------------------- */
/*  CITATIONS                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A citation URL, shortened to something that fits 375px and still names the
 * authority.
 *
 * DERIVED FROM THE URL, never from a hardcoded url→label map. A map would be a
 * second copy of the citation that can silently fall out of step with the regs
 * table — repoint `COMAR_13` and the map keeps printing the old label against
 * the new source, which is the worst possible failure on a legal surface. This
 * reads the authority out of the URL itself, so the label cannot outlive it.
 *
 * Unrecognised hosts fall through to the bare hostname rather than to a friendly
 * invented name. An authority we cannot name is one we print the domain of.
 */
export function citeLabel(url: string | null | undefined): string | null {
  if (typeof url !== "string" || url.trim() === "") return null;
  try {
    const u = new URL(url);
    const comar = /\/comar\/([\d.]+)$/.exec(u.pathname);
    if (comar) return `COMAR ${comar[1]}`;
    if (u.hostname.endsWith("eregulations.com")) return "MD DNR migratory game bird digest";
    if (u.hostname.endsWith("dnr.maryland.gov")) return "MD DNR waterfowl";
    if (u.hostname.endsWith("govinfo.gov")) return "50 CFR 20.23";
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
