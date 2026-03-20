import { useDeck } from '@/contexts/DeckContext';
import { useEBirdMapSightings } from '@/hooks/useEBirdMapSightings';
import { Bird } from 'lucide-react';
import type { PanelComponentProps } from './PanelTypes';

export default function EBirdPanel({}: PanelComponentProps) {
  const { species } = useDeck();
  const geojson = useEBirdMapSightings(species, null, 3.5);

  const count = geojson?.features?.length ?? 0;

  return (
    <div className="flex flex-col h-full p-3 gap-3">
      <div className="flex items-center gap-2">
        <Bird size={14} className="text-cyan-400" />
        <span className="text-xs text-white/90 font-mono">eBird Activity</span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-2">
        {count > 0 ? (
          <>
            <span className="text-2xl font-mono text-cyan-400 font-bold">{count}</span>
            <span className="text-[10px] text-white/40">recent sightings in view</span>
          </>
        ) : (
          <>
            <span className="text-xs text-white/50">Zoom into the map to load sightings</span>
            <span className="text-[10px] text-white/30">Requires zoom level 6+</span>
          </>
        )}
      </div>

      <div className="text-[10px] text-white/30 border-t border-white/[0.06] pt-2">
        eBird is a live data source from Cornell Lab of Ornithology.
        Sightings update as you pan and zoom the map.
      </div>
    </div>
  );
}
