import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, RotateCcw, Search, ChevronDown, ChevronRight } from 'lucide-react';
import { useLayerContext } from '@/contexts/LayerContext';
import { useDeck } from '@/contexts/DeckContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { LAYER_REGISTRY, LAYER_PRESETS } from '@/layers/LayerRegistry';
import type { LayerCategory } from '@/layers/LayerTypes';

const CATEGORY_ORDER: LayerCategory[] = ['environment', 'migration', 'weather', 'intelligence', 'terrain'];

const CATEGORY_LABELS: Record<LayerCategory, string> = {
  environment: 'Environment',
  migration: 'Migration',
  weather: 'Weather',
  intelligence: 'Intelligence',
  terrain: 'Terrain',
};

export default function LayerPicker() {
  const { layerPickerOpen, setLayerPickerOpen } = useDeck();
  const { activeLayers, isLayerOn, toggleLayer, applyPreset, resetLayers } = useLayerContext();
  const isMobile = useIsMobile();

  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<LayerCategory>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!layerPickerOpen) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setLayerPickerOpen(false);
      }
    }
    // Delay to avoid closing on the same click that opened
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClick), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [layerPickerOpen, setLayerPickerOpen]);

  // Reset search when closed
  useEffect(() => {
    if (!layerPickerOpen) setSearch('');
  }, [layerPickerOpen]);

  const toggleCollapse = useCallback((cat: LayerCategory) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  // Group layers by category, filtered by search
  const grouped = useMemo(() => {
    const q = search.toLowerCase().trim();
    const map = new Map<LayerCategory, typeof LAYER_REGISTRY>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const layer of LAYER_REGISTRY) {
      if (q && !layer.label.toLowerCase().includes(q)) continue;
      map.get(layer.category)!.push(layer);
    }
    return map;
  }, [search]);

  // Count active per category
  const activeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const cat of CATEGORY_ORDER) {
      counts[cat] = LAYER_REGISTRY.filter(l => l.category === cat && activeLayers.has(l.id)).length;
    }
    return counts;
  }, [activeLayers]);

  const noResults = useMemo(() => {
    for (const layers of grouped.values()) {
      if (layers.length > 0) return false;
    }
    return true;
  }, [grouped]);

  return (
    <AnimatePresence>
      {layerPickerOpen && (
        <motion.div
          ref={panelRef}
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className={`fixed top-12 bottom-11 right-0 z-40 ${isMobile ? 'left-0' : 'w-[280px]'} glass-panel border-l border-white/[0.06] flex flex-col overflow-hidden`}
        >
          {/* Header */}
          <div className="shrink-0 h-10 px-3 flex items-center justify-between border-b border-white/[0.06]">
            <span className="text-[10px] font-display uppercase tracking-widest text-white/50">Layers</span>
            <div className="flex items-center gap-2">
              <button
                onClick={resetLayers}
                className="text-white/40 hover:text-white/80 transition-colors"
                title="Reset to defaults"
              >
                <RotateCcw size={12} />
              </button>
              <button
                onClick={() => setLayerPickerOpen(false)}
                className="text-white/40 hover:text-white/80 transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="shrink-0 px-3 py-2 border-b border-white/[0.06]">
            <div className="flex items-center gap-2 bg-white/[0.04] rounded px-2 py-1.5">
              <Search size={12} className="text-white/30 shrink-0" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search layers..."
                className="bg-transparent text-[11px] text-white/90 placeholder:text-white/30 outline-none w-full"
              />
            </div>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {/* Presets */}
            {!search && (
              <div className="px-3 py-2 border-b border-white/[0.06]">
                <span className="text-[9px] uppercase tracking-widest text-white/30 font-medium">Presets</span>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {LAYER_PRESETS.map(preset => (
                    <button
                      key={preset.id}
                      onClick={() => applyPreset(preset)}
                      className="px-2 py-1 text-[10px] font-medium rounded bg-white/[0.06] text-white/60 hover:bg-cyan-400/20 hover:text-cyan-400 transition-colors"
                      title={preset.description}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Categories */}
            {CATEGORY_ORDER.map(cat => {
              const layers = grouped.get(cat)!;
              if (layers.length === 0) return null;
              const isCollapsed = collapsed.has(cat);
              const count = activeCounts[cat];

              return (
                <div key={cat} className="border-b border-white/[0.04]">
                  <button
                    onClick={() => toggleCollapse(cat)}
                    className="w-full px-3 py-2 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      {isCollapsed ? (
                        <ChevronRight size={10} className="text-white/30" />
                      ) : (
                        <ChevronDown size={10} className="text-white/30" />
                      )}
                      <span className="text-[9px] uppercase tracking-widest text-white/40 font-medium">
                        {CATEGORY_LABELS[cat]}
                      </span>
                    </div>
                    {count > 0 && (
                      <span className="text-[9px] text-cyan-400/70 tabular-nums">{count}</span>
                    )}
                  </button>

                  {!isCollapsed && (
                    <div className="pb-1">
                      {layers.map(layer => {
                        const on = isLayerOn(layer.id);
                        return (
                          <button
                            key={layer.id}
                            onClick={() => toggleLayer(layer.id)}
                            className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-white/[0.03] transition-colors group"
                          >
                            <span className={`text-[11px] ${on ? 'text-white/90' : 'text-white/40'} transition-colors`}>
                              {layer.label}
                            </span>
                            {/* Toggle switch */}
                            <div
                              className={`w-7 h-4 rounded-full relative transition-colors ${on ? 'bg-cyan-400/60' : 'bg-white/[0.08]'}`}
                            >
                              <div
                                className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${on ? 'left-3.5 bg-cyan-400' : 'left-0.5 bg-white/30'}`}
                              />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* No results */}
            {noResults && search && (
              <div className="px-3 py-6 text-center">
                <span className="text-[11px] text-white/30">No layers match "{search}"</span>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
