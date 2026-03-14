import { createContext, useContext, ReactNode } from 'react';

type MapMode = 'default' | 'scout' | 'weather' | 'terrain' | 'intel';

interface MapActionContextValue {
  flyTo: (abbr: string) => void;
  flyToCoords: (lng: number, lat: number, zoom?: number) => void;
  setMapMode: (mode: MapMode) => void;
}

const MapActionContext = createContext<MapActionContextValue | null>(null);

export function useMapAction() {
  const ctx = useContext(MapActionContext);
  if (!ctx) throw new Error('useMapAction must be used within MapActionProvider');
  return ctx;
}

interface MapActionProviderProps {
  children: ReactNode;
  flyTo: (abbr: string) => void;
  flyToCoords: (lng: number, lat: number, zoom?: number) => void;
  setMapMode: (mode: MapMode) => void;
}

export function MapActionProvider({ children, flyTo, flyToCoords, setMapMode }: MapActionProviderProps) {
  return (
    <MapActionContext.Provider value={{ flyTo, flyToCoords, setMapMode }}>
      {children}
    </MapActionContext.Provider>
  );
}
