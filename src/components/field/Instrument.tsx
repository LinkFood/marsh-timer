/**
 * Instrument.tsx — the visual vocabulary of the field surface.
 *
 * This file holds no data logic. It is the set of marks the instrument is drawn
 * with, kept in one place so a rail added later cannot invent a seventh grey or
 * a fourth type size.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 1. AMBER IS THE INK. WHITE IS NOT USED AT SIZE, ANYWHERE.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * The rest of this app renders white Playfair headlines on near-black, and at a
 * desk that is right. In a blind at 05:15 it is a faceful of broadband light and
 * it costs the hunter the dark adaptation he spent twenty minutes building.
 * Rod cells are effectively blind past roughly 620 nm, which is why cockpit,
 * submarine and observatory instrumentation is amber and red: long-wavelength
 * light is bright to the cones that read the number and nearly invisible to the
 * rods that read the sky. So amber is the primary ink here and there is no large
 * light field on the surface at all — the page is #04060b, a near-black with a
 * blue cast rather than a flat black, and every panel is a barely-lifted plane
 * separated by a hairline rather than a filled card.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 2. SERIF CLAIMS. MONO READINGS. NEVER THE OTHER WAY.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * The duality is the product's signature and it carries meaning: Playfair
 * Display says "this is a sentence the app is asserting", monospace says "this
 * is a measurement, and here is where it came from". A number in the serif would
 * read as prose the app made up. `Reading` and `Receipt` are therefore mono-only
 * by construction — neither takes a font prop.
 *
 * `tabular-nums` is on every reading. Proportional digits shift width as a
 * countdown ticks, and a hero clock whose digits jitter every second is a clock
 * you cannot read out of the corner of your eye.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 3. THE RECEIPT IS NEVER BEHIND A TAP.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Every reading on this surface carries its provenance directly underneath, in
 * the dot-separated mono line the rest of the site already uses. A citation
 * behind a disclosure triangle is a citation nobody reads, and on a legal
 * surface that is the one unforgivable design decision available here.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 4. AN ABSENCE IS SET AT THE WEIGHT OF A READING.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * `Refusal` is not greyed out and it does not apologise. "No tide is saved for
 * this spot" is information — it occupies its slot at full strength, the same
 * way the live site says `≈ tide · Cambridge gauge — no reading on file today`.
 * Fading a refusal is how a hunter learns to read absence as "nothing much
 * today" instead of "the app does not know".
 */

import type { ReactNode } from "react";
import { HAIRLINE, INK_LABEL, INK_PRIMARY, INK_READING, INK_RECEIPT } from "./ink";

/* -------------------------------------------------------------------------- */
/*  MARKS                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A horizontal band of the instrument. Full-bleed, hairline-separated, no
 * shadow and no radius — this is a panel on a gauge, not a card in a feed.
 */
export function Rail({
  children,
  className = "",
  first = false,
}: {
  children: ReactNode;
  className?: string;
  /** The top rail has no line above it. */
  first?: boolean;
}) {
  return (
    <section
      className={`px-4 ${first ? "" : `border-t ${HAIRLINE}`} ${className}`}
    >
      {children}
    </section>
  );
}

/** The small caps label that names a rail. Mono, because it labels readings. */
export function RailLabel({ children }: { children: ReactNode }) {
  return (
    <span className={`font-mono text-[10px] uppercase tracking-[0.18em] ${INK_LABEL}`}>
      {children}
    </span>
  );
}

/**
 * A sentence the app is asserting. Playfair, always. Never a number.
 */
export function Claim({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={`font-display leading-tight ${INK_PRIMARY} ${className}`}>{children}</p>
  );
}

/**
 * A measurement. Mono and tabular, always. Never the serif.
 *
 * `size` is a deliberate ladder rather than a free number, so the hierarchy on
 * the glass stays a hierarchy: the hero is an order of magnitude above the
 * periphery, and nothing sits between them by accident.
 *
 * DO NOT try to override the size through `className`. Tailwind emits both
 * utilities and CSS SOURCE ORDER decides which wins — not the order the names
 * appear in the string — so a `text-[10px]` tacked onto a `size="md"` silently
 * renders at 14px and quietly costs thirty pixels of a screen that must not
 * scroll. Add a rung to this ladder instead.
 */
export function Reading({
  children,
  size = "md",
  className = "",
  ...rest
}: {
  children: ReactNode;
  size?: "hero" | "lg" | "md" | "sm" | "xs";
  className?: string;
} & React.HTMLAttributes<HTMLSpanElement>) {
  const scale = {
    hero: "text-[56px] leading-[0.9] font-semibold",
    lg: "text-[20px] leading-tight font-semibold",
    md: "text-[14px] leading-snug font-medium",
    sm: "text-[11px] leading-snug",
    xs: "text-[10px] leading-[1.25]",
  }[size];
  const ink = size === "hero" ? INK_PRIMARY : INK_READING;
  return (
    <span className={`font-mono tabular-nums ${scale} ${ink} ${className}`} {...rest}>
      {children}
    </span>
  );
}

/**
 * The provenance line. Mono, small, dot-separated, ALWAYS VISIBLE.
 *
 * 9.5px, which is the smallest this can be and stay legible, and it is set that
 * small ON PURPOSE. The receipt is the DELIBERATE-read layer — a hunter checks a
 * citation once, at the truck, with the phone close to his face; he never reads
 * it out of the corner of an eye while watching the sky. Buying those pixels
 * back is what lets the glance layer above it be as large as it is, and it is
 * the trade that gets every gate onto one piece of glass without a scrollbar.
 * It is NOT hidden and it is NOT behind a tap, which is the part that matters.
 *
 * Items are filtered for emptiness so a caller can pass a conditional without
 * producing a dangling separator — an empty segment in a citation reads as a
 * missing source, which is a lie about the source.
 */
export function Receipt({
  items,
  className = "",
}: {
  items: readonly (string | null | undefined)[];
  className?: string;
}) {
  const kept = items.filter((s): s is string => typeof s === "string" && s.trim() !== "");
  if (kept.length === 0) return null;
  return (
    <p className={`font-mono text-[9.5px] leading-[1.35] ${INK_RECEIPT} ${className}`}>
      {kept.map((s, i) => (
        <span key={i}>
          {i === 0 ? "· " : " · "}
          {s}
        </span>
      ))}
    </p>
  );
}

/**
 * A stated absence, set at the weight of a reading.
 *
 * Deliberately NOT dimmed and deliberately NOT prefixed with an apology. The
 * serif carries the short claim, the mono carries the reason, exactly as a
 * present reading would.
 */
export function Refusal({
  headline,
  message,
  cite,
}: {
  headline: string;
  message: string;
  cite?: readonly (string | null | undefined)[];
}) {
  return (
    <div>
      <Claim className="text-[17px]">{headline}</Claim>
      <p className={`mt-1 font-mono text-[11px] leading-[1.45] ${INK_READING}`}>{message}</p>
      {cite ? <Receipt items={cite} className="mt-1" /> : null}
    </div>
  );
}
