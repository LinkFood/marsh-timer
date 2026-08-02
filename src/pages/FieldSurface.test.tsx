/**
 * FieldSurface.test.tsx — THE ANTI-HIDING RATCHET.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS AND WHAT IT IS DEFENDING AGAINST.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * The field surface is too tall for a phone and it will be too tall again the
 * next time a reading is added. There are two ways to answer that:
 *
 *   HONESTLY   restructure, tighten, shorten the prose, argue about what is a
 *              denominator and what is a method — and MEASURE the result.
 *   CHEAPLY    put a gate behind a `<details>`, a tab, a modal, an
 *              `aria-hidden` wrapper or a `hidden` class, and watch the number
 *              come down.
 *
 * The cheap answer looks identical to the honest one in every metric anybody
 * automatically collects. The page gets shorter. Nothing throws. The screenshot
 * looks calmer. And a hunter standing in the water can no longer conjoin four
 * gates, which is the single cognitive act this product exists to support.
 *
 * So the shape of the surface is pinned here, structurally, rather than left to
 * whoever reads `FieldPage.tsx`'s header. Every assertion below is written so it
 * fails LOUDLY on a hiding change and stays quiet on a tightening one:
 *
 *   • the RAIL COUNT is exact, so a gate cannot be deleted or merged away
 *   • no rail may be inside a `<details>`, a `[role=dialog]`, an `[aria-hidden]`
 *     or a `[hidden]` container, so a gate cannot be closed over
 *   • no rail may be inside a scroll container or a `max-height` clamp, so a
 *     gate cannot be pushed out of view while technically still rendered
 *   • the provenance block is subject to all of the same rules, because the one
 *     thing this whole change moved is exactly the thing that would be hidden
 *     first
 *
 * NOTE ON HEIGHT. `jsdom` has no layout engine — every `getBoundingClientRect`
 * is zero — so the 375×635 fit is NOT asserted here and cannot be. It is
 * measured in a real browser, in a 375px iframe with the clock frozen, and the
 * numbers live in the change's own report. What this file guarantees is the
 * thing a height measurement cannot: that whatever the height turns out to be,
 * it was not bought by hiding a gate.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import FieldPage from "./FieldPage";

/** Blackwater NWR, Dorchester County MD. The owner's ground. */
const SPOT_KEY = "dcd.hunt.spot.v1";
const SPOT_RECORD = {
  v: 1,
  name: "Blackwater",
  lat: 38.4436,
  lng: -76.0722,
  county_fips: "24019",
  county_name: "Dorchester County",
  state: "MD",
  coops_station_id: "8571807",
  station_miles: 7.0,
  saved_at: "2026-08-15T18:00:00.000Z",
};

/** The four states the surface is measured in. */
const FACES = [
  { name: "FIELD, the resident goose opener", now: new Date(2026, 8, 1, 5, 15, 0, 0) },
  { name: "PREP, a closed Maryland Sunday", now: new Date(2026, 8, 6, 5, 15, 0, 0) },
  { name: "PLAN, a day in no open season", now: new Date(2026, 7, 15, 5, 15, 0, 0) },
  { name: "FIELD, inside the running window", now: new Date(2026, 8, 1, 15, 0, 0, 0) },
] as const;

/**
 * THE RAILS, IN ORDER, AND WHAT EACH ONE IS FOR.
 *
 * Seven `<section>` elements: the six gates the hunter conjoins, and the
 * provenance block under them. The count is asserted exactly — not `>= 6` —
 * because "at least" is satisfied by a surface that has lost one gate and grown
 * two of something else.
 */
const RAIL_COUNT = 7;

let originalFetch: typeof fetch;

