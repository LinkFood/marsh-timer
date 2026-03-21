import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Save, Trash2, Layout, X } from 'lucide-react';
import { useDeckManager } from '@/hooks/useDeckManager';
import { useDeckLayout } from '@/hooks/useDeckLayout';
import { useDeck } from '@/contexts/DeckContext';
import { useLayerContext } from '@/contexts/LayerContext';
import { PANEL_MAP } from '@/panels/PanelRegistry';
import type { DeckConfig } from '@/panels/PanelTypes';

export default function DeckSelector() {
  const { configs, activeConfigId, setActiveConfigId, saveConfig, deleteConfig, loading } = useDeckManager();
  const { panels, replacePanels } = useDeckLayout();
  const { gridPreset, setGridPreset } = useDeck();
  const { activeLayers, applyPreset } = useLayerContext();

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSaving(false);
        setSaveName('');
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Focus name input when save mode opens
  useEffect(() => {
    if (saving && nameInputRef.current) nameInputRef.current.focus();
  }, [saving]);

  const builtinConfigs = configs.filter(c => c.is_builtin);
  const userConfigs = configs.filter(c => !c.is_builtin);

  const activeConfig = configs.find(c => c.id === activeConfigId);
  const displayName = activeConfig?.name || 'Custom';

  function applyConfig(config: DeckConfig) {
    replacePanels(config.panels);
    setGridPreset(config.grid_preset);
    if (config.active_layers?.length) {
      applyPreset({ id: 'custom', name: 'Custom', layers: config.active_layers });
    }
    setActiveConfigId(config.id);
    setOpen(false);
  }

  async function handleSave() {
    const name = saveName.trim();
    if (!name) return;
    const result = await saveConfig(name, panels, gridPreset, [...activeLayers]);
    if (result) {
      setActiveConfigId(result.id);
    }
    setSaving(false);
    setSaveName('');
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    await deleteConfig(id);
  }

  function handleReset() {
    replacePanels([
      { panelId: 'convergence', instanceId: 'convergence-1', x: 0, y: 0, w: 4, h: 4 },
      { panelId: 'scout-report', instanceId: 'scout-report-1', x: 4, y: 0, w: 4, h: 4 },
      { panelId: 'brain-search', instanceId: 'brain-search-1', x: 8, y: 0, w: 4, h: 5 },
      { panelId: 'weather-events', instanceId: 'weather-events-1', x: 0, y: 4, w: 4, h: 4 },
      { panelId: 'brain-activity', instanceId: 'brain-activity-1', x: 4, y: 4, w: 4, h: 4 },
    ]);
    setGridPreset('default');
    setActiveConfigId(null);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Desktop: text button. Mobile: icon only */}
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 px-2 py-1 rounded text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Deck selector"
      >
        <Layout className="w-3.5 h-3.5" />
        <span className="hidden sm:inline text-[10px] font-display uppercase tracking-widest max-w-[80px] truncate">
          {displayName}
        </span>
        <ChevronDown className="w-3 h-3 hidden sm:block" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 w-56 bg-[#0a0f1a]/90 backdrop-blur-sm border border-white/[0.06] rounded-lg shadow-xl z-50 py-1">
          {/* Saved Decks */}
          {userConfigs.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-[9px] font-display uppercase tracking-widest text-white/30">
                Saved Decks
              </div>
              {userConfigs.map(c => (
                <button
                  key={c.id}
                  onClick={() => applyConfig(c)}
                  className="w-full text-left px-3 py-2 hover:bg-white/[0.04] transition-colors flex items-center gap-2"
                >
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${activeConfigId === c.id ? 'bg-cyan-400' : 'bg-white/10'}`} />
                  <span className="flex-1 truncate">
                    <span className="text-[11px] font-body text-white/80 block truncate">{c.name}</span>
                    <span className="text-[9px] text-white/30 block mt-0.5">
                      {c.panels.length} panels · {c.panels.slice(0, 3).map(p => {
                        const def = PANEL_MAP.get(p.panelId);
                        return def?.label || p.panelId;
                      }).join(', ')}{c.panels.length > 3 ? ` +${c.panels.length - 3}` : ''}
                    </span>
                  </span>
                  <button
                    onClick={(e) => handleDelete(e, c.id)}
                    className="p-0.5 text-white/20 hover:text-red-400 transition-colors"
                    aria-label={`Delete ${c.name}`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </button>
              ))}
              <div className="mx-3 my-1 border-t border-white/[0.06]" />
            </>
          )}

          {/* Templates */}
          {builtinConfigs.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-[9px] font-display uppercase tracking-widest text-white/30">
                Templates
              </div>
              {builtinConfigs.map(c => (
                <button
                  key={c.id}
                  onClick={() => applyConfig(c)}
                  className="w-full text-left px-3 py-2 hover:bg-white/[0.04] transition-colors flex items-center gap-2"
                >
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${activeConfigId === c.id ? 'bg-cyan-400' : 'bg-white/10'}`} />
                  <span className="truncate">
                    <span className="text-[11px] font-body text-white/80 block truncate">{c.name}</span>
                    <span className="text-[9px] text-white/30 block mt-0.5">
                      {c.panels.length} panels · {c.panels.slice(0, 3).map(p => {
                        const def = PANEL_MAP.get(p.panelId);
                        return def?.label || p.panelId;
                      }).join(', ')}{c.panels.length > 3 ? ` +${c.panels.length - 3}` : ''}
                    </span>
                  </span>
                </button>
              ))}
              <div className="mx-3 my-1 border-t border-white/[0.06]" />
            </>
          )}

          {/* Save Current Layout */}
          {!saving ? (
            <button
              onClick={() => setSaving(true)}
              className="w-full text-left px-3 py-2 hover:bg-white/[0.04] transition-colors flex items-center gap-2"
            >
              <Save className="w-3.5 h-3.5 text-white/40" />
              <span className="text-[11px] font-body text-white/70">Save Current Layout</span>
            </button>
          ) : (
            <div className="px-3 py-2 flex items-center gap-1.5">
              <input
                ref={nameInputRef}
                type="text"
                value={saveName}
                onChange={e => setSaveName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') { setSaving(false); setSaveName(''); } }}
                placeholder="Deck name..."
                className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded px-2 py-1 text-[11px] font-body text-white/80 placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-cyan-400/30"
              />
              <button
                onClick={handleSave}
                disabled={!saveName.trim()}
                className="p-1 text-cyan-400 hover:text-cyan-300 disabled:text-white/20 transition-colors"
                aria-label="Save deck"
              >
                <Save className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => { setSaving(false); setSaveName(''); }}
                className="p-1 text-white/30 hover:text-white/60 transition-colors"
                aria-label="Cancel"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Reset to Default */}
          <button
            onClick={handleReset}
            className="w-full text-left px-3 py-2 hover:bg-white/[0.04] transition-colors flex items-center gap-2"
          >
            <Layout className="w-3.5 h-3.5 text-red-400/60" />
            <span className="text-[11px] font-body text-red-400/80">Reset to Default</span>
          </button>
        </div>
      )}
    </div>
  );
}
