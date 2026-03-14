interface PatternLink {
  source: string;
  sourceType: string;
  matched: string;
  matchedType: string;
  similarity: number;
  when: string;
}

interface PatternLinksData {
  links: PatternLink[];
}

export default function PatternLinksCard({ data }: { data: PatternLinksData }) {
  const links = data.links || [];
  if (links.length === 0) return null;

  return (
    <div className="rounded-lg border border-purple-400/20 bg-purple-400/5 p-2.5 mt-1">
      <div className="flex items-center gap-1.5 mb-1.5">
        <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
        <span className="text-[10px] font-semibold text-purple-300/80 uppercase tracking-wider">
          Live Pattern Connections
        </span>
      </div>
      <div className="space-y-1.5">
        {links.map((link, i) => (
          <div key={i} className="flex items-start gap-2 text-[11px]">
            <span className="text-purple-300/60 mt-0.5">→</span>
            <div className="flex-1 min-w-0">
              <span className="text-white/70">{link.source}</span>
              <span className="text-purple-300/40 mx-1">matched</span>
              <span className="text-white/70">{link.matched}</span>
              <span className="text-purple-300/50 ml-1">
                ({Math.round(link.similarity * 100)}%)
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
