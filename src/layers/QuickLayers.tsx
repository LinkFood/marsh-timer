import { useCallback } from 'react';
import { useLayerContext } from '@/contexts/LayerContext';
import { LAYER_PRESETS } from '@/layers/LayerRegistry';

/**
 * Quick-toggle layer pills rendered below the map.
 * Each button either toggles a single layer or applies a preset.
 * Provides one-click discoverability without opening the full LayerPicker.
 *
 * FUSION button overlays weather + birdcast simultaneously —
 * the overlap IS the pattern (where weather pushes birds).
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

/** All layers that FUSION activates: full weather preset + birdcast */
const WEATHER_PRESET = LAYER_PRESETS.find(p => p.id === 'weather');
const FUSION_LAYERS = [...(WEATHER_PRESET?.layers ?? []), 'birdcast'];

/** Hook to toggle fusion mode from outside QuickLayers (keyboard shortcuts) */
export function useFusionToggle() {
  const { activeLayers, setLayer } = useLayerContext();
  const fusionActive = FUSION_LAYERS.every(id => activeLayers.has(id));

  const toggleFusion = useCallback(() => {
    if (fusionActive) {
      for (const id of FUSION_LAYERS) setLayer(id, false);
    } else {
      for (const id of FUSION_LAYERS) setLayer(id, true);
    }
  }, [fusionActive, setLayer]);

  return toggleFusion;
}

export default function QuickLayers() {
  const { isLayerOn, toggleLayer, setLayer, applyPreset, activeLayers } = useLayerContext();

  /** Whether every fusion layer is currently active */
  const fusionActive = FUSION_LAYERS.every(id => activeLayers.has(id));

  /** Whether both weather preset AND birdcast are on (regardless of how they got there) */
  const isFusionMode = WEATHER_PRESET
    ? WEATHER_PRESET.layers.every(id => activeLayers.has(id)) && activeLayers.has('birdcast')
    : false;

  function handleClick(btn: QuickButton) {
    if (btn.presetId) {
      const preset = LAYER_PRESETS.find(p => p.id === btn.presetId);
      if (preset) {
        const allOn = preset.layers.every(id => activeLayers.has(id));
        if (allOn) {
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

  function handleFusionClick() {
    if (fusionActive) {
      // Turn everything off
      for (const id of FUSION_LAYERS) {
        setLayer(id, false);
      }
    } else {
      // Turn everything on (additive — keeps other layers intact)
      for (const id of FUSION_LAYERS) {
        setLayer(id, true);
      }
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

      {/* Fusion toggle — weather + birdcast overlaid */}
      <button
        onClick={handleFusionClick}
        className={`px-2 py-0.5 rounded-full text-[8px] font-mono uppercase tracking-wider transition-all ${
          fusionActive
            ? 'bg-gradient-to-r from-purple-500/25 to-amber-500/25 text-amber-300 border border-amber-400/40 shadow-[0_0_6px_rgba(251,191,36,0.15)]'
            : 'bg-white/[0.04] text-white/35 border border-purple-400/20 hover:bg-purple-500/10 hover:text-purple-300/70 hover:border-purple-400/30'
        }`}
      >
        Fusion
      </button>

      {/* Fusion mode indicator — visible when both weather + birdcast are on */}
      {isFusionMode && (
        <span className="ml-auto text-[7px] font-mono uppercase tracking-widest text-amber-400/60 animate-pulse select-none">
          Fusion Mode
        </span>
      )}
    </div>
  );
}
