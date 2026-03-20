import { createContext, useContext, useState, useCallback, useMemo, useEffect, type ReactNode } from 'react';
import { LAYER_REGISTRY, LAYER_PRESETS, LAYER_MAP } from '@/layers/LayerRegistry';
import type { LayerPreset } from '@/layers/LayerTypes';

const STORAGE_KEY = 'dc-layers-v1';

function getDefaultLayers(): Set<string> {
  return new Set(LAYER_REGISTRY.filter(l => l.defaultOn).map(l => l.id));
}

function loadLayers(): Set<string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const arr = JSON.parse(stored);
      if (Array.isArray(arr)) return new Set(arr.filter((id: string) => LAYER_MAP.has(id)));
    }
  } catch { /* ignore */ }
  return getDefaultLayers();
}

interface LayerContextValue {
  activeLayers: Set<string>;
  isLayerOn: (id: string) => boolean;
  toggleLayer: (id: string) => void;
  setLayer: (id: string, on: boolean) => void;
  applyPreset: (preset: LayerPreset) => void;
  resetLayers: () => void;
  /** All Mapbox layer IDs that should be visible */
  visibleMapboxLayers: Set<string>;
  /** Whether satellite style is on */
  isSatellite: boolean;
  /** Whether 3D terrain is on */
  is3D: boolean;
}

const LayerContext = createContext<LayerContextValue | null>(null);

export function useLayerContext() {
  const ctx = useContext(LayerContext);
  if (!ctx) throw new Error('useLayerContext must be used within LayerProvider');
  return ctx;
}

export function LayerProvider({ children }: { children: ReactNode }) {
  const [activeLayers, setActiveLayers] = useState<Set<string>>(loadLayers);

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...activeLayers]));
  }, [activeLayers]);

  const isLayerOn = useCallback((id: string) => activeLayers.has(id), [activeLayers]);

  const toggleLayer = useCallback((id: string) => {
    setActiveLayers(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setLayer = useCallback((id: string, on: boolean) => {
    setActiveLayers(prev => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const applyPreset = useCallback((preset: LayerPreset) => {
    setActiveLayers(new Set(preset.layers));
  }, []);

  const resetLayers = useCallback(() => {
    setActiveLayers(getDefaultLayers());
  }, []);

  // Compute flat set of visible Mapbox layer IDs
  const visibleMapboxLayers = useMemo(() => {
    const set = new Set<string>();
    for (const layerId of activeLayers) {
      const def = LAYER_MAP.get(layerId);
      if (def) {
        for (const ml of def.mapboxLayers) set.add(ml);
      }
    }
    return set;
  }, [activeLayers]);

  const isSatellite = activeLayers.has('satellite');
  const is3D = activeLayers.has('3d-terrain');

  const value = useMemo<LayerContextValue>(() => ({
    activeLayers, isLayerOn, toggleLayer, setLayer, applyPreset, resetLayers,
    visibleMapboxLayers, isSatellite, is3D,
  }), [activeLayers, isLayerOn, toggleLayer, setLayer, applyPreset, resetLayers, visibleMapboxLayers, isSatellite, is3D]);

  return <LayerContext.Provider value={value}>{children}</LayerContext.Provider>;
}

export { LAYER_PRESETS };