beforeEach(() => {
  localStorage.clear();
  originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("NETWORK USED IN THE FIELD PATH");
  }) as unknown as typeof fetch;
  localStorage.setItem(SPOT_KEY, JSON.stringify(SPOT_RECORD));
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  localStorage.clear();
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe("FIELD — the surface keeps its shape, in every face it has", () => {
  for (const face of FACES) {
    it(`renders exactly ${RAIL_COUNT} rails and hides none of them — ${face.name}`, () => {
      const { container } = render(<FieldPage now={face.now} />);
      const rails = [...container.querySelectorAll("section")];

      expect(rails).toHaveLength(RAIL_COUNT);

      for (const rail of rails) {
        const label = (rail.textContent ?? "").slice(0, 40);

        // NOT BEHIND A DOOR. `closest` walks the whole ancestor chain, so a
        // wrapper added three levels up is caught the same as one added around
        // the rail itself.
        expect(rail.closest("details"), `rail inside <details>: ${label}`).toBeNull();
        expect(rail.closest("dialog"), `rail inside <dialog>: ${label}`).toBeNull();
        expect(rail.closest('[role="dialog"]'), `rail inside a modal: ${label}`).toBeNull();
        expect(rail.closest('[role="tabpanel"]'), `rail inside a tab panel: ${label}`).toBeNull();
        expect(rail.closest("[hidden]"), `rail inside [hidden]: ${label}`).toBeNull();

        // `aria-hidden="false"` is legal and means visible, so the selector is
        // written against the value rather than the attribute's presence.
        expect(
          rail.closest('[aria-hidden="true"]'),
          `rail inside aria-hidden: ${label}`,
        ).toBeNull();

        // NOT CLAMPED OR SCROLLED OUT OF VIEW. A gate that is rendered inside a
        // 120px overflow-auto box is hidden just as surely as one behind a tap,
        // and it passes every "is it in the document" check ever written.
        for (const ancestor of ancestorsOf(rail, container)) {
          const style = (ancestor.getAttribute("style") ?? "").toLowerCase();
          const cls = ancestor.className.toString();
          expect(style, `inline overflow clamp above: ${label}`).not.toMatch(
            /overflow\s*:\s*(auto|scroll|hidden)/,
          );
          expect(style, `inline max-height clamp above: ${label}`).not.toMatch(/max-height/);
          expect(cls, `overflow/height utility above: ${label}`).not.toMatch(
            /\boverflow-(auto|scroll|hidden|y-auto|y-scroll)\b|\bmax-h-\[/,
          );
        }
      }
    });

    it(`puts nothing on the surface behind a control — ${face.name}`, () => {
      const { container } = render(<FieldPage now={face.now} />);

      // The three shapes a "fix" for overflow actually takes.
      expect(container.querySelector("details")).toBeNull();
      expect(container.querySelector("dialog")).toBeNull();
      expect(container.querySelector('[role="dialog"]')).toBeNull();
      expect(container.querySelector('[role="tablist"]')).toBeNull();
      expect(container.querySelector('[role="tab"]')).toBeNull();
      expect(container.querySelector('[role="tabpanel"]')).toBeNull();

      // Every button on the surface is a REPAIR or a NUDGE — the day, the bird,
      // the tally, the mode. None of them reveal anything: there is no button
      // whose accessible name is about showing, expanding or opening.
      for (const btn of container.querySelectorAll("button")) {
        const name = `${btn.getAttribute("aria-label") ?? ""} ${btn.textContent ?? ""}`;
        expect(name, "a disclosure control appeared on the field surface").not.toMatch(
          /\b(show|reveal|expand|more|details|open panel|see all|read more)\b/i,
        );
      }
    });
  }
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe("FIELD — the provenance block is a slot, not a footnote drawer", () => {
  it("is the last rail on the surface, and it is a real section", () => {
    const { container } = render(<FieldPage now={FACES[0].now} />);
    const rails = [...container.querySelectorAll("section")];
    const foot = rails[rails.length - 1];
    expect(foot.getAttribute("aria-label")).toMatch(/how these numbers were made/i);
    expect(foot.closest("details")).toBeNull();
    expect(foot.closest('[aria-hidden="true"]')).toBeNull();
  });

  /**
   * THE ONE THAT MATTERS. The moon readings print on every branch in every mode;
   * the sentence that says the link to this morning was never measured has to
   * outlive every one of them, or the numbers are back to making the claim on
   * their own.
   */
  it("carries the never-measured disclosure in every face, with its interval", () => {
    for (const face of FACES) {
      const { container, unmount } = render(<FieldPage now={face.now} />);
      const text = container.textContent ?? "";
      expect(text, `disclosure missing — ${face.name}`).toContain(
        "has never been measured — not in ducks, not in anything",
      );
      expect(text, `estimate missing — ${face.name}`).toContain("95% CI −9% to +9%");
      unmount();
    }
  });

  it("prints each source ONCE — the whole point of hoisting them", () => {
    const { container } = render(<FieldPage now={FACES[0].now} />);
    const text = container.textContent ?? "";
    for (const source of [
      "Schlyter lunar",
      "r = 0.988",
      "MOONLIGHT-AND-THE-MORNING-2026-08-01.md",
      "overnight cloud cover is NOT known here",
      "harmonic",
    ]) {
      const hits = text.split(source).length - 1;
      expect(hits, `"${source}" appears ${hits} times, should appear exactly once`).toBe(1);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */

/** Every ancestor of `el` up to and including `root`. */
function ancestorsOf(el: Element, root: Element): Element[] {
  const out: Element[] = [];
  let node: Element | null = el.parentElement;
  while (node && root.contains(node)) {
    out.push(node);
    node = node.parentElement;
  }
  return out;
}
