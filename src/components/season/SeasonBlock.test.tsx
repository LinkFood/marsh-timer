import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SeasonBlock from "./SeasonBlock";
import { buildSeasonModel, type SeasonRow } from "@/lib/season";

/**
 * The display contract, read back off the DOM. Three things have to survive
 * every future edit to this component: the countdown says WHICH season the date
 * belongs to, a provisional date is labelled on the card in the state's own
 * words, and a missing link is admitted rather than rendered as a dead anchor.
 */

const TODAY = "2026-07-24";
const YEAR = "2026-2027";

const row = (over: Partial<SeasonRow> & { id: string }): SeasonRow => ({
  species_id: "duck",
  state_abbr: "MD",
  season_type: "opener",
  zone: "Western Zone",
  dates: [{ open: "2026-10-03" }],
  notes: null,
  source_url: "https://dnr.maryland.gov/regs",
  season_year: YEAR,
  status: "ok",
  provisional: false,
  ...over,
});

function renderBlock(rows: SeasonRow[], today = TODAY) {
  render(
    <SeasonBlock
      stateName="Maryland"
      seasonYear={YEAR}
      load={{ s: "ok", v: buildSeasonModel(rows, today, YEAR) }}
    />,
  );
}

describe("SeasonBlock", () => {
  it("counts down and names the season the date belongs to", () => {
    renderBlock([
      row({ id: "d", source_records: 6 }),
      row({
        id: "g",
        species_id: "goose",
        zone: "Early Resident Canada Goose - Eastern Zone",
        dates: [{ open: "2026-09-01" }],
        source_records: 14,
      }),
    ]);

    expect(screen.getByText(/Goose season opens September 1\./)).toBeInTheDocument();
    expect(screen.getByText(/39 days out\./)).toBeInTheDocument();
    expect(screen.getByText("Early Resident Canada Goose - Eastern Zone")).toBeInTheDocument();
    expect(screen.getByText(/the earliest of 14 goose seasons Maryland publishes/)).toBeInTheDocument();
    // The other species keeps its own line rather than being folded away.
    expect(screen.getByText(/Duck season/)).toBeInTheDocument();
  });

  it("renders provisional on the card, with the state's own wording", () => {
    renderBlock([
      row({
        id: "d",
        provisional: true,
        provisional_note: "Season dates are contingent upon approval from the US Fish and Wildlife Service.",
      }),
    ]);
    expect(
      screen.getByText("State-published, pending federal frameworks (due Aug 31)."),
    ).toBeInTheDocument();
    expect(screen.getByText(/contingent upon approval/)).toBeInTheDocument();
  });

  it("says nothing at all when the state's dates are final", () => {
    renderBlock([row({ id: "d", provisional: false })]);
    expect(screen.queryByText(/pending federal frameworks/)).toBeNull();
    expect(screen.queryByText(/no final-or-provisional label/)).toBeNull();
  });

  it("calls an unlabelled date unknown, never final", () => {
    renderBlock([row({ id: "d", provisional: null })]);
    expect(screen.getByText(/We hold no final-or-provisional label/)).toBeInTheDocument();
  });

  it("names an absent species with the state's own reason and the re-check date", () => {
    renderBlock([
      row({ id: "d" }),
      row({
        id: "g",
        species_id: "goose",
        status: "not_published",
        dates: [],
        notes: "NOT YET PUBLISHED. The DNR page says information will be posted by Aug. 1.",
        recheck_after: "2026-08-01",
      }),
    ]);
    expect(screen.getByText(/No goose opener — Maryland has not published its goose dates\./)).toBeInTheDocument();
    expect(screen.getByText(/information will be posted by Aug\. 1/)).toBeInTheDocument();
    expect(screen.getByText(/re-check after August 1, 2026/)).toBeInTheDocument();
  });

  it("admits a missing link rather than linking nowhere", () => {
    renderBlock([row({ id: "d", source_url: null })]);
    expect(
      screen.getByText(/we hold no official link for Maryland’s waterfowl regulations/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("links out for zones, splits and bag limits instead of restating them", () => {
    renderBlock([row({ id: "d" })]);
    const link = screen.getByRole("link", { name: /Maryland’s own dates/ });
    expect(link).toHaveAttribute("href", "https://dnr.maryland.gov/regs");
    expect(screen.getByText(/we do not restate them/)).toBeInTheDocument();
  });

  it("keeps the honest absence when nothing current is held", () => {
    renderBlock([
      row({ id: "old", season_year: "2025-2026", dates: [{ open: "2025-10-04", close: "2026-01-31" }] }),
    ]);
    expect(screen.getByText(/We don’t hold Maryland’s 2026-27 waterfowl openers\./)).toBeInTheDocument();
    expect(screen.getByText(/all stamped 2025-26/)).toBeInTheDocument();
  });

  it("distinguishes a failed read from an absence", () => {
    render(<SeasonBlock stateName="Maryland" seasonYear={YEAR} load={{ s: "error" }} />);
    expect(screen.getByText(/The season table did not answer/)).toBeInTheDocument();
  });
});
