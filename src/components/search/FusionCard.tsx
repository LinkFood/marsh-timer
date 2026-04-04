import { typeColor } from '@/data/contentTypeGroups';
import type { BrainResult } from './ResultCard';

interface FusionCardProps {
  results: BrainResult[];
  sourceDate: string;
  sourceState: string;
}

export default function FusionCard({ results, sourceDate, sourceState }: FusionCardProps) {
  if (results.length === 0) return null;

  // Group by content_type
  const grouped = results.reduce<Record<string, BrainResult[]>>((acc, r) => {
    const key = r.content_type;
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {});

  return (
    <div className="border border-purple-400/20 bg-purple-400/[0.03] rounded-lg p-3">
      {/* Header */}
      <div className="mb-2">
        <span className="text-[11px] font-body font-semibold text-purple-300">
          Meanwhile...
        </span>
        <span className="text-[9px] font-mono text-purple-400/50 ml-2">
          in {sourceState} around {sourceDate}
        </span>
      </div>

      {/* Grouped entries */}
      <div className="flex flex-col gap-1.5">
        {Object.entries(grouped).map(([type, entries]) => (
          <div key={type} className="flex flex-col gap-0.5">
            {entries.map((entry, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0 ${typeColor(type)}`}>
                  {type}
                </span>
                <span className="text-[11px] font-body text-white/50 leading-snug line-clamp-1">
                  {entry.content.slice(0, 120)}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
