/**
 * FieldPage.test.tsx — THE FLOOR PROOF OF THE ENTIRE PIVOT.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHAT IS ACTUALLY BEING PROVEN HERE, AND WHY IT IS THE DELIVERABLE.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * The claim the whole architecture rests on is: with the network physically off
 * and nothing cached, this page prints LEGAL SHOOTING LIGHT from GPS alone. If
 * that holds, every remaining gate is a data problem. If it does not, nothing
 * else on the roadmap matters.
 *
 * So the first test below is written to fail loudly in every way that claim can
 * be false:
 *
 *   • `globalThis.fetch` IS A THROWING STUB. Not mocked to resolve, not returning
 *     an empty body — it throws, and the call count is asserted to be zero at the
 *     end. Any request in the render path takes the page down with it, which is
 *     exactly what it would do at the boat ramp.
 *   • `localStorage` HOLDS ONLY A SPOT. No tide pack, no tally, no species, no
 *     cached anything. Everything on the clock is computed on the device from the
 *     date and the coordinates, or read out of a committed constant.
 *   • NO TAP, NO TAB, NO SCROLL. The assertions run against the FIRST render.
 *     Nothing is clicked, nothing is expanded, nothing is navigated to.
 *   • THE TIME IS ASSERTED TO THE MILLISECOND, off the `<time dateTime>`
 *     attribute rather than off formatted text, so the test cannot pass because
 *     of a locale and cannot fail because of one.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE THIRTY MINUTES. THIS IS THE ASSERTION THAT MATTERS.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * `lookupShootingHours` is season-aware, and called with the state ALONE it
 * returns `"narrowed"` — the SHORTER window — because without the species it
 * cannot know which Maryland season applies. Maryland's regular duck and goose
 * seasons close legal light at SUNSET. The September resident Canada goose
 * season closes at SUNSET+30, granted by COMAR 08.03.07.13.
 *
 * 2026-09-01 is the September resident goose opener and it is the morning this
 * app is being carried into a marsh. A card that renders the narrow window that
 * day is not obviously broken — it shows a perfectly plausible clock, cited,
 * that quietly ends the hunt thirty legal minutes early, and the hunter has no
 * way to know.
 *
 * So the test does not merely assert "a time rendered". It asserts:
 *
 *     close === sunset + 30 minutes exactly       (the season's real window)
 *     close !== sunset                            (the narrow window, by name)
 *
 * and it computes both expectations from `sky.ts` itself rather than from a
 * typed-in string, so the day the astronomy changes the test changes with it and
 * the thirty minutes stay the thirty minutes.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * NOTE ON TIMEZONE INDEPENDENCE.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Nothing here hardcodes an Eastern-time string. The expected instants are
 * derived through the same local-midnight round trip the page uses, which is
 * exact in any zone (see the header of `src/components/field/fieldTime.ts`), so
 * this suite passes on a developer laptop in New York and in a CI container in
 * UTC and would pass in Tokyo.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import FieldPage from "./FieldPage";
import { sunTimes } from "@/lib/sky";

/* ── THE REFERENCE SPOT ───────────────────────────────────────────────────── */

/** Blackwater NWR, Dorchester County MD. The owner's ground. */
const BLACKWATER = { lat: 38.4436, lng: -76.0722 };

/** `src/lib/spot.ts` — `STORAGE_KEY` and `SPOT_SCHEMA_VERSION`. */
const SPOT_KEY = "dcd.hunt.spot.v1";

const SPOT_RECORD = {
  v: 1,
  name: "Blackwater",
  lat: BLACKWATER.lat,
  lng: BLACKWATER.lng,
  county_fips: "24019",
  county_name: "Dorchester County",
  state: "MD",
  // Woolford / Church Creek — the nearest CO-OPS prediction station, 7.00 mi.
  coops_station_id: "8571807",
  station_miles: 7.0,
  saved_at: "2026-08-15T18:00:00.000Z",
};

const MINUTE = 60_000;

