import { useMurmurationIndex } from '@/hooks/useMurmurationIndex';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { PanelComponentProps } from './PanelTypes';

export default function MigrationIndexPanel({}: PanelComponentProps) {
  const { data, loading } = useMurmurationIndex();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        Loading migration data...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        No migration data
      </div>
    );
  }

  const DirectionIcon = data.direction === 'up' ? TrendingUp : data.direction === 'down' ? TrendingDown : Minus;
  const dirColor = data.direction === 'up' ? 'text-green-400' : data.direction === 'down' ? 'text-red-400' : 'text-white/50';

  return (
    <div className="flex flex-col h-full p-3 gap-3">
      {/* Big number */}
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-mono text-cyan-400 font-bold">{data.index}</span>
        <div className={`flex items-center gap-1 ${dirColor}`}>
          <DirectionIcon size={14} />
          <span className="text-xs font-mono">
            {data.change_pct > 0 ? '+' : ''}{data.change_pct.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-white/[0.04] rounded px-2 py-1.5">
          <div className="text-[10px] text-white/40">Active States</div>
          <div className="text-sm font-mono text-white/90">{data.active_states}</div>
        </div>
        <div className="bg-white/[0.04] rounded px-2 py-1.5">
          <div className="text-[10px] text-white/40">Spikes</div>
          <div className="text-sm font-mono text-white/90">{data.spike_count}</div>
        </div>
      </div>

      {/* Top states */}
      {data.top_states.length > 0 && (
        <div>
          <div className="text-[10px] text-white/40 mb-1">Top States</div>
          <div className="flex flex-wrap gap-1">
            {data.top_states.map(st => (
              <span key={st} className="text-[10px] font-mono text-cyan-400 bg-cyan-400/10 rounded px-1.5 py-0.5">
                {st}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
