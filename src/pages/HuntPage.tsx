import FieldPage from "./FieldPage";

/**
 * THE HUNT (/hunt) — the route, and nothing else.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE TAB BAR IS GONE. IT WAS THE WRONG IDEA AND IT WAS WRONG STRUCTURALLY.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * This file used to hold three tabs — FIELD, PREP, PLAN — and a stub under each.
 * They are deleted, not hidden, and there is no route to them.
 *
 * FIELD, PREP and PLAN are not places. THEY ARE DISTANCES IN TIME FROM THE HUNT:
 * weeks out is PLAN, the night before is PREP, standing in the blind is FIELD.
 * The app already holds every input needed to know which one is true — the
 * clock, the calendar day, the season windows in `src/data/regs/mdSeasons.ts`
 * and the frozen spot. Asking a gloved hand in the dark to tap a tab so the app
 * can be told something it can derive is the opposite of an instrument.
 * `selectMode` in `src/components/field/fieldSeason.ts` picks it, and the
 * thresholds are named and argued in that file rather than buried here.
 *
 * There is a second reason, and it is the load-bearing one. The gates a hunter
 * evaluates are a CONJUNCTION — legal light AND water AND light AND season —
 * and he cannot evaluate an AND if he has to navigate to see the operands. A
 * tide gate on another tab cannot be conjoined with the moon. The tab bar was
 * not a neutral container for the product; it broke the exact cognitive act the
 * product exists to support.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE STILL EXISTS AT ALL, AND WHY IT IS ONE LINE.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * `src/App.tsx` lazy-loads this route, and `FieldPage.tsx` is named in the
 * offline `files:` glob in `eslint.config.js` — no Supabase by any import path,
 * no bare `fetch`, no `window.fetch`, no `globalThis.fetch`. Keeping the route
 * as a thin pass-through means the surface itself stays inside that boundary and
 * cannot acquire a network import by having a wrapper quietly grow one and pass
 * the result down as a prop.
 *
 * The previous version of this file imported `@/lib/supabase` to report whether
 * the backend was configured. That import is gone with the PREP tab that needed
 * it. If a save-the-spot flow lands later it belongs in its own route with its
 * own online licence — resolved once, with bars, and frozen. NOT here, and not
 * on the surface a man reads at 05:15 with no signal.
 */
export default function HuntPage() {
  return <FieldPage />;
}
