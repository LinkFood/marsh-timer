import { Database } from 'lucide-react';

interface SourceCardProps {
  data: Record<string, unknown>;
}

export default function SourceCard({ data }: SourceCardProps) {
  const vectorCount = (data.vectorCount as number) || 0;
  const keywordCount = (data.keywordCount as number) || 0;
  const contentTypes = (data.contentTypes as string[]) || [];
  const similarityRange = (data.similarityRange as [number, number]) || [0, 0];

  return (
    <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] p-2.5">
      <div className="flex items-center gap-1.5 mb-1">
        <Database size={10} className="text-white/30" />
        <span className="text-[10px] font-semibold text-white/40 uppercase tracking-wider">Sources</span>
      </div>
      <p className="text-[10px] text-white/40">
        {vectorCount === 0 && keywordCount === 0
          ? 'Brain searched — 0 matching entries'
          : `Searched ${vectorCount} entries${keywordCount > 0 ? `, ${keywordCount} keyword matches` : ''}`}
      </p>
      {contentTypes.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {contentTypes.map((ct, i) => (
            <span key={i} className="text-[8px] px-1.5 py-0.5 rounded-full bg-white/5 text-white/30">
              {ct}
            </span>
          ))}
        </div>
      )}
      {similarityRange[1] > 0 && (
        <p className="text-[9px] text-white/30 mt-1">
          Confidence: {Math.round(similarityRange[0] * 100)}% – {Math.round(similarityRange[1] * 100)}%
        </p>
      )}
    </div>
  );
}
