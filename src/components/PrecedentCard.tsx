import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import Denominator from '@/components/Denominator';

/**
 * PrecedentCard — the shape every precedent takes.
 *
 * Renders this-day-in-the-archive entries: a Playfair date headline plus 1-2
 * humanized entry lines with per-line state tags (`lines`), or a single
 * `whatHappened` one-liner. When the similarity engine clears verification,
 * the nearest-day matcher will supply N/K/B denominators through the same
 * props — the receipts row stays hidden until real numbers exist. Never
 * fabricate a denominator to fill it.
 */

export interface PrecedentLine {
  text: string;
  stateTag?: string | null;
}

interface PrecedentCardProps {
  dateHeadline: string;          // "July 2, 1985"
  whatHappened?: string;         // one-line what-happened (legacy single-line mode)
  lines?: PrecedentLine[];       // 1-2 humanized lines with per-line state tags
  stateTag?: string | null;
  to: string;                    // tap target, e.g. /date/1985-07-02?state=MD
  n?: number | null;             // times these conditions appeared
  k?: number | null;             // times the outcome followed
  base?: number | null;          // base rate
}

function StateTag({ abbr }: { abbr: string }) {
  return (
    <span className="text-[9px] font-mono text-white/30 px-1.5 py-0.5 rounded border border-white/10 shrink-0">
      {abbr}
    </span>
  );
}

export default function PrecedentCard({
  dateHeadline, whatHappened, lines, stateTag, to, n = null, k = null, base = null,
}: PrecedentCardProps) {
  return (
    <Link
      to={to}
      className="block bg-gray-900 rounded-lg border border-gray-800 hover:border-cyan-400/30 transition-colors px-4 py-3 group"
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="font-display text-sm text-white/90">{dateHeadline}</span>
        <span className="flex items-center gap-1.5 shrink-0">
          {stateTag && <StateTag abbr={stateTag} />}
          <ChevronRight size={12} className="text-white/20 group-hover:text-cyan-400/60 transition-colors" />
        </span>
      </div>
      {lines && lines.length > 0 ? (
        <div className="space-y-1">
          {lines.map(line => (
            <div key={line.text} className="flex items-start justify-between gap-2">
              <p className="text-xs font-body text-white/55 leading-snug line-clamp-2">{line.text}</p>
              {line.stateTag && <StateTag abbr={line.stateTag} />}
            </div>
          ))}
        </div>
      ) : whatHappened ? (
        <p className="text-xs font-body text-white/55 leading-snug line-clamp-2">{whatHappened}</p>
      ) : null}
      {n != null && k != null && (
        <div className="mt-1.5 text-[10px]">
          <Denominator n={n} k={k} base={base} />
        </div>
      )}
    </Link>
  );
}
