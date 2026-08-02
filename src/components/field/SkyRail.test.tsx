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

describe("the mechanism sentence is PREP, and FIELD keeps every reading", () => {
  /**
   * The claim is about a night that is already over. There is nothing a man
   * standing in the water with a gun in his other hand does with it, so it does
   * not print in FIELD. The DISCLOSURE that used to sit under it did not become
   * PREP-only with it — it moved to the foot of the surface and prints in every
   * mode, which `provenance.test.ts` pins. That is the stronger arrangement:
   * the moon NUMBERS print in FIELD whether the sentence does or not, and a
   * number is where the inference actually starts.
   */
  it("drops the mechanism claim in FIELD and keeps it in PREP", () => {
    const { unmount } = render(
      <SkyRail
        sunrise={SUNRISE}
        sunset={SUNSET}
        polar="none"
        moonRise={SUNSET}
        moonSet={SUNRISE}
        night={night()}
        day={BRIGHT}
        stationId={WOOLFORD}
        mode="field"
      />,
    );
    expect(screen.queryByText(/lengthens night feeding/i)).not.toBeInTheDocument();
    unmount();

    draw(BRIGHT, night()); // default mode is prep
    expect(screen.getByText(/lengthens night feeding/i)).toBeInTheDocument();
  });

  it("keeps every READING and every REFUSAL in FIELD — only prose is spent", () => {
    render(
      <SkyRail
        sunrise={SUNRISE}
        sunset={SUNSET}
        polar="none"
        moonRise={SUNSET}
        moonSet={SUNRISE}
        night={night()}
        day={BRIGHT}
        stationId={WOOLFORD}
        mode="field"
      />,
    );
    // The four readings, with their denominators, unchanged.
    expect(screen.getByText("up overnight")).toBeInTheDocument();
    expect(screen.getByText(/of .* dark hrs/)).toBeInTheDocument();
    expect(screen.getByText("at least this lit")).toBeInTheDocument();
    expect(screen.getByText(/\d+% of 162 season days/)).toBeInTheDocument();
    expect(screen.getByText("dawn tide")).toBeInTheDocument();
    expect(screen.getByLabelText("Sunrise")).toBeInTheDocument();
    expect(screen.getByLabelText("Moonset")).toBeInTheDocument();
    // And the dawn-tide refusal, at reading weight, in FIELD.
    expect(screen.getByText(/The moon sets the hour of high water/)).toBeInTheDocument();
  });

  it("carries no source, interval or dossier path any more — those moved to the foot", () => {
    // The regression this guards: somebody "restores" a citation to the rail and
    // the surface prints the same six sources six times again. The foot block is
    // the one place they live, and `provenance.test.ts` proves they are there.
    const { container } = draw(BRIGHT, night());
    const text = container.textContent ?? "";
    expect(text).not.toContain("MOONLIGHT-AND-THE-MORNING-2026-08-01.md");
    expect(text).not.toContain("95% CI −9% to +9%");
    expect(text).not.toContain("r = 0.988");
    expect(text).not.toContain("Schlyter");
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

  it("prints the denominator inline, in FIELD, where the number is", () => {
    // THE DENOMINATOR IS NOT PROVENANCE. `22% of 162 season days` is what makes
    // `80% lit` mean anything, and he reads it against the number in the moment
    // — so it stays on the rail in every mode. Only the WINDOW those 162 days
    // were drawn from, and the fact that one variable was counted, went to the
    // foot. See `provenance.test.ts`.
    render(
      <SkyRail
        sunrise={SUNRISE}
        sunset={SUNSET}
        polar="none"
        moonRise={SUNSET}
        moonSet={SUNRISE}
        night={night()}
        day={BRIGHT}
        stationId={WOOLFORD}
        mode="field"
      />,
    );
    expect(screen.getByText(/\d+% of 162 season days/)).toBeInTheDocument();
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

  it("renders the reading and the sentence when the station IS packed", () => {
    draw(BRIGHT, night(), BISHOPS_HEAD);
    // THE INCHES ARE THE READING and they print in every mode. The sentence
    // that says which way THIS station leans is PREP-weight, so it prints here
    // (the default mode is prep) and not in the blind. The station's sample
    // counts are provenance and moved to the foot — `provenance.test.ts` holds
    // them, including the trap of showing Bishops Head's counts under a
    // Woolford spot.
    expect(screen.getByText('19" spring vs quarter')).toBeInTheDocument();
    expect(
      screen.getByText(
        "Full and new moons put lower water here at 07:00 — 1.6 ft higher on the quarters. " +
          "That is the tide, not the light.",
      ),
    ).toBeInTheDocument();
  });

  it("drops the per-station sentence in FIELD and keeps the inches", () => {
    render(
      <SkyRail
        sunrise={SUNRISE}
        sunset={SUNSET}
        polar="none"
        moonRise={SUNSET}
        moonSet={SUNRISE}
        night={night()}
        day={BRIGHT}
        stationId={BISHOPS_HEAD}
        mode="field"
      />,
    );
    expect(screen.getByText('19" spring vs quarter')).toBeInTheDocument();
    expect(screen.queryByText(/That is the tide, not the light/)).not.toBeInTheDocument();
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

  it("never codes cloud as a subtraction, in any mode — rule 2", () => {
    // The stated absence itself — `overnight cloud cover is NOT known here`, and
    // which way it can cut — is provenance and lives at the foot of the surface
    // now; `provenance.test.ts` pins both halves of it. What is pinned HERE is
    // that the rail never acquires a cloud rule of its own, in either mode.
    // Kyba 2011 measured cloud AMPLIFYING ground light 10.1× inside a city, so
    // a "cloud blocks the moon" rule is a known-wrong physical model over a
    // large fraction of Maryland tidewater.
    for (const mode of ["field", "prep"] as const) {
      const { container, unmount } = render(
        <SkyRail
          sunrise={SUNRISE}
          sunset={SUNSET}
          polar="none"
          moonRise={SUNSET}
          moonSet={SUNRISE}
          night={night()}
          day={BRIGHT}
          stationId={WOOLFORD}
          mode={mode}
        />,
      );
      const text = container.textContent ?? "";
      expect(text).not.toMatch(/cloud blocks the moon/i);
      expect(text).not.toMatch(/cloud/i);
      unmount();
    }
  });

  it("still prints the hours-above-horizon reading it was built around", () => {
    draw(BRIGHT, night());
    expect(screen.getByText("up overnight")).toBeInTheDocument();
    expect(screen.getByText(/of .* dark hrs/)).toBeInTheDocument();
  });
});
