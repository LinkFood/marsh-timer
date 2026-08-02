/**
 * SkyRail.test.tsx — the copy, verbatim, in every state it can be in.
 *
 * These are assertions about SENTENCES, which is unusual and is deliberate. The
 * defect this rail was rewritten to remove was not a wrong number — every number
 * on the old rail was correct. It was a sentence whose implication ran past its
 * evidence: *"Enough moon, up most of the dark — if clear, they could feed"*,
 * read at 05:15 as "and therefore your morning is dead", when the one direct
 * test of that link came back at −0.4% with a 95% CI of −9% to +9%.
 *
 * A wrong sentence cannot be caught by a type or by a range check. It can only
 * be caught by pinning the words, so the words are pinned.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SkyRail } from "./SkyRail";
import type { NightMoon } from "./moonNight";

const WOOLFORD = "8571807"; // the reference spot's station — unmeasured
const BISHOPS_HEAD = "8571421"; // the station the dossier measured

/** A bright night on the Maryland calendar: 2026-09-01 is 80% lit. */
const BRIGHT = "2026-09-01";
/** A dark one: 2026-09-07 is 16% lit. */
const DARK = "2026-09-07";

const SUNSET = new Date("2026-09-01T23:40:00Z");
const SUNRISE = new Date("2026-09-02T10:35:00Z");
const DARK_MS = SUNRISE.getTime() - SUNSET.getTime();

function night(over: Partial<Extract<NightMoon, { status: "ok" }>> = {}): NightMoon {
  return {
    status: "ok",
    windowStart: SUNSET,
    windowEnd: SUNRISE,
    darkMs: DARK_MS,
    aboveMs: DARK_MS * 0.9,
    spans: [{ start: SUNSET, end: new Date(SUNSET.getTime() + DARK_MS * 0.9) }],
    allNight: false,
    neverUp: false,
    ...over,
  };
}

