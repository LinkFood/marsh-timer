/**
 * The counting engine, on the browser's import path.
 *
 * The engine itself lives at `scripts/board/frequency.ts`, physically beside
 * `episodes.ts` and `tailDepth.ts` — the modules that define what a "time" is and
 * what the ±10-day window is. It stays there because those three must move
 * together: the bake, the verifier and this card all count through the same code,
 * and the moment one of them holds its own copy we are back to the ±10-vs-±15
 * split that Ruling 1 had to close.
 *
 * This file is the module boundary, nothing more. It adds no behaviour and holds
 * no numbers. Plan §6 anticipates exactly this shape: "thin service layer —
 * shared module consumed by the browser card."
 */
export * from "../../../scripts/board/frequency.ts";
