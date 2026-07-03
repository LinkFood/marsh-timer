import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import Denominator from '@/components/Denominator';

/**
 * PrecedentCard — the shape every precedent takes.
 *
 * Today it renders this-day-in-the-archive entries. When the similarity
 * engine clears verification, the nearest-day matcher will supply N/K/B
 * denominators through the same props — the receipts row stays hidden
 * until real numbers exist. Never fabricate a denominator to fill it.
 */

interface PrecedentCardProps {
  dateHeadline: string;          // "July 2, 1985"
  whatHappened: string;          // one-line what-happened
  stateTag?: string | null;
  to: string;                    // tap target, e.g. /date/1985-07-02?state=MD
  n?: number | null;             // times these conditions appeared
  k?: number | null;             // times the outcome followed
  base?: number | null;          // base rate
}

export default function PrecedentCard({
  dateHeadline, whatHappened, stateTag, to, n = null, k = null, base = null,
}: PrecedentCardProps) {
  return (
    <Link
      to={to}
      className="block bg-gray-900 rounded-lg border border-gray-800 hover:border-cyan-400/30 transition-colors px-4 py-3 group"
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="font-display text-sm text-white/90">{dateHeadline}</span>
        <span className="flex items-center gap-1.5 shrink-0">
          {stateTag && (
            <span className="text-[9px] font-mono text-white/30 px-1.5 py-0.5 rounded border border-white/10">
              {stateTag}
            </span>
          )}
          <ChevronRight size={12} className="text-white/20 group-hover:text-cyan-400/60 transition-colors" />
        </span>
      </div>
      <p className="text-xs font-body text-white/55 leading-snug line-clamp-2">{whatHappened}</p>
      {n != null && k != null && (
        <div className="mt-1.5 text-[10px]">
          <Denominator n={n} k={k} base={base} />
        </div>
      )}
    </Link>
  );
}
