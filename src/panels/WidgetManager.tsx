import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Search, X, ChevronDown, ChevronRight, Plus, Minus } from 'lucide-react';
import { useDeck } from '@/contexts/DeckContext';
import { useDeckLayout } from '@/hooks/useDeckLayout';
import { PANEL_REGISTRY, PANEL_MAP } from './PanelRegistry';
import type { PanelCategory } from './PanelTypes';
import { useIsMobile } from '@/hooks/useIsMobile';

const CATEGORY_ORDER: PanelCategory[] = ['intelligence', 'migration', 'weather', 'analytics'];

const CATEGORY_LABELS: Record<PanelCategory, string> = {
  intelligence: 'Intelligence',
  migration: 'Migration',
  weather: 'Weather',
  analytics: 'Analytics',
};

const REFRESH_COLORS: Record<string, string> = {
  'real-time': 'bg-emerald-500/20 text-emerald-400',
  '15min': 'bg-cyan-500/20 text-cyan-400',
  '3hr': 'bg-blue-500/20 text-blue-400',
  'daily': 'bg-amber-500/20 text-amber-400',
  'weekly': 'bg-purple-500/20 text-purple-400',
  'static': 'bg-white/10 text-white/40',
  'on-demand': 'bg-white/10 text-white/40',
};

