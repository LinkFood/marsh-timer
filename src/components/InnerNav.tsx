import { ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * InnerNav — the one quiet nav idiom shared by every product surface.
 *
 * The whole point is coherence: a stranger who lands cold on any page sees the
 * same small-caps page name on the left, the same DUCK COUNTDOWN home link on
 * the right, and the same quiet footer offering every OTHER door. No page is a
 * dead end; the product reads as one thing.
 *
 * The doors footer speaks the five-door almanac grammar (the site blueprint,
 * docs/SITE-BLUEPRINT-2026-07-17.md §2e): Today · The Almanac · The Museum ·
 * The Court · Ask. Multi-room doors carry their rooms as sub-doors; the
 * chapters shelf grows under The Almanac as chapters ship.
 *
 * This is coherence, not homogenization — each page keeps its own body and
 * character. Only the header ribbon and the doors footer are shared.
 */

export type DoorKey =
  | "today"
  | "atlas"
  | "morning"
  | "plant"
  | "date"
  | "born"
  | "board"
  | "cascade"
  | "court"
  | "ask";

interface Door {
  key: DoorKey;
  to: string;
  label: string;
}

interface DoorGroup {
  /** Group label rendered before multi-door groups; single-door groups render the door alone. */
  name: string;
  doors: Door[];
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const GROUPS: DoorGroup[] = [
  {
    name: "Today",
    doors: [
      { key: "today", to: "/", label: "Today" },
      { key: "atlas", to: "/atlas", label: "The Atlas" },
      { key: "morning", to: "/morning", label: "The Morning Line" },
    ],
  },
  {
    name: "The Almanac",
    doors: [{ key: "plant", to: "/plant", label: "When to plant" }],
  },
  {
    name: "The Museum",
    doors: [
      { key: "date", to: `/date/${todayIso()}`, label: "Any date" },
      { key: "born", to: "/born", label: "The night you were born" },
      { key: "board", to: "/board/uri", label: "The films" },
      { key: "cascade", to: "/cascade", label: "Strangest days" },
    ],
  },
  {
    name: "The Court",
    doors: [{ key: "court", to: "/court", label: "The Court" }],
  },
  {
    name: "Ask",
    doors: [{ key: "ask", to: "/ask", label: "Ask the archive" }],
  },
];

/**
 * The header ribbon: small-caps cyan page name (with an orienting subtitle for
 * cold visitors) on the left, DUCK COUNTDOWN home link on the right. `right`
 * slots any page-specific control (e.g. the court's UserMenu) beside the home
 * link without breaking the idiom.
 */
export function InnerHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="font-mono text-[11px] tracking-[0.28em] text-cyan-300/90">{title}</div>
        {subtitle && <div className="mt-1.5 font-mono text-[11px] leading-relaxed text-gray-500">{subtitle}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Link
          to="/"
          className="whitespace-nowrap font-mono text-[11px] tracking-[0.24em] text-gray-500 transition-colors hover:text-cyan-300"
        >
          DUCK COUNTDOWN
        </Link>
        {right}
      </div>
    </header>
  );
}

/**
 * The doors footer: the five doors as quiet grouped rows, the current page
 * omitted (the front door passes `current="today"`; a page outside the grammar
 * passes nothing and offers every door). Single-door groups render as a bare
 * link; multi-door groups render a dim group label followed by their rooms.
 * Flex-wrap keeps it to a few quiet rows at 375px — never an ugly wrap.
 */
export function InnerFooter({ current }: { current?: DoorKey }) {
  const groups = GROUPS.map((g) => ({
    ...g,
    doors: current ? g.doors.filter((d) => d.key !== current) : g.doors,
  })).filter((g) => g.doors.length > 0);

  return (
    <footer className="mt-10 border-t border-white/10 pt-5">
      <nav className="flex flex-col items-center gap-y-2.5 text-center font-mono text-[11px]">
        {groups.map((g) => (
          <div key={g.name} className="flex flex-wrap items-baseline justify-center gap-x-4 gap-y-1.5">
            {g.doors.length > 1 && (
              <span className="text-[10px] tracking-[0.2em] text-gray-600">{g.name.toUpperCase()}</span>
            )}
            {g.doors.map((d) => (
              <Link key={d.key} to={d.to} className="text-gray-500 transition-colors hover:text-cyan-300">
                {d.label} &rarr;
              </Link>
            ))}
          </div>
        ))}
      </nav>
    </footer>
  );
}
