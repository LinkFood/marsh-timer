import { useState, useRef, useEffect } from 'react';
import { LayoutGrid, Map, Columns2, Columns3, Columns4, Grid2x2 } from 'lucide-react';
import { useDeck } from '@/contexts/DeckContext';
import type { GridPreset } from '@/panels/PanelTypes';

const PRESETS: { id: GridPreset; label: string; icon: typeof LayoutGrid; description: string }[] = [
  { id: 'default', label: 'Default', icon: LayoutGrid, description: '12-column grid' },
  { id: 'equal-grid', label: 'Full Panels', icon: Grid2x2, description: 'Hide map, panels fill screen' },
  { id: 'map-focus', label: 'Map Focus', icon: Map, description: 'Large map, sidebar panels' },
  { id: '2-col', label: '2 Columns', icon: Columns2, description: 'Wide panels' },
  { id: '3-col', label: '3 Columns', icon: Columns3, description: 'Balanced layout' },
  { id: '4-col', label: '4 Columns', icon: Columns4, description: 'Dense view' },
];

export default function GridPresetSelector() {
  const { gridPreset, setGridPreset } = useDeck();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="p-2 rounded-full text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Grid layout"
      >
        <LayoutGrid className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-2 w-48 glass-panel rounded-lg shadow-xl z-50 py-1">
          {PRESETS.map(p => {
            const Icon = p.icon;
            const active = gridPreset === p.id;
            return (
              <button
                key={p.id}
                onClick={() => { setGridPreset(p.id); setOpen(false); }}
                className="w-full text-left px-3 py-2 hover:bg-white/[0.04] transition-colors flex items-center gap-2.5"
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${active ? 'bg-cyan-400' : 'bg-white/10'}`} />
                <Icon className="w-3.5 h-3.5 text-white/40 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-[11px] font-body text-white/80">{p.label}</div>
                  <div className="text-[9px] font-body text-white/30">{p.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