/** The throwing stub. Counted, so "no network" is asserted and not assumed. */
let fetchCalls = 0;
const originalFetch = globalThis.fetch;

function killTheNetwork() {
  fetchCalls = 0;
  globalThis.fetch = ((...args: unknown[]) => {
    fetchCalls++;
    throw new Error(
      `NETWORK USED IN THE FIELD PATH — this is the bug this test exists to catch. ` +
        `Called with: ${String(args[0])}`,
    );
  }) as unknown as typeof fetch;
}

/** Local-midnight instant for a Y/M/D, built the way the page builds it. */
function localMidnight(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/** The sun for Blackwater on a calendar day, straight from the committed module. */
function sunFor(y: number, m: number, d: number) {
  return sunTimes(BLACKWATER.lat, BLACKWATER.lng, new Date(Date.UTC(y, m - 1, d)));
}

beforeEach(() => {
  localStorage.clear();
  killTheNetwork();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  localStorage.clear();
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe("FIELD — THE FLOOR PROOF: network off, cache empty, legal light from GPS alone", () => {
  it(
    "prints the SUNSET+30 window for the 2026-09-01 resident goose opener at Blackwater — " +
      "offline, with fetch throwing, from localStorage holding only a spot, on first render, " +
      "with no tap, no tab and no scroll",
    () => {
      localStorage.setItem(SPOT_KEY, JSON.stringify(SPOT_RECORD));

      // 05:15 local on the opener. Legal light has not opened yet; he is walking in.
      const now = new Date(2026, 8, 1, 5, 15, 0, 0);

      render(<FieldPage now={now} />);

      /* ---- THE THIRTY MINUTES ------------------------------------------- */

      const sun = sunFor(2026, 9, 1);
      expect(sun.sunrise).not.toBeNull();
      expect(sun.sunset).not.toBeNull();

      // The two candidate answers, derived from `sky.ts`, not typed in.
      const midnight = localMidnight(2026, 9, 1);
      const sunsetMin = ((sun.sunset as Date).getTime() - midnight.getTime()) / MINUTE;
      const sunriseMin = ((sun.sunrise as Date).getTime() - midnight.getTime()) / MINUTE;

      const SEPTEMBER_GOOSE_CLOSE = new Date(midnight.getTime() + (sunsetMin + 30) * MINUTE);
      const REGULAR_SEASON_CLOSE = new Date(midnight.getTime() + sunsetMin * MINUTE);
      const EXPECTED_OPEN = new Date(midnight.getTime() + (sunriseMin - 30) * MINUTE);

      const closeEl = screen.getByLabelText("Legal shooting light closes");
      const openEl = screen.getByLabelText("Legal shooting light opens");

      const renderedClose = closeEl.getAttribute("dateTime");
      const renderedOpen = openEl.getAttribute("dateTime");

      // THE ASSERTION THE WHOLE PIVOT RESTS ON.
      expect(renderedClose).toBe(SEPTEMBER_GOOSE_CLOSE.toISOString());

      // And, said the other way, so a future regression cannot pass by accident:
      // this must NOT be the narrow regular-season window.
      expect(renderedClose).not.toBe(REGULAR_SEASON_CLOSE.toISOString());
      expect(
        new Date(renderedClose as string).getTime() - (sun.sunset as Date).getTime(),
      ).toBe(30 * MINUTE);

      // The morning half-hour is a regulation too, and it is the same rule's start.
      expect(renderedOpen).toBe(EXPECTED_OPEN.toISOString());
      expect(
        (sun.sunrise as Date).getTime() - new Date(renderedOpen as string).getTime(),
      ).toBe(30 * MINUTE);

      /* ---- IT DID NOT FALL INTO `narrowed` ------------------------------- */

      // `resolveFieldSeason` read the species off the season calendar rather than
      // asking for it, so the lookup got `{ species, date }` and resolved a real
      // season. A `narrowed` result would render this banner.
      expect(screen.queryByText(/This is the SHORTER window/i)).not.toBeInTheDocument();
      expect(screen.getByText(/species read off the season calendar/i)).toBeInTheDocument();

      /* ---- THE CITATION IS ON THE SURFACE, NOT BEHIND A TAP -------------- */

      // `getAllBy` rather than `getBy`: the zone label deliberately appears in
      // more than one slot (the season rail names it, the bag receipt repeats it
      // against the tally), and a citation being present twice is not a defect.
      expect(screen.getAllByText(/COMAR 08\.03\.07\.13/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/sunrise-30 → sunset\+30/).length).toBeGreaterThan(0);
      expect(
        screen.getAllByText(/Early Resident Canada Goose - Eastern Zone/).length,
      ).toBeGreaterThan(0);

      /* ---- NOTHING WAS TAPPED, AND THERE IS NOTHING TO TAP -------------- */

      expect(screen.queryByRole("tab")).not.toBeInTheDocument();
      expect(screen.queryByRole("tablist")).not.toBeInTheDocument();

      /* ---- AND NO REQUEST WAS MADE -------------------------------------- */

      expect(fetchCalls).toBe(0);
    },
  );

  it("opens directly onto a running countdown — the clock is the first thing rendered", () => {
    localStorage.setItem(SPOT_KEY, JSON.stringify(SPOT_RECORD));
    const now = new Date(2026, 8, 1, 5, 15, 0, 0);
    render(<FieldPage now={now} />);

    // 05:15 local, opening around 06:03 local — a countdown in minutes, not hours.
    expect(screen.getByText(/until you may legally shoot/i)).toBeInTheDocument();
    expect(screen.getByText(/^\d+m \d{2}s$/)).toBeInTheDocument();
    expect(fetchCalls).toBe(0);
  });

  it("annunciates FIELD without being told — the mode is derived from time-to-hunt", () => {
    localStorage.setItem(SPOT_KEY, JSON.stringify(SPOT_RECORD));
    render(<FieldPage now={new Date(2026, 8, 1, 5, 15, 0, 0)} />);

    // The annunciator reads the DERIVED mode. Nothing was tapped to get it, and
    // the two words beside it are the session-only override, not the way in.
    const annunciator = screen.getByText("field", { selector: "span" });
    expect(annunciator).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "prep" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "plan" })).toBeInTheDocument();
    // "auto" only appears once a mode has been forced.
    expect(screen.queryByRole("button", { name: "auto" })).not.toBeInTheDocument();
  });

  it("shows the running clock inside legal light, counting down to the close", () => {
    localStorage.setItem(SPOT_KEY, JSON.stringify(SPOT_RECORD));
    // Mid-afternoon on the opener — inside the window, hours from the close.
    render(<FieldPage now={new Date(2026, 8, 1, 15, 0, 0, 0)} />);
    expect(screen.getByText(/until you must stop/i)).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe("FIELD — the refusals, which are the product and not the error states", () => {
  it("renders NO CLOCK on a Maryland Sunday and says it is a closed day, with its cite", () => {
    localStorage.setItem(SPOT_KEY, JSON.stringify(SPOT_RECORD));
    // 2026-09-06 is a Sunday and it is INSIDE the Sept 1-15 resident goose season.
    // A season being open is not the same as the day being huntable.
    const sunday = new Date(2026, 8, 6, 5, 15, 0, 0);
    expect(sunday.getDay()).toBe(0);

    render(<FieldPage now={sunday} />);

    expect(screen.getByText(/No waterfowl hunting in Maryland today/i)).toBeInTheDocument();
    // Said twice on purpose: once in the sentence, once in the receipt line.
    expect(screen.getAllByText(/closed day, not different hours/i).length).toBeGreaterThan(0);
    // Not "different hours" — no clock at all.
    expect(screen.queryByLabelText("Legal shooting light closes")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Legal shooting light opens")).not.toBeInTheDocument();
    expect(fetchCalls).toBe(0);
  });

  it("renders NO CLOCK on a date in no open season, and says why", () => {
    localStorage.setItem(SPOT_KEY, JSON.stringify(SPOT_RECORD));
    // 2026-08-15: no Maryland waterfowl season is open. The goose opener is
    // still two weeks out and the duck seasons do not start until October.
    render(<FieldPage now={new Date(2026, 7, 15, 5, 15, 0, 0)} />);

    expect(screen.getByText(/No shooting light is shown for this day/i)).toBeInTheDocument();
    // BOTH species refuse, and BOTH refusals are shown — the duck one because
    // there is simply no season, the goose one because Maryland grants a season
    // whose 2026-27 dates it has not published. Two different absences, said
    // separately, rather than one tidy summary that loses the distinction.
    expect(screen.getAllByText(/no open .* season on 2026-08-15/i).length).toBe(2);
    expect(screen.getByText(/has NOT released: Light Goose Conservation Order/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Legal shooting light closes")).not.toBeInTheDocument();

    // The instrument still shows the next thing that matters — counted forward
    // through the cited digest, never forecast.
    expect(screen.getByText(/until the next day Maryland publishes an open season/i)).toBeInTheDocument();
    expect(screen.getByText(/next open day 2026-09-01/)).toBeInTheDocument();
    expect(fetchCalls).toBe(0);
  });

  it("refuses the tide OUT LOUD when no pack is saved — never a silent absence and never a zero", () => {
    localStorage.setItem(SPOT_KEY, JSON.stringify(SPOT_RECORD));
    render(<FieldPage now={new Date(2026, 8, 1, 5, 15, 0, 0)} />);

    expect(screen.getByText(/No water is shown/i)).toBeInTheDocument();
    expect(screen.getByText(/No tide is saved for this spot/i)).toBeInTheDocument();
    expect(screen.getByText(/this app will not invent water/i)).toBeInTheDocument();
    // The fabrication this refusal exists to prevent: at MLLW, 0.0 ft is a real
    // and ordinary water level, which is what makes it invisible.
    expect(screen.queryByText(/0\.0 ft/)).not.toBeInTheDocument();
    expect(fetchCalls).toBe(0);
  });

  it("states what it does not know about the moon rather than implying a clear sky", () => {
    localStorage.setItem(SPOT_KEY, JSON.stringify(SPOT_RECORD));
    render(<FieldPage now={new Date(2026, 8, 1, 5, 15, 0, 0)} />);

    expect(screen.getByText(/overnight cloud cover is NOT known here/i)).toBeInTheDocument();
    expect(screen.getByText(/up overnight/i)).toBeInTheDocument();
    // And the reading the conditional is attached to is present, not implied.
    expect(screen.getByText(/of .* dark hrs/i)).toBeInTheDocument();
  });

  it("never renders a score, a rating, or a go / no-go verdict", () => {
    localStorage.setItem(SPOT_KEY, JSON.stringify(SPOT_RECORD));
    const { container } = render(<FieldPage now={new Date(2026, 8, 1, 5, 15, 0, 0)} />);
    const text = container.textContent ?? "";
    for (const banned of [
      "excellent",
      "poor rating",
      "score",
      "rating",
      "out of 10",
      "go / no-go",
      "good day",
    ]) {
      expect(text.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });

  it("refuses everything, with a reason, when no spot has been saved", () => {
    render(<FieldPage now={new Date(2026, 8, 1, 5, 15, 0, 0)} />);
    expect(screen.getByText(/No spot is saved/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Legal shooting light closes")).not.toBeInTheDocument();
    expect(fetchCalls).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe("FIELD — the bag counts taps and never says he is legal", () => {
  it("counts up and back down, per date, in localStorage, with no limit anywhere", () => {
    localStorage.setItem(SPOT_KEY, JSON.stringify(SPOT_RECORD));
    render(<FieldPage now={new Date(2026, 8, 1, 5, 15, 0, 0)} />);

    const add = screen.getByLabelText("Add one to today's tally");
    fireEvent.click(add);
    fireEvent.click(add);
    fireEvent.click(add);

    expect(JSON.parse(localStorage.getItem("dcd.hunt.bag.v1") as string)).toEqual({
      v: 1,
      days: { "2026-09-01": 3 },
    });

    fireEvent.click(screen.getByLabelText("Take one off today's tally"));
    expect(JSON.parse(localStorage.getItem("dcd.hunt.bag.v1") as string).days["2026-09-01"]).toBe(2);

    // No target, no remaining, no permission. Scoped to the bag rail: an
    // "N of M" ELSEWHERE on the surface is a legitimate measurement (the moon
    // is up 8.9 of 11.0 dark hours), and a page-wide regex would forbid the
    // product's own vocabulary to catch a bug that can only live here.
    const bagRail = add.closest("section") as HTMLElement;
    const bagText = bagRail.textContent ?? "";
    expect(bagText).not.toMatch(/\blimit of\b/i);
    expect(bagText).not.toMatch(/\b\d+\s*(of|\/)\s*\d+\b/);
    expect(bagText).not.toMatch(/\bremaining\b/i);
    expect(bagText).toMatch(/your taps, not birds, and not a legal count/i);
    expect(bagText).toMatch(/no limit shown/i);
  });

  it("does not fabricate a zero from an unreadable tally", () => {
    localStorage.setItem(SPOT_KEY, JSON.stringify(SPOT_RECORD));
    localStorage.setItem(
      "dcd.hunt.bag.v1",
      JSON.stringify({ v: 1, days: { "2026-09-01": "three" } }),
    );
    render(<FieldPage now={new Date(2026, 8, 1, 5, 15, 0, 0)} />);

    expect(screen.getByText(/tally could not be read/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Add one to today's tally")).not.toBeInTheDocument();
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe("FIELD — time is the only navigation", () => {
  it("nudges to the next day and recomputes the same surface, then returns to today", () => {
    localStorage.setItem(SPOT_KEY, JSON.stringify(SPOT_RECORD));
    render(<FieldPage now={new Date(2026, 8, 1, 5, 15, 0, 0)} />);

    const closeBefore = screen
      .getByLabelText("Legal shooting light closes")
      .getAttribute("dateTime");

    fireEvent.click(screen.getByLabelText("Next day"));

    const closeAfter = screen
      .getByLabelText("Legal shooting light closes")
      .getAttribute("dateTime");

    // Same rails, same labels, a different day's numbers.
    expect(closeAfter).not.toBe(closeBefore);
    expect(screen.getByText(/COMAR 08\.03\.07\.13/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Back to today"));
    expect(
      screen.getByLabelText("Legal shooting light closes").getAttribute("dateTime"),
    ).toBe(closeBefore);
    expect(fetchCalls).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe("FIELD — the mode is derived, and a closed day is never the field face", () => {
  it("annunciates PREP on a Maryland Sunday even though the season is open and the sun is rising", () => {
    localStorage.setItem(SPOT_KEY, JSON.stringify(SPOT_RECORD));
    // 2026-09-06, a Sunday INSIDE the Sept 1-15 resident goose season, forty-odd
    // minutes before the sun-derived window would have opened. Everything the
    // FIELD face keys on is present — a real season, a real computed window, a
    // countdown about to run — and the day is still shut. This is the exact
    // shape that put a running field countdown in front of a closed morning.
    render(<FieldPage now={new Date(2026, 8, 6, 5, 15, 0, 0)} />);

    expect(screen.getByText("prep", { selector: "span" })).toBeInTheDocument();
    expect(screen.queryByText("field", { selector: "span" })).not.toBeInTheDocument();
    expect(screen.getByText(/No waterfowl hunting in Maryland today/i)).toBeInTheDocument();
    expect(fetchCalls).toBe(0);
  });

  it("counts forward to the next OPEN day, skipping the closed Sunday itself", () => {
    localStorage.setItem(SPOT_KEY, JSON.stringify(SPOT_RECORD));
    render(<FieldPage now={new Date(2026, 8, 6, 5, 15, 0, 0)} />);
    // Monday the 7th, not the Sunday it is standing on.
    expect(screen.getByText(/next open day 2026-09-07/)).toBeInTheDocument();
  });
});
