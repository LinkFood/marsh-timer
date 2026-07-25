/**
 * Vitest setup for the browser tree.
 *
 * `vitest.config.ts` has pointed `setupFiles` at this path since it was written,
 * but the file never existed — so every `npm test` run failed at collection and
 * no test under `src/` could run at all. Created here because the frequency
 * card's end-to-end test is the first one that needs it.
 *
 * (Note for whoever reads this next: the config's `include` is `src/**` only, so
 * the three suites under `scripts/mine/` are still not run by `npm test`. That is
 * a separate gap and is left alone deliberately.)
 */
import "@testing-library/jest-dom/vitest";
