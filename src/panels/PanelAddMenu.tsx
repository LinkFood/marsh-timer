import { useState, useMemo } from 'react';
import { Search } from 'lucide-react';
import { PANEL_REGISTRY } from '@/panels/PanelRegistry';
import { useDeckLayout } from '@/hooks/useDeckLayout';
import { useDeck } from '@/contexts/DeckContext';
import type { PanelCategory } from '@/panels/PanelTypes';

const CATEGORY_LABELS: Record<PanelCategory, string> = {
  intelligence: 'Intelligence',
  migration: 'Migration',
  weather: 'Weather',
  analytics: 'Analytics',
};

const CATEGORY_ORDER: PanelCategory[] = ['intelligence', 'migration', 'weather', 'analytics'];

export default function PanelAddMenu() {
  const { addPanel } = useDeckLayout();
  const { setPanelAddOpen } = useDeck();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return PANEL_REGISTRY;
    const q = search.toLowerCase();
    return PANEL_REGISTRY.filter(
      (p) =>
        p.label.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q),
    );
  }, [search]);

  const grouped = useMemo(() => {
    const map = new Map<PanelCategory, typeof filtered>();
    for (const cat of CATEGORY_ORDER) {
      const items = filtered.filter((p) => p.category === cat);
      if (items.length > 0) map.set(cat, items);
    }
    return map;
  }, [filtered]);

  const handleAdd = (panelId: string, defaultW: number, defaultH: number) => {
    addPanel(panelId, defaultW, defaultH);
    setPanelAddOpen(false);
  };

  return (
    <div className="w-64 max-h-80 glass-panel border border-white/[0.06] rounded shadow-2xl flex flex-col overflow-hidden">
      {/* Search */}
      <div className="shrink-0 flex items-center gap-1.5 px-2 py-1.5 border-b border-white/[0.06]">
        <Search className="w-3 h-3 text-white/30" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search panels..."
          className="flex-1 bg-transparent text-[10px] font-body text-white/80 placeholder:text-white/20 outline-none"
          autoFocus
        />
      </div>

      {/* Panel list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 py-1">
        {grouped.size === 0 && (
          <div className="px-3 py-4 text-[10px] text-white/20 font-body text-center">
            No panels found
          </div>
        )}
        {CATEGORY_ORDER.map((cat) => {
          const items = grouped.get(cat);
          if (!items) return null;
          return (
            <div key={cat}>
              <div className="px-2 py-1 text-[9px] font-display text-white/30 uppercase tracking-wider">
                {CATEGORY_LABELS[cat]}
              </div>
              {items.map((panel) => (
                <button
                  key={panel.id}
                  onClick={() => handleAdd(panel.id, panel.defaultW, panel.defaultH)}
                  className="w-full flex flex-col px-2 py-1.5 text-left hover:bg-white/[0.04] transition-colors"
                >
                  <span className="text-xs font-body text-white/80">{panel.label}</span>
                  <span className="text-[10px] font-body text-white/30 leading-tight">{panel.description}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
