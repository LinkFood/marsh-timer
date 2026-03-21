import { Map, Layout } from 'lucide-react';
import { useDeck } from '@/contexts/DeckContext';
import type { PanelComponentProps } from './PanelTypes';

export default function MapPanel({ isFullscreen }: PanelComponentProps) {
  const { gridPreset, setGridPreset } = useDeck();
  const mapHidden = gridPreset === 'equal-grid';

  if (mapHidden) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-4">
        <Map size={32} className="text-cyan-400/40" />
        <p className="text-[11px] text-white/50 text-center">
          Map is hidden in Full Panels mode
        </p>
        <div className="flex flex-col gap-1.5 w-full max-w-[200px]">
          <button
            onClick={() => setGridPreset('default')}
            className="text-[10px] font-mono text-cyan-400 hover:text-cyan-300 bg-cyan-400/10 hover:bg-cyan-400/20 rounded px-3 py-1.5 transition-colors"
          >
            Default Layout
          </button>
          <button
            onClick={() => setGridPreset('side-by-side')}
            className="text-[10px] font-mono text-cyan-400 hover:text-cyan-300 bg-cyan-400/10 hover:bg-cyan-400/20 rounded px-3 py-1.5 transition-colors"
          >
            Command Center
          </button>
          <button
            onClick={() => setGridPreset('map-focus')}
            className="text-[10px] font-mono text-cyan-400 hover:text-cyan-300 bg-cyan-400/10 hover:bg-cyan-400/20 rounded px-3 py-1.5 transition-colors"
          >
            Map Focus
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 p-4">
      <Map size={24} className="text-white/20" />
      <p className="text-[10px] text-white/30 text-center">
        Map is visible in the current layout
      </p>
      <p className="text-[9px] text-white/20 text-center">
        Use grid presets to change layout
      </p>
    </div>
  );
}
