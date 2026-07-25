import { describe, expect, it } from "vitest";
import { TAIL_DEPTH_IS_COMPARABLE } from "./tailDepthGate";
import { WITHHELD_FILL, depthClause, depthWord, fillFor, rarityClause } from "./rarity";

/**
 * THE GATE, PINNED.
 *
 * The claim being withheld is a percentile, and a percentile leaks as a digit.
 * These tests assert the shape of the withholding rather than its wording, so
 * the copy can be edited freely and a re-leak still fails the suite: while
 * `TAIL_DEPTH_IS_COMPARABLE` is false, no depth-derived string may contain a
 * number, and no state with a reading may be painted on the ramp.
 *
 * Every assertion is written against the flag, so the day it flips to true this
 * file tests the restored behaviour instead of the withheld one and stays green
 * without an edit.
 */

const withReading = { abbr: "CA", depth: 0.99, side: "high" as const };
const atLimit = { abbr: "TX", depth: 1, side: "low" as const };
const noReading = { abbr: "DC", depth: null, side: null };

const hasDigit = (s: string) => /\d/.test(s);

describe("the tail-depth gate", () => {
  it("withholds every percentile while it is closed", () => {
    if (TAIL_DEPTH_IS_COMPARABLE) {
      expect(rarityClause(withReading, "2026-07-25", 72)).toContain("99");
      return;
    }
    expect(hasDigit(rarityClause(withReading, "2026-07-25", 72))).toBe(false);
    expect(hasDigit(rarityClause(atLimit, "2026-07-25", 76))).toBe(false);
    expect(hasDigit(depthWord(withReading))).toBe(false);
    expect(hasDigit(depthClause(withReading))).toBe(false);
  });

  it("withholds the direction too — hot vs cold is the 18.1% that flips", () => {
    if (TAIL_DEPTH_IS_COMPARABLE) return;
    for (const s of [
      depthWord(withReading),
      depthClause(withReading),
      rarityClause(withReading, "2026-07-25", 72),
    ]) {
      expect(s).not.toMatch(/hot|cold|warm|cool/i);
    }
  });

  it("paints a withheld state flat, never on the ramp", () => {
    if (TAIL_DEPTH_IS_COMPARABLE) return;
    expect(fillFor(withReading)).toBe(WITHHELD_FILL);
    expect(fillFor(atLimit)).toBe(WITHHELD_FILL);
  });

  it("still distinguishes a withheld reading from no reading at all", () => {
    expect(fillFor(noReading)).toBeNull();
    expect(fillFor(withReading)).not.toBeNull();
    expect(depthWord(noReading)).toBe("no reading on file");
    expect(depthWord(withReading)).not.toBe(depthWord(noReading));
  });
});
