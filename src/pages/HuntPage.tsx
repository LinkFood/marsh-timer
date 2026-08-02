import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSpot } from "@/lib/spot";
import { lookupShootingHours } from "@/data/regs/shootingHours";

/**
 * THE HUNT (/hunt) — the shell only.
 *
 * Three tabs, in the order a hunter uses them across a week:
 *
 *   FIELD  the dark screen, in the blind, gloves on, one hand, no signal.
 *          ANOTHER AGENT IS BUILDING THE FIELD CARDS. This file must not grow
 *          them. Everything below the tab bar here is an honest stub.
 *   PREP   the night before, on the couch, with bars. This is where the spot is
 *          saved and every identifier gets frozen.
 *   PLAN   the season view. Not started.
 *
 * PHONE-FIRST, AND LITERALLY SO. Designed at 375px, one column, permanently
 * dark — not "dark mode", just dark, because the room is dark. Every tap target
 * is at least 44px tall and the tab bar is 56px, because the later bag counter
 * needs 64px and the two have to feel like the same hand. Nothing here depends
 * on hover: a hover state on a phone in a marsh is a state that never happens.
 *
 * IMPORT DISCIPLINE. This page imports `@/lib/supabase` (the PREP tab is an
 * online surface, and knowing whether the backend is even configured is the
 * first honest thing to tell someone). It imports NOTHING from the board stack
 * — no frameStore, no boardPlayer, no useYourGround, no RarityMap. That
 * boundary is the reason this route exists as its own tree instead of another
 * wing of TodayPage.
 */

type Tab = "field" | "prep" | "plan";

const TABS: readonly { id: Tab; label: string; sub: string }[] = [
  { id: "field", label: "FIELD", sub: "in the blind" },
  { id: "prep", label: "PREP", sub: "night before" },
  { id: "plan", label: "PLAN", sub: "the season" },
];

/** 44px minimum, everywhere. Gloves. */
const TAP = "min-h-[44px]";

function NotBuilt({ what, why }: { what: string; why: string }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-700 bg-gray-900/60 p-4">
      <p className="text-sm font-semibold uppercase tracking-wide text-gray-400">Not built yet</p>
      <p className="mt-2 text-base leading-relaxed text-gray-200">{what}</p>
      <p className="mt-2 text-sm leading-relaxed text-gray-500">{why}</p>
    </div>
  );
}

function FieldTab() {
  return (
    <div className="space-y-4">
      <NotBuilt
        what="The field cards are not here yet."
        why="Another agent is building them. This tab is the shell that will hold them: legal light, tide, wind, and the bag counter — all of it readable with no signal, because there is none where this screen gets used."
      />
    </div>
  );
}

function PrepTab() {
  const { spot, loading } = useSpot();

  // The one honest thing this shell can say about the backend: whether it is
  // configured at all. `supabase` is null when the env vars are missing.
  const backendConfigured = supabase !== null;

  // Shooting hours are a legal surface. The lookup refuses for any state we
  // have not transcribed, and a refusal renders as the refusal sentence — never
  // as a clock. See src/data/regs/shootingHours.ts.
  const hours = lookupShootingHours(spot?.state);

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-gray-800 bg-gray-900/60 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Your spot</h2>
        {loading ? (
          <p className="mt-2 text-base text-gray-500">Reading saved spot…</p>
        ) : spot ? (
          <div className="mt-2 space-y-1 text-base text-gray-200">
            <p className="font-semibold">{spot.name}</p>
            <p className="text-sm text-gray-400">
              {spot.lat.toFixed(4)}, {spot.lng.toFixed(4)}
              {spot.county_name ? ` · ${spot.county_name}` : ""}
              {spot.state ? ` · ${spot.state}` : ""}
            </p>
            <p className="text-sm text-gray-400">
              {spot.coops_station_id
                ? `Tide station ${spot.coops_station_id}${
                    spot.station_miles !== null ? ` · ${spot.station_miles.toFixed(1)} mi` : ""
                  }`
                : "No tide station bound — tides unavailable for this spot."}
            </p>
            <p className="text-xs text-gray-600">Frozen {spot.saved_at}</p>
          </div>
        ) : (
          <p className="mt-2 text-base text-gray-400">
            No spot saved. The save form is not built yet — it belongs on this tab, and it runs
            here on purpose: everything gets resolved once, with signal, and frozen.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-gray-800 bg-gray-900/60 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
          Legal shooting light
        </h2>
        {hours.status === "transcribed" ? (
          <div className="mt-2 space-y-1 text-base text-gray-200">
            <p className="font-semibold">
              {hours.rule.start} → {hours.rule.end}
            </p>
            <p className="text-sm text-gray-400">{hours.rule.note}</p>
            <p className="text-xs text-gray-600">
              {hours.state} · verified {hours.rule.verified} · human check against the printed
              booklet still pending
            </p>
          </div>
        ) : (
          <p className="mt-2 text-base text-gray-400">{hours.message}</p>
        )}
      </section>

      <NotBuilt
        what="The rest of PREP is not built yet."
        why="Save-the-spot, station override, and the pre-dawn checklist land here."
      />

      <p className="text-xs text-gray-600">
        Backend: {backendConfigured ? "configured" : "not configured (env vars missing)"}
      </p>
    </div>
  );
}

function PlanTab() {
  return (
    <div className="space-y-4">
      <NotBuilt
        what="PLAN is not built yet."
        why="Season dates, the long view, and what the archive says about this stretch of the calendar."
      />
    </div>
  );
}

export default function HuntPage() {
  const [tab, setTab] = useState<Tab>("field");

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="mx-auto w-full max-w-md px-4 pb-16 pt-5">
        <header className="mb-4">
          <h1 className="text-2xl font-bold tracking-tight">THE HUNT</h1>
          <p className="mt-1 text-sm text-gray-500">
            Built for a dark screen, one hand, and no signal.
          </p>
        </header>

        {/* Tab bar: 56px tall, full-width thirds, no hover dependency —
            the selected state is carried by background and border alone. */}
        <nav
          role="tablist"
          aria-label="Hunt sections"
          className="mb-5 grid grid-cols-3 gap-2"
        >
          {TABS.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={[
                  "min-h-[56px] rounded-lg border px-2 py-2 text-center transition-colors",
                  active
                    ? "border-amber-500 bg-amber-500/15 text-amber-200"
                    : "border-gray-800 bg-gray-900 text-gray-400",
                ].join(" ")}
              >
                <span className="block text-sm font-bold tracking-wide">{t.label}</span>
                <span className="block text-[11px] text-gray-500">{t.sub}</span>
              </button>
            );
          })}
        </nav>

        <main role="tabpanel">
          {tab === "field" && <FieldTab />}
          {tab === "prep" && <PrepTab />}
          {tab === "plan" && <PlanTab />}
        </main>

        <footer className="mt-8">
          <a
            href="/"
            className={`${TAP} inline-flex items-center text-sm text-gray-500 underline underline-offset-4`}
          >
            Back to Duck Countdown
          </a>
        </footer>
      </div>
    </div>
  );
}
