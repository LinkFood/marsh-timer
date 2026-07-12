import { useEffect } from "react";
import { Link } from "react-router-dom";

/**
 * A bare index over the three site-concept pages. Not a product surface — a
 * fork in the road for James's eye. Concept A is the facelift candidate (ship
 * quality); B and C are reference points for contrast.
 */

const CONCEPTS = [
  {
    to: "/concepts/a",
    name: "A · The One Room",
    line: "Today's live board is the site. One screen of embers, one true sentence, scroll down to fall back through the days. The facelift candidate.",
  },
  {
    to: "/concepts/b",
    name: "B · The Film",
    line: "The Uri film full-bleed, zero chrome. Only the beats, then four words. Radical restraint — the film is the whole explanation.",
  },
  {
    to: "/concepts/c",
    name: "C · The Braid",
    line: "The scroll-of-days, standalone: an honest ledger you fall down through, each day a heat-ribbon and its one line.",
  },
];

export default function ConceptsIndex() {
  useEffect(() => {
    document.title = "Concepts — Duck Countdown";
  }, []);
  return (
    <div className="min-h-screen bg-gray-950 px-6 py-20 text-gray-100">
      <div className="mx-auto max-w-xl">
        <div className="font-mono text-[11px] tracking-[0.28em] text-cyan-300/80">THREE GRAMMARS</div>
        <p className="mt-3 font-body text-sm leading-relaxed text-gray-500">
          Three different ways the site could be. Each is a different grammar, not a skin. Real data,
          phone-first.
        </p>
        <div className="mt-10 flex flex-col gap-6">
          {CONCEPTS.map((c) => (
            <Link
              key={c.to}
              to={c.to}
              className="group block rounded-xl border border-white/8 p-5 transition-colors hover:border-cyan-400/30 hover:bg-white/[0.02]"
            >
              <div className="font-display text-lg text-gray-100 group-hover:text-cyan-200">{c.name}</div>
              <p className="mt-1.5 font-body text-[13px] leading-relaxed text-gray-500">{c.line}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