export default function WidgetManager() {
  const { panelAddOpen, setPanelAddOpen } = useDeck();
  const { panels, addPanel, removePanel } = useDeckLayout();
  const isMobile = useIsMobile();

  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<PanelCategory>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!panelAddOpen) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setPanelAddOpen(false);
      }
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClick), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [panelAddOpen, setPanelAddOpen]);

  // Reset search when closed
  useEffect(() => {
    if (!panelAddOpen) setSearch('');
  }, [panelAddOpen]);

  const toggleCollapse = useCallback((cat: PanelCategory) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  // Set of active panel IDs
  const activePanelIds = useMemo(() => {
    return new Set(panels.map(p => p.panelId));
  }, [panels]);

  const activeCount = panels.length;

  // Search-filtered and grouped
  const grouped = useMemo(() => {
    const q = search.toLowerCase().trim();
    const map = new Map<PanelCategory, typeof PANEL_REGISTRY>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const def of PANEL_REGISTRY) {
      if (q && !def.label.toLowerCase().includes(q) && !def.description.toLowerCase().includes(q) && !def.category.toLowerCase().includes(q)) continue;
      map.get(def.category)!.push(def);
    }
    return map;
  }, [search]);

  // Active counts per category
  const activeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const cat of CATEGORY_ORDER) {
      counts[cat] = panels.filter(p => {
        const def = PANEL_MAP.get(p.panelId);
        return def && def.category === cat;
      }).length;
    }
    return counts;
  }, [panels]);

  const noResults = useMemo(() => {
    for (const layers of grouped.values()) {
      if (layers.length > 0) return false;
    }
    return true;
  }, [grouped]);

  const handleTogglePanel = useCallback((panelId: string, defaultW: number, defaultH: number) => {
    if (activePanelIds.has(panelId)) {
      const instance = panels.find(p => p.panelId === panelId);
      if (instance) removePanel(instance.instanceId);
    } else {
      addPanel(panelId, defaultW, defaultH);
    }
  }, [activePanelIds, panels, addPanel, removePanel]);

  const handleAddAllInCategory = useCallback((cat: PanelCategory) => {
    const defs = PANEL_REGISTRY.filter(d => d.category === cat);
    for (const def of defs) {
      if (!activePanelIds.has(def.id)) {
        addPanel(def.id, def.defaultW, def.defaultH);
      }
    }
  }, [activePanelIds, addPanel]);

  const handleRemoveAllInCategory = useCallback((cat: PanelCategory) => {
    const defs = PANEL_REGISTRY.filter(d => d.category === cat);
    const defIds = new Set(defs.map(d => d.id));
    for (const instance of panels) {
      if (defIds.has(instance.panelId)) {
        removePanel(instance.instanceId);
      }
    }
  }, [panels, removePanel]);

  return (
    <div
      ref={panelRef}
      className={`fixed top-12 bottom-11 right-0 z-40 ${isMobile ? 'left-0' : 'w-[320px]'} glass-panel border-l border-white/[0.06] flex flex-col overflow-hidden transition-transform duration-200 ease-out ${
        panelAddOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      {/* Header */}
      <div className="shrink-0 h-10 px-3 flex items-center justify-between border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-display uppercase tracking-widest text-white/50">Widget Manager</span>
          <span className="text-[9px] text-white/30 tabular-nums">{activeCount} / {PANEL_REGISTRY.length} active</span>
        </div>
        <button onClick={() => setPanelAddOpen(false)} className="text-white/40 hover:text-white/80 transition-colors">
          <X size={14} />
        </button>
      </div>

      {/* Search */}
      <div className="shrink-0 px-3 py-2 border-b border-white/[0.06]">
        <div className="flex items-center gap-2 bg-white/[0.04] rounded px-2 py-1.5">
          <Search size={12} className="text-white/30 shrink-0" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search widgets..."
            className="bg-transparent text-[11px] text-white/90 placeholder:text-white/30 outline-none w-full"
          />
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {CATEGORY_ORDER.map(cat => {
          const defs = grouped.get(cat)!;
          if (defs.length === 0) return null;
          const isCollapsed = collapsed.has(cat);
          const count = activeCounts[cat] || 0;
          const totalInCat = PANEL_REGISTRY.filter(d => d.category === cat).length;
          const allActive = count === totalInCat;

          return (
            <div key={cat} className="border-b border-white/[0.04]">
              {/* Category header */}
              <div className="flex items-center justify-between px-3 py-2">
                <button
                  onClick={() => toggleCollapse(cat)}
                  className="flex items-center gap-1.5 hover:bg-white/[0.02] transition-colors"
                >
                  {isCollapsed ? <ChevronRight size={10} className="text-white/30" /> : <ChevronDown size={10} className="text-white/30" />}
                  <span className="text-[9px] uppercase tracking-widest text-white/40 font-medium">{CATEGORY_LABELS[cat]}</span>
                  {count > 0 && <span className="text-[9px] text-cyan-400/70 tabular-nums">{count}</span>}
                </button>
                {/* Bulk actions */}
                <div className="flex items-center gap-1">
                  {!allActive && (
                    <button
                      onClick={() => handleAddAllInCategory(cat)}
                      className="text-[9px] text-white/30 hover:text-cyan-400 transition-colors px-1"
                    >
                      Add All
                    </button>
                  )}
                  {count > 0 && (
                    <button
                      onClick={() => handleRemoveAllInCategory(cat)}
                      className="text-[9px] text-white/30 hover:text-red-400 transition-colors px-1"
                    >
                      Remove All
                    </button>
                  )}
                </div>
              </div>

              {/* Panel cards */}
              {!isCollapsed && (
                <div className="pb-1 px-2">
                  {defs.map(def => {
                    const isActive = activePanelIds.has(def.id);
                    const refreshColor = REFRESH_COLORS[def.refreshInterval || 'static'] || REFRESH_COLORS['static'];

                    return (
                      <div
                        key={def.id}
                        className="flex items-start justify-between px-2 py-2 rounded hover:bg-white/[0.03] transition-colors group"
                      >
                        <div className="flex-1 min-w-0 mr-2">
                          <div className="text-xs text-white/80">{def.label}</div>
                          <div className="text-[10px] text-white/30 leading-tight mt-0.5">{def.description}</div>
                          <div className="flex items-center gap-1.5 mt-1">
                            {def.refreshInterval && (
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${refreshColor}`}>
                                {def.refreshInterval}
                              </span>
                            )}
                            {def.dataSourceCount && def.dataSourceCount > 0 && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/40">
                                {def.dataSourceCount} source{def.dataSourceCount !== 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => handleTogglePanel(def.id, def.defaultW, def.defaultH)}
                          className={`shrink-0 w-7 h-7 rounded flex items-center justify-center transition-colors ${
                            isActive
                              ? 'bg-cyan-400/20 text-cyan-400 hover:bg-red-400/20 hover:text-red-400'
                              : 'bg-white/[0.06] text-white/20 hover:bg-cyan-400/20 hover:text-cyan-400'
                          }`}
                          title={isActive ? 'Remove panel' : 'Add panel'}
                        >
                          {isActive ? <Minus size={12} /> : <Plus size={12} />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {noResults && search && (
          <div className="px-3 py-6 text-center">
            <span className="text-[11px] text-white/30">No widgets match "{search}"</span>
          </div>
        )}
      </div>
    </div>
  );
}