function draw(day: string, n: NightMoon, stationId: string | null = WOOLFORD) {
  return render(
    <SkyRail
      sunrise={SUNRISE}
      sunset={SUNSET}
      polar="none"
      moonRise={SUNSET}
      moonSet={SUNRISE}
      night={n}
      day={day}
      stationId={stationId}
    />,
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */

describe("the claim states what is measured and stops there", () => {
  it("says light lengthens NIGHT feeding, and never reaches this morning", () => {
    draw(BRIGHT, night());
    expect(
      screen.getByText("Enough moon, up most of the dark. Light like that lengthens night feeding."),
    ).toBeInTheDocument();
  });

  it("says the same for a moon up edge to edge", () => {
    draw(BRIGHT, night({ allNight: true, aboveMs: DARK_MS }));
    expect(
      screen.getByText("Up all night and over half lit. Light like that lengthens night feeding."),
    ).toBeInTheDocument();
  });

  it("says there was no light to feed by when the moon never cleared the horizon", () => {
    draw(BRIGHT, night({ neverUp: true, aboveMs: 0, spans: [] }));
    expect(
      screen.getByText("The moon never cleared the horizon. There was no moonlight to feed by."),
    ).toBeInTheDocument();
  });

  it("says not much light on a moon under half a disc", () => {
    draw(DARK, night({ aboveMs: DARK_MS * 0.4 }));
    expect(screen.getByText("Under half a disc — not much light to feed by.")).toBeInTheDocument();
  });

  it("says the rest was black on a bright moon that was down most of the dark", () => {
    draw(BRIGHT, night({ aboveMs: DARK_MS * 0.3 }));
    expect(
      screen.getByText("Over half lit, but down most of the dark. The rest was black."),
    ).toBeInTheDocument();
  });

  /**
   * THE REGRESSION. The old copy, and the shape of the old copy.
   */
  it("never says they fed, never says they could feed, never conditions on a clear sky", () => {
    for (const day of [BRIGHT, DARK]) {
      for (const n of [night(), night({ allNight: true }), night({ neverUp: true, spans: [] })]) {
        const { container, unmount } = draw(day, n);
        const text = container.textContent ?? "";
        expect(text).not.toMatch(/they fed/i);
        expect(text).not.toMatch(/they could feed/i);
        expect(text).not.toMatch(/if clear/i);
        expect(text).not.toMatch(/if it was clear/i);
        unmount();
      }
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe("the disclosure is a constant, not a branch", () => {
  const EXPECTED =
    "Whether that changes this morning has never been measured — not in ducks, not in anything.";

  it("renders on every path that makes a claim about the night", () => {
    for (const day of [BRIGHT, DARK]) {
      for (const n of [
        night(),
        night({ allNight: true, aboveMs: DARK_MS }),
        night({ neverUp: true, aboveMs: 0, spans: [] }),
        night({ aboveMs: DARK_MS * 0.3 }),
      ]) {
        const { unmount } = draw(day, n);
        expect(screen.getByText(EXPECTED)).toBeInTheDocument();
        unmount();
      }
    }
  });

  it("carries the one direct estimate WITH its interval, and the opposite-signed finding", () => {
    const { container } = draw(BRIGHT, night());
    const text = container.textContent ?? "";
    expect(text).toContain("one direct test of last night on next morning: −0.4%");
    expect(text).toContain("95% CI −9% to +9%");
    expect(text).toContain("105 GPS ducks, 1,984 bird-days");
    // The half that cuts against the belief has to be there too, or the card is
    // quoting only the convenient direction of its own source.
    expect(text).toContain("23% MORE on bright clear nights");
    expect(text).toContain("no less next day");
  });

  it("cites the dossier by path", () => {
    const { container } = draw(BRIGHT, night());
    expect(container.textContent ?? "").toContain("MOONLIGHT-AND-THE-MORNING-2026-08-01.md");
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe("the base rate gives the reading a denominator", () => {
  it("counts upward on a bright moon and prints n on the glass", () => {
    draw(BRIGHT, night());
    expect(screen.getByText("at least this lit")).toBeInTheDocument();
    expect(screen.getByText(/\d+% of 162 season days/)).toBeInTheDocument();
  });

  it("counts downward on a dark moon, because the bright tail would answer nothing", () => {
    draw(DARK, night());
    expect(screen.getByText("this dark or darker")).toBeInTheDocument();
    expect(screen.queryByText("at least this lit")).not.toBeInTheDocument();
  });

  it("names the window the denominator came from", () => {
    const { container } = draw(BRIGHT, night());
    expect(container.textContent ?? "").toContain(
      "162 published MD duck + goose season days, 2026-09-01 → 2027-03-10",
    );
  });

  it("says out loud that it counted ONE variable, and which", () => {
    // Dossier §5 rule 1: illumination and hours-above-horizon are r = 0.988.
    const { container } = draw(BRIGHT, night());
    expect(container.textContent ?? "").toContain(
      "illumination only — hours-up is the same variable (r = 0.988)",
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe("the dawn tide is beside the moon on every path — dossier §5 rule 3", () => {
  it("refuses by station id under the reference spot, and shows no water", () => {
    const { container } = draw(BRIGHT, night(), WOOLFORD);
    expect(screen.getByText("dawn tide")).toBeInTheDocument();
    expect(screen.getByText(`not computed for ${WOOLFORD}`)).toBeInTheDocument();
    const text = container.textContent ?? "";
    expect(text).toContain("The moon sets the hour of high water, not just its height");
    // The trap: Bishops Head's numbers under a Woolford spot.
    expect(text).not.toContain("Bishops Head");
    expect(text).not.toContain("1.6 ft");
    expect(text).not.toContain('19"');
  });

  it("refuses by name when no station is bound", () => {
    draw(BRIGHT, night(), null);
    expect(screen.getByText("dawn tide")).toBeInTheDocument();
    expect(screen.getByText("no station bound")).toBeInTheDocument();
  });

  it("renders the reading, the sentence and the counts when the station IS packed", () => {
    const { container } = draw(BRIGHT, night(), BISHOPS_HEAD);
    const text = container.textContent ?? "";
    expect(screen.getByText('19" spring vs quarter')).toBeInTheDocument();
    expect(
      screen.getByText(
        "Full and new moons put lower water here at 07:00 — 1.6 ft higher on the quarters. " +
          "That is the tide, not the light.",
      ),
    ).toBeInTheDocument();
    expect(text).toContain("n = 141 full / 140 new / 128 quarter");
    expect(text).toContain("Oct 15 – Jan 31, ten seasons 2015-16 → 2024-25");
  });

  it("is present on EVERY branch, including the ones where the night refuses", () => {
    const unknown: NightMoon = { status: "unknown", message: "no dark window here" };
    for (const [day, n, station] of [
      [BRIGHT, night(), WOOLFORD],
      [DARK, night({ neverUp: true, spans: [] }), null],
      [BRIGHT, unknown, WOOLFORD],
      [BRIGHT, unknown, BISHOPS_HEAD],
    ] as const) {
      const { unmount } = draw(day, n, station);
      expect(screen.getByText("dawn tide")).toBeInTheDocument();
      unmount();
    }
  });

  it("never states a coast-wide rule about where springs put dawn water", () => {
    for (const station of [WOOLFORD, BISHOPS_HEAD, null]) {
      const { container, unmount } = draw(BRIGHT, night(), station);
      const text = container.textContent ?? "";
      expect(text).not.toMatch(/full and new moons put low water at dawn/i);
      expect(text).not.toMatch(/on this coast,? springs/i);
      unmount();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe("what the rail still refuses to become", () => {
  it("renders no score, no rating and no verdict", () => {
    const { container } = draw(BRIGHT, night({ allNight: true }));
    const text = (container.textContent ?? "").toLowerCase();
    for (const banned of ["score", "rating", "excellent", "good moon", "go / no-go", "out of 10"]) {
      expect(text).not.toContain(banned);
    }
  });

  it("states the missing sky, and does NOT code cloud as a subtraction — rule 2", () => {
    const { container } = draw(BRIGHT, night());
    const text = container.textContent ?? "";
    expect(text).toContain("overnight cloud cover is NOT known here");
    // Kyba 2011: cloud AMPLIFIES ground light near a town, 10.1× inside a city.
    // A "cloud blocks the moon" rule is a known-wrong physical model over a
    // large fraction of Maryland tidewater, so the card names both directions.
    expect(text).toContain("cloud does not simply subtract");
    expect(text).not.toMatch(/cloud blocks the moon/i);
  });

  it("still prints the hours-above-horizon reading it was built around", () => {
    draw(BRIGHT, night());
    expect(screen.getByText("up overnight")).toBeInTheDocument();
    expect(screen.getByText(/of .* dark hrs/)).toBeInTheDocument();
  });
});
