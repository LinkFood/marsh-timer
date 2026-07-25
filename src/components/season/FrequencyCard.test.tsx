import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import FrequencyCard, { type MetricAvailability } from "./FrequencyCard";
import {
  CARD_METRICS,
  encodeSeriesColumn,
  toByteaHex,
  type SeriesColumnRow,
} from "@/lib/board/frequency";

/**
 * The card, end to end, on real data through the real wire format.
 *
 * No fixture and no mock: this reads Maryland's actual 76-year GHCN series out of
 * the warm frame cache, runs it through the SAME encoder the bake runs, hands the
 * component the SAME `\x…` hex row PostgREST will hand it, and reads the sentence
 * back off the DOM. If the encoder, the decoder, the pool, the episode merge or
 * the phrasing drift apart, this fails.
 *
 * The expected numbers are the ones `bake-series-columns.ts --card MD 10-10`
 * prints, and they are the numbers Amendment 1.3's measured band table quotes.
 *
 * SKIPS when the cache is absent (it is gitignored, 35 MB): a test that silently
 * invents its input would be worse than one that says it did not run. The
 * precipitation and snow cases skip separately, because those fields only land in
 * the cache once `warm-series-cache.ts` has run.
 */

const CACHE = join(process.cwd(), "scripts/frames/.frame-cache/series-ghcn-md.json");
const haveCache = existsSync(CACHE);

function cachedFields(): Record<string, Record<string, number>> {
  return (JSON.parse(readFileSync(CACHE, "utf-8")) as { fields: Record<string, Record<string, number>> }).fields;
}

const haveCardMetrics =
  haveCache && CARD_METRICS.every((m) => Object.keys(cachedFields()[m.metric] ?? {}).length > 0);

function marylandColumn(metric = "avg_high_f"): SeriesColumnRow {
  const series = new Map(Object.entries(cachedFields()[metric]));
  const enc = encodeSeriesColumn(series);
  return {
    instrument_id: "ghcn-md",
    metric,
    first_day: enc.firstDay,
    n_days: enc.nDays,
    scale: enc.scale,
    readings: toByteaHex(enc.bytes),
    n_present: enc.nPresent,
    first_year: enc.firstYear,
    last_year: enc.lastYear,
    source: "GHCN-Daily state-day means (NOAA ACIS)",
  };
}

const fullMenu: MetricAvailability[] = CARD_METRICS.map((m) => ({
  metric: m.metric,
  n_present: 27759,
  first_year: 1950,
  last_year: 2025,
}));

function card(metric = "avg_high_f", opts: { menu?: MetricAvailability[]; load?: any } = {}) {
  return (
    <FrequencyCard
      stateName="Maryland"
      on="2026-10-10"
      menu={{ s: "ok", v: opts.menu ?? fullMenu }}
      metric={metric}
      onMetric={() => {}}
      load={opts.load ?? { s: "ok", v: marylandColumn(metric) }}
    />
  );
}

