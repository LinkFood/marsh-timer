import { ArrowRight } from 'lucide-react';

interface Connection {
  source: string;
  sourceType: string;
  matched: string;
  matchedType: string;
  similarity: number;
}

interface CrossDomainPatternCardProps {
  data: { connections: Connection[] };
}

const TYPE_COLORS: Record<string, string> = {
  'weather-event': 'bg-blue-400/20 text-blue-300 border-blue-400/30',
  'storm-event': 'bg-blue-400/20 text-blue-300 border-blue-400/30',
  'migration-spike-extreme': 'bg-emerald-400/20 text-emerald-300 border-emerald-400/30',
  'migration-spike-significant': 'bg-emerald-400/20 text-emerald-300 border-emerald-400/30',
  'birdcast-daily': 'bg-emerald-400/20 text-emerald-300 border-emerald-400/30',
  'usgs-water': 'bg-cyan-400/20 text-cyan-300 border-cyan-400/30',
  'earthquake-event': 'bg-amber-400/20 text-amber-300 border-amber-400/30',
  'anomaly-alert': 'bg-amber-400/20 text-amber-300 border-amber-400/30',
  'convergence-score': 'bg-cyan-400/20 text-cyan-300 border-cyan-400/30',
  'disaster-watch': 'bg-orange-400/20 text-orange-300 border-orange-400/30',
  'drought-weekly': 'bg-red-400/20 text-red-300 border-red-400/30',
};

function getTypeColor(type: string): string {
  return TYPE_COLORS[type] || 'bg-white/10 text-white/60 border-white/20';
}

function shortType(type: string): string {
  return type.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).slice(0, 20);
}

export default function CrossDomainPatternCard({ data }: CrossDomainPatternCardProps) {
  if (!data?.connections?.length) return null;

  return (
    <div className="space-y-1.5">
      <div className="text-[10px] text-purple-300/70 font-semibold uppercase tracking-wider">
        Cross-Domain Patterns
      </div>
      {data.connections.map((conn, i) => (
        <div key={i} className="flex items-center gap-2 text-[10px] py-1">
          <span className={`px-1.5 py-0.5 rounded border text-[9px] ${getTypeColor(conn.sourceType)}`}>
            {shortType(conn.sourceType)}
          </span>
          <span className="text-white/40 truncate max-w-[100px]" title={conn.source}>
            {conn.source?.slice(0, 30)}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <ArrowRight className="w-3 h-3 text-purple-400/60" />
            <span className="text-purple-300/80 font-mono text-[9px]">
              {Math.round(conn.similarity * 100)}%
            </span>
          </div>
          <span className={`px-1.5 py-0.5 rounded border text-[9px] ${getTypeColor(conn.matchedType)}`}>
            {shortType(conn.matchedType)}
          </span>
          <span className="text-white/40 truncate max-w-[100px]" title={conn.matched}>
            {conn.matched?.slice(0, 30)}
          </span>
        </div>
      ))}
    </div>
  );
}
