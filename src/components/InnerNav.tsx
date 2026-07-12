import { ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * InnerNav — the one quiet nav idiom shared by the inner product surfaces
 * (/atlas, /morning, /born, /board/uri, /court).
 *
 * The whole point is coherence: a stranger who lands cold on any one of these
 * pages sees the same small-caps page name on the left, the same DUCK COUNTDOWN
 * home link on the right, and the same quiet footer offering every OTHER door.
 * No page is a dead end; the product reads as one thing.
 *
 * This is coherence, not homogenization — each page keeps its own body and
 * character. Only the header ribbon and the doors footer are shared.
 */

export type DoorKey = "atlas" | "morning" | "born" | "board" | "court";

interface Door {
  key: DoorKey;
  to: string;
  /** Footer label. The Board carries its invitation so it reads as a thing to watch, not a tab. */
  label: string;
}

const DOORS: Door[] = [
  { key: "atlas", to: "/atlas", label: "The Atlas" },
  { key: "morning", to: "/morning", label: "The Morning Line" },
  { key: "born", to: "/born", label: "The night you were born" },
  { key: "board", to: "/board/uri", label: "The Board — watch a storm form" },
  { key: "court", to: "/court", label: "The Court" },
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
 * The doors footer: every OTHER surface, offered as a quiet row of links (the
 * current page omitted; the front door passes no `current` and offers all
 * five). Centered flex-wrap so at 375px it degrades to two rows instead of
 * overflowing — never an ugly wrap.
 */
export function InnerFooter({ current }: { current?: DoorKey }) {
  const doors = current ? DOORS.filter((d) => d.key !== current) : DOORS;
  return (
    <footer className="mt-10 border-t border-white/10 pt-5">
      <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-center font-mono text-[11px]">
        {doors.map((d) => (
          <Link key={d.key} to={d.to} className="text-gray-500 transition-colors hover:text-cyan-300">
            {d.label} &rarr;
          </Link>
        ))}
      </nav>
    </footer>
  );
}
