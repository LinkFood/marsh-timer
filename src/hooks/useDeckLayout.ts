import { useState, useCallback, useRef, useEffect } from 'react';
import type { PanelInstance, DeckState } from '@/panels/PanelTypes';
import { DEFAULT_LAYOUT } from '@/panels/PanelTypes';

const STORAGE_KEY = 'dc-deck-v2';
const DECK_CHANGE_EVENT = 'dc-deck-change';

function loadDeck(): PanelInstance[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const state: DeckState = JSON.parse(stored);
      if (state.version === 1 && Array.isArray(state.panels) && state.panels.length > 0) {
        return state.panels;
      }
    }
  } catch { /* ignore */ }
  return DEFAULT_LAYOUT;
}

function saveDeck(panels: PanelInstance[]) {
  const state: DeckState = { panels, version: 1 };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new Event(DECK_CHANGE_EVENT));
}

let instanceCounter = 0;

export function useDeckLayout() {
  const [panels, setPanels] = useState<PanelInstance[]>(loadDeck);
  const panelsRef = useRef(panels);
  panelsRef.current = panels;

  useEffect(() => {
    const handler = () => {
      const fresh = loadDeck();
      setPanels(fresh);
    };
    window.addEventListener(DECK_CHANGE_EVENT, handler);
    return () => window.removeEventListener(DECK_CHANGE_EVENT, handler);
  }, []);

  const addPanel = useCallback((panelId: string, defaultW = 4, defaultH = 4) => {
    instanceCounter++;
    const instanceId = `${panelId}-${Date.now()}-${instanceCounter}`;
    // Place at end, react-grid-layout will handle collision
    const newPanel: PanelInstance = {
      panelId,
      instanceId,
      x: 0,
      y: Infinity,
      w: defaultW,
      h: defaultH,
    };
    setPanels(prev => {
      const next = [...prev, newPanel];
      saveDeck(next);
      return next;
    });
  }, []);

  const removePanel = useCallback((instanceId: string) => {
    setPanels(prev => {
      const next = prev.filter(p => p.instanceId !== instanceId);
      saveDeck(next);
      return next;
    });
  }, []);

  const updateLayout = useCallback((layouts: Array<{ i: string; x: number; y: number; w: number; h: number }>) => {
    setPanels(prev => {
      const layoutMap = new Map(layouts.map(l => [l.i, l]));
      const next = prev.map(p => {
        const l = layoutMap.get(p.instanceId);
        if (!l) return p;
        return { ...p, x: l.x, y: l.y, w: l.w, h: l.h };
      });
      saveDeck(next);
      return next;
    });
  }, []);

  const resetLayout = useCallback(() => {
    setPanels(DEFAULT_LAYOUT);
    saveDeck(DEFAULT_LAYOUT);
  }, []);

  return { panels, addPanel, removePanel, updateLayout, resetLayout };
}
