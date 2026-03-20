import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';
import type { Species } from '@/data/types';

interface DeckContextValue {
  species: Species;
  setSpecies: (s: Species) => void;
  selectedState: string | null;
  setSelectedState: (abbr: string | null) => void;
  chatOpen: boolean;
  setChatOpen: (open: boolean) => void;
  toggleChat: () => void;
  layerPickerOpen: boolean;
  setLayerPickerOpen: (open: boolean) => void;
  toggleLayerPicker: () => void;
  panelAddOpen: boolean;
  setPanelAddOpen: (open: boolean) => void;
  togglePanelAdd: () => void;
}

const DeckContext = createContext<DeckContextValue | null>(null);

export function useDeck() {
  const ctx = useContext(DeckContext);
  if (!ctx) throw new Error('useDeck must be used within DeckProvider');
  return ctx;
}

interface DeckProviderProps {
  children: ReactNode;
  species: Species;
  setSpecies: (s: Species) => void;
  selectedState: string | null;
  setSelectedState: (abbr: string | null) => void;
}

export function DeckProvider({ children, species, setSpecies, selectedState, setSelectedState }: DeckProviderProps) {
  const [chatOpen, setChatOpen] = useState(false);
  const [layerPickerOpen, setLayerPickerOpen] = useState(false);
  const [panelAddOpen, setPanelAddOpen] = useState(false);

  const toggleChat = useCallback(() => setChatOpen(o => !o), []);
  const toggleLayerPicker = useCallback(() => setLayerPickerOpen(o => !o), []);
  const togglePanelAdd = useCallback(() => setPanelAddOpen(o => !o), []);

  const value = useMemo<DeckContextValue>(() => ({
    species, setSpecies,
    selectedState, setSelectedState,
    chatOpen, setChatOpen, toggleChat,
    layerPickerOpen, setLayerPickerOpen, toggleLayerPicker,
    panelAddOpen, setPanelAddOpen, togglePanelAdd,
  }), [species, setSpecies, selectedState, setSelectedState, chatOpen, toggleChat, layerPickerOpen, toggleLayerPicker, panelAddOpen, togglePanelAdd]);

  return <DeckContext.Provider value={value}>{children}</DeckContext.Provider>;
}
