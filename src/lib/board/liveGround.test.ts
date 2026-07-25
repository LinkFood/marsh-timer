import { describe, expect, it } from "vitest";
import {
  NOTHING_LIVE_FILL,
  busiestFirst,
  liveClause,
  liveFill,
  liveStates,
  liveWord,
  tallyLive,
} from "./liveGround";
import type { FormationWatch, StateAlert } from "@/lib/board/frameStore";

/**
 * The live lanes are what the front-door map shades by while tail depth is
 * withheld, so the two failure modes that matter are pinned here: calling a
 * state quiet when it is not, and inventing a temperature direction out of
 * products that do not carry one.
 */

const alert = (over: Partial<StateAlert> & { state: string }): StateAlert => ({
  eventType: "Flood Watch",
  severity: "Severe",
  allEventTypes: ["Flood Watch"],
  ...over,
});

const watch = (lead_id: string, states: string[]): FormationWatch => ({
  id: `${lead_id}-${states.join("")}`,
  lead_id,
  states,
  status: "forming",
  opened_at: "2026-07-24",
  copy: "",
  evidence: null,
  precedents: null,
  claim_fire_id: null,
});

const alertsOf = (...as: StateAlert[]) => new Map(as.map((a) => [a.state, a]));

describe("liveStates", () => {
  it("a state with nothing live is a fact, not an absence", () => {
    const live = liveStates(new Map(), []);
    expect(live.get("MD")).toBeUndefined();
    expect(liveFill(live.get("MD"))).toBe(NOTHING_LIVE_FILL);
    expect(liveClause(live.get("MD"))).toBe("nothing live on it right now");
    expect(liveWord(live.get("MD"))).toBe("nothing live");
  });

  it("carries NWS event names verbatim and never renames them", () => {
    const live = liveStates(
      alertsOf(alert({ state: "MN", eventType: "Tornado Watch", severity: "Extreme", allEventTypes: ["Tornado Watch"] })),
      [],
    );
    expect(live.get("MN")!.products).toEqual(["Tornado Watch"]);
    expect(liveWord(live.get("MN"))).toBe("Tornado Watch");
  });

  it("an Extreme product tops the ramp regardless of count", () => {
    const live = liveStates(
      alertsOf(alert({ state: "MN", severity: "Extreme", allEventTypes: ["Tornado Watch"] })),
      [],
    );
    expect(live.get("MN")!.band).toBe(3);
  });

  it("bands by how much is standing, watches counting alongside products", () => {
    const live = liveStates(
      alertsOf(alert({ state: "GA", allEventTypes: ["Flood Watch"] })),
      [watch("precip-flood-forming", ["GA"]), watch("flood-forming", ["AR"])],
    );
    expect(live.get("GA")!.band).toBe(2); // one product + one watch
    expect(live.get("AR")!.band).toBe(1); // one watch, no product
  });

  it("reads a temperature direction only when the products agree", () => {
    const heat = liveStates(
      alertsOf(alert({ state: "CA", allEventTypes: ["Extreme Heat Warning", "Red Flag Warning"] })),
      [],
    );
    expect(heat.get("CA")!.axis).toBe("high");

    const neutral = liveStates(
      alertsOf(alert({ state: "GA", allEventTypes: ["Flood Watch", "Flood Warning"] })),
      [],
    );
    expect(neutral.get("GA")!.axis).toBeNull();

    const conflicting = liveStates(
      alertsOf(alert({ state: "MT", allEventTypes: ["Red Flag Warning", "Freeze Warning"] })),
      [],
    );
    expect(conflicting.get("MT")!.axis).toBeNull();
  });

  it("names formation leads with the site's one word for each, and skips unknown leads", () => {
    const live = liveStates(new Map(), [watch("precip-flood-forming", ["NC"]), watch("not-a-lead", ["NC"])]);
    expect(live.get("NC")!.leads).toEqual(["flood ground"]);
  });
});

describe("tallyLive", () => {
  it("counts states with something standing, not rows", () => {
    const alerts = alertsOf(
      alert({ state: "MN", severity: "Extreme", allEventTypes: ["Tornado Watch"] }),
      alert({ state: "GA", allEventTypes: ["Flood Watch", "Flood Warning"] }),
    );
    const watches = [watch("flood-forming", ["AR", "GA"])];
    const live = liveStates(alerts, watches);
    expect(tallyLive(live, watches)).toEqual({
      states: 3,
      extremeStates: 1,
      watchStates: 2,
      watches: 1,
    });
  });
});

describe("busiestFirst", () => {
  it("puts Extreme first, then the heaviest stack, then alphabetical by name", () => {
    const alerts = alertsOf(
      alert({ state: "MN", severity: "Extreme", allEventTypes: ["Tornado Watch"] }),
      alert({ state: "GA", allEventTypes: ["Flood Watch", "Flood Warning", "Flash Flood Warning"] }),
      alert({ state: "AZ", allEventTypes: ["Flash Flood Warning"] }),
    );
    expect(busiestFirst(liveStates(alerts, []), 5).map((s) => s.abbr)).toEqual(["MN", "GA", "AZ"]);
  });

  it("never lists a state with nothing live", () => {
    expect(busiestFirst(liveStates(new Map(), []), 5)).toEqual([]);
  });
});
