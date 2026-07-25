import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import FrequencyCard from "./FrequencyCard";
import { encodeSeriesColumn, toByteaHex, type SeriesColumnRow } from "@/lib/board/frequency";

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
 * invents its input would be worse than one that says it did not run.
 */

const CACHE = join(process.cwd(), "scripts/frames/.frame-cache/series-ghcn-md.json");
const haveCache = existsSync(CACHE);

function marylandColumn(): SeriesColumnRow {
  const cached = JSON.parse(readFileSync(CACHE, "utf-8")) as {
    fields: Record<string, Record<string, number>>;
  };
  const series = new Map(Object.entries(cached.fields.avg_high_f));
  const enc = encodeSeriesColumn(series);
  return {
    instrument_id: "ghcn-md",
    metric: "avg_high_f",
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

describe.skipIf(!haveCache)("FrequencyCard — real numbers, real wire format", () => {
  it("states the count, the threshold in °F, and the most recent occasion", () => {
    render(
      <FrequencyCard stateName="Maryland" on="2026-10-10" load={{ s: "ok", v: marylandColumn() }} />,
    );

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
    render(
      <FrequencyCard stateName="Maryland" on="2026-10-10" load={{ s: "ok", v: marylandColumn() }} />,
    );
    // 1% → 9 occasions in only 8 distinct years: under the 10-year floor.
    expect(screen.getByRole("button", { name: /coldest 1%\s*refuses/ })).toBeInTheDocument();
    // 2% → 21 occasions in 18 years, 5% → 46 in 38. Both clear the floors.
    expect(screen.getByRole("button", { name: /coldest 2%\s*21 times/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /coldest 5%\s*46 times/ })).toBeInTheDocument();
  });

  it("normalizes the decade bars per year, starts at the 1980s, and marks the 2020s partial", () => {
    render(
      <FrequencyCard stateName="Maryland" on="2026-10-10" load={{ s: "ok", v: marylandColumn() }} />,
    );
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
    render(
      <FrequencyCard stateName="Maryland" on="2026-10-10" load={{ s: "ok", v: marylandColumn() }} />,
    );
    expect(screen.getByText("Maryland statewide. Not your marsh.")).toBeInTheDocument();
    expect(screen.getByText(/air temperature, not pressure/)).toBeInTheDocument();
    expect(screen.getByText(/6,121 to 7,771 stations/)).toBeInTheDocument();
  });

  it("refuses honestly when the column has not been baked", () => {
    render(<FrequencyCard stateName="Maryland" on="2026-10-10" load={{ s: "ok", v: null }} />);
    expect(screen.getByRole("heading", { name: /We can’t count this yet\./ })).toBeInTheDocument();
    expect(screen.queryByText(/has happened/)).toBeNull();
  });

  it("distinguishes a failed read from an absent record", () => {
    render(<FrequencyCard stateName="Maryland" on="2026-10-10" load={{ s: "error" }} />);
    expect(screen.getByText(/The archive did not answer/)).toBeInTheDocument();
    expect(screen.queryByText(/We can’t count this yet/)).toBeNull();
  });
});
