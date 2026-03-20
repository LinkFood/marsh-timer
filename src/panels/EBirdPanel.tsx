import { useMemo } from 'react';
import { useDeck } from '@/contexts/DeckContext';
import { useEBirdMapSightings } from '@/hooks/useEBirdMapSightings';
import { Bird, MapPin } from 'lucide-react';
import type { PanelComponentProps } from './PanelTypes';

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const hrs = Math.floor(ms / 3600000);
  if (hrs < 1) return 'now';
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export default function EBirdPanel({}: PanelComponentProps) {
  const { species } = useDeck();
  const geojson = useEBirdMapSightings(species, null, 3.5);

  const count = geojson?.features?.length ?? 0;

  // Group by species name and count
  const speciesBreakdown = useMemo(() => {
    if (!geojson?.features) return [];
    const counts = new Map<string, { total: number; latest: string }>();
    for (const f of geojson.features) {
      const name = f.properties?.name as string;
      const date = f.properties?.date as string;
      const howMany = (f.properties?.count as number) || 1;
      if (!name) continue;
      const existing = counts.get(name);
      if (existing) {
        existing.total += howMany;
        if (date > existing.latest) existing.latest = date;
      } else {
        counts.set(name, { total: howMany, latest: date });
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 15);
  }, [geojson]);

  if (count === 0) {
    return (
      <div className="flex flex-col h-full p-3 gap-3">
        <div className="flex items-center gap-2">
          <Bird size={14} className="text-cyan-400" />
          <span className="text-xs text-white/90 font-mono">eBird Activity</span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <MapPin size={20} className="text-white/20" />
          <span className="text-xs text-white/50">Zoom into the map to load sightings</span>
          <span className="text-[10px] text-white/30">Requires zoom level 6+</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header with count */}
      <div className="shrink-0 flex items-center justify-between px-2.5 py-1.5 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <Bird size={14} className="text-cyan-400" />
          <span className="text-xs font-mono text-white/70">eBird</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-lg font-mono font-bold text-cyan-400">{count}</span>
          <span className="text-[9px] font-mono text-white/30">sightings</span>
        </div>
      </div>

      {/* Species breakdown */}
      <div className="flex-1 overflow-y-auto">
        {speciesBreakdown.map(([name, data]) => (
          <div
            key={name}
            className="flex items-center gap-2 px-2.5 py-1 hover:bg-white/[0.03] transition-colors"
          >
            <span className="flex-1 text-[10px] text-white/70 truncate">{name}</span>
            <span className="text-[10px] font-mono text-cyan-400/80 tabular-nums w-8 text-right">{data.total}</span>
            <span className="text-[9px] font-mono text-white/20 w-6 text-right">{timeAgo(data.latest)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
