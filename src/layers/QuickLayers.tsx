import { useLayerContext } from '@/contexts/LayerContext';
import { LAYER_PRESETS } from '@/layers/LayerRegistry';

/**
 * Quick-toggle layer pills rendered below the map.
 * Each button either toggles a single layer or applies a preset.
 * Provides one-click discoverability without opening the full LayerPicker.
 */

interface QuickButton {
  label: string;
  /** Toggle a single layer by ID */
  layerId?: string;
  /** Apply a preset by ID instead */
  presetId?: string;
}

const QUICK_BUTTONS: QuickButton[] = [
  { label: 'Weather', presetId: 'weather' },
  { label: 'BirdCast', layerId: 'birdcast' },
  { label: '24h Change', layerId: 'convergence-delta' },
  { label: 'Scores', layerId: 'convergence-scores' },
];

export default function QuickLayers() {
  const { isLayerOn, toggleLayer, applyPreset, activeLayers } = useLayerContext();

  function handleClick(btn: QuickButton) {
    if (btn.presetId) {
      const preset = LAYER_PRESETS.find(p => p.id === btn.presetId);
      if (preset) {
        // If all preset layers are already on, reset to defaults by toggling them off
        const allOn = preset.layers.every(id => activeLayers.has(id));
        if (allOn) {
          // Turn off the preset-specific layers (leave others alone)
          for (const id of preset.layers) {
            if (activeLayers.has(id)) toggleLayer(id);
          }
        } else {
          applyPreset(preset);
        }
      }
      return;
    }
    if (btn.layerId) {
      toggleLayer(btn.layerId);
    }
  }

  function isActive(btn: QuickButton): boolean {
    if (btn.layerId) return isLayerOn(btn.layerId);
    if (btn.presetId) {
      const preset = LAYER_PRESETS.find(p => p.id === btn.presetId);
      if (preset) return preset.layers.every(id => activeLayers.has(id));
    }
    return false;
  }

  return (
    <div className="shrink-0 flex items-center gap-1.5 px-2 py-1 border-t border-white/[0.06] bg-[#0a0f1a]/80 backdrop-blur-sm">
      <span className="text-[8px] font-mono uppercase tracking-widest text-white/20 mr-1 select-none">Layers</span>
      {QUICK_BUTTONS.map(btn => {
        const active = isActive(btn);
        return (
          <button
            key={btn.label}
            onClick={() => handleClick(btn)}
            className={`px-2 py-0.5 rounded-full text-[8px] font-mono uppercase tracking-wider transition-all ${
              active
                ? 'bg-cyan-400/20 text-cyan-400 border border-cyan-400/30'
                : 'bg-white/[0.04] text-white/35 border border-white/[0.06] hover:bg-white/[0.08] hover:text-white/50'
            }`}
          >
            {btn.label}
          </button>
        );
      })}
    </div>
  );
}
