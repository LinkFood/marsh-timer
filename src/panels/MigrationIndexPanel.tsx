import { useMurmurationIndex } from '@/hooks/useMurmurationIndex';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useMapAction } from '@/contexts/MapActionContext';
import { useDeck } from '@/contexts/DeckContext';
import type { PanelComponentProps } from './PanelTypes';

function indexColor(val: number): string {
  if (val >= 80) return 'text-red-400';
  if (val >= 60) return 'text-orange-400';
  if (val >= 40) return 'text-yellow-400';
  if (val >= 20) return 'text-blue-400';
  return 'text-gray-500';
}

export default function MigrationIndexPanel({}: PanelComponentProps) {
  const { data, loading } = useMurmurationIndex();
  const { flyTo } = useMapAction();
  const { setSelectedState } = useDeck();

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
  const dirBg = data.direction === 'up' ? 'bg-green-400/10' : data.direction === 'down' ? 'bg-red-400/10' : 'bg-white/[0.04]';

  return (
    <div className="flex flex-col h-full p-3 gap-3">
      {/* Big number + direction */}
      <div className="flex items-center gap-3">
        <span className={`text-4xl font-mono font-bold tabular-nums tracking-tight ${indexColor(data.index)}`}>
          {data.index}
        </span>
        <div className={`flex items-center gap-1.5 px-2 py-1 rounded ${dirBg} ${dirColor}`}>
          <DirectionIcon size={16} strokeWidth={2.5} />
          <span className="text-xs font-mono font-semibold tabular-nums">
            {data.change_pct > 0 ? '+' : ''}{data.change_pct.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
          <div className="text-[10px] font-mono tracking-wider text-white/30 uppercase">Active States</div>
          <div className="text-lg font-mono font-bold text-white/90 tabular-nums mt-0.5">{data.active_states}</div>
        </div>
        <div className="rounded border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
          <div className="text-[10px] font-mono tracking-wider text-white/30 uppercase">Spikes</div>
          <div className="text-lg font-mono font-bold text-white/90 tabular-nums mt-0.5">{data.spike_count}</div>
        </div>
      </div>

      {/* Top states */}
      {data.top_states.length > 0 && (
        <div>
          <div className="text-[10px] font-mono tracking-wider text-white/30 uppercase mb-1.5">Top States</div>
          <div className="flex flex-wrap gap-1">
            {data.top_states.map(st => (
              <button
                key={st}
                onClick={() => {
                  flyTo(st);
                  setSelectedState(st);
                }}
                className="text-[10px] font-mono text-cyan-400 bg-cyan-400/10 border border-cyan-400/20 rounded px-1.5 py-0.5 hover:bg-cyan-400/20 transition-colors cursor-pointer"
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