describe.skipIf(!haveCache)("FrequencyCard — real numbers, real wire format", () => {
  it("states the count, the threshold in °F, and the most recent occasion", () => {
    render(card());

    // Default band is the coldest 5%. Measured: 80 matched days → 46 occasions
    // over 38 distinct years, threshold 58.2 °F, most recent episode 2022-10-19.
    expect(
      screen.getByRole("heading", {
        name: /A daytime high of 58\.2 °F or colder over Maryland, within 10 days of October 10, has happened 46 times since 1950\./,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Most recently October 19, 2022.")).toBeInTheDocument();

    // Ruling 4b — a census takes no confidence interval. The failure mode this
    // guards is a rendered range ("18% to 57%") or a ± band, not the receipt
    // line that says one is deliberately absent.
    expect(screen.queryByText(/\d+(\.\d+)?\s*%?\s*(to|–|—)\s*\d+(\.\d+)?\s*%/)).toBeNull();
    // Ruling 4 — no forward join, ever.
    expect(screen.queryByText(/followed by|what followed|in \d+ of those/i)).toBeNull();
  });

  it("shows every band with what it yields, and marks the ones that refuse", () => {
    render(card());
    // 1% → 9 occasions in only 8 distinct years: under the 10-year floor.
    expect(screen.getByRole("button", { name: /coldest 1%\s*refuses/ })).toBeInTheDocument();
    // 2% → 21 occasions in 18 years, 5% → 46 in 38. Both clear the floors.
    expect(screen.getByRole("button", { name: /coldest 2%\s*21 times/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /coldest 5%\s*46 times/ })).toBeInTheDocument();
  });

  it("normalizes the decade bars per year, starts at the 1980s, and marks the 2020s partial", () => {
    render(card());
    expect(
      screen.getByRole("img", { name: "1980s: 9 in 10 years of record, 0.90 per year" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "2020s: 2 in 6 years of record, 0.33 per year, partial decade" }),
    ).toBeInTheDocument();
    // 1979 and earlier are counted and named, never given a bar (Ruling 10.4).
    expect(screen.queryByText("1970s")).toBeNull();
    expect(screen.getByText(/18 of the 46 fell before 1980/)).toBeInTheDocument();
  });

  it("carries the honesty line and never claims to be the pressure card", () => {
    render(card());
    expect(screen.getByText("Maryland statewide. Not your marsh.")).toBeInTheDocument();
    expect(screen.getByText(/This is not the pressure card/)).toBeInTheDocument();
    expect(screen.getByText(/6,121 to 7,771 stations/)).toBeInTheDocument();
  });

  it("refuses honestly when the column has not been baked", () => {
    render(card("avg_high_f", { load: { s: "ok", v: null } }));
    expect(screen.getByRole("heading", { name: /We can’t count this yet\./ })).toBeInTheDocument();
    expect(screen.queryByText(/has happened/)).toBeNull();
  });

  it("distinguishes a failed read from an absent record", () => {
    render(card("avg_high_f", { load: { s: "error" } }));
    expect(screen.getByText(/The archive did not answer/)).toBeInTheDocument();
    expect(screen.queryByText(/We can’t count this yet/)).toBeNull();
  });
});

/* ───────────────── the water and the freeze — the new metrics ──────────────── */

describe.skipIf(!haveCardMetrics)("FrequencyCard — the metrics a duck hunter asks about", () => {
  it("offers every question the archive holds, and disables the ones it does not", () => {
    render(card("avg_high_f", { menu: fullMenu.filter((m) => m.metric !== "snowfall_in") }));
    expect(screen.getByRole("button", { name: /rain, statewide/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /snowfall\s*not held here/ })).toBeDisabled();
  });

  // The direction is a DECISION per metric: rain is counted at the WET end, and
  // the sentence is rain's own English rather than temperature's.
  it("counts rain at the wet end and says so in rain's own words", () => {
    render(card("avg_precip_in"));
    expect(
      screen.getByRole("heading", {
        name: /0\.65 in of rain or more, averaged across Maryland, within 10 days of October 10, has happened 66 times since 1950\./,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Most recently October 1, 2022.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /wettest 5%\s*66 times/ })).toBeInTheDocument();
    // …and never in temperature's.
    expect(screen.queryByText(/colder|warmer/)).toBeNull();
  });

  it("counts the overnight low at the cold end", () => {
    render(card("avg_low_f"));
    expect(
      screen.getByRole("heading", {
        name: /An overnight low of 35\.2 °F or colder over Maryland, within 10 days of October 10, has happened 54 times since 1950\./,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /coldest 1%\s*15 times/ })).toBeInTheDocument();
  });

  // THE TIE FLOOR. Maryland in mid-October is 99.7% snow-free, so a "snowiest 5%"
  // band is a rank drawn through 1,591 identical zeros. The card must say that
  // rather than print a count — and must NOT invite a wider band, which would only
  // swallow more zeros.
  it("refuses a band whose edge is a mass of identical readings, and does not invite a wider one", () => {
    render(card("snowfall_in"));
    expect(
      screen.getByRole("heading", { name: /Maryland’s record can’t answer this one\./ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/read exactly the same value/)).toBeInTheDocument();
    expect(screen.getByText(/Widening the band makes that worse/)).toBeInTheDocument();
    expect(screen.queryByText(/has happened/)).toBeNull();
    // No decade bars under a refusal — a chart is a claim.
    expect(screen.queryByRole("img", { name: /years of record/ })).toBeNull();
    // Every band refuses, and the chips say so rather than showing a count.
    for (const pct of ["1%", "2%", "5%"]) {
      expect(screen.getByRole("button", { name: new RegExp(`snowiest ${pct}\\s*refuses`) })).toBeInTheDocument();
    }
  });
});
