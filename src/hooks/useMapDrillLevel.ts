import { useState, useCallback } from 'react';
import type { Species } from '@/data/types';

export type DrillLevel = 'national' | 'state' | 'zone';

interface DrillState {
  level: DrillLevel;
  species: Species;
  stateAbbr: string | null;
  zoneSlug: string | null;
}

export function useMapDrillLevel(initialSpecies: Species = 'duck') {
  const [drill, setDrill] = useState<DrillState>({
    level: 'national',
    species: initialSpecies,
    stateAbbr: null,
    zoneSlug: null,
  });

  const drillToState = useCallback((stateAbbr: string) => {
    setDrill(prev => ({
      ...prev,
      level: 'state',
      stateAbbr,
      zoneSlug: null,
    }));
  }, []);

  const drillToZone = useCallback((zoneSlug: string) => {
    setDrill(prev => ({
      ...prev,
      level: 'zone',
      zoneSlug,
    }));
  }, []);

  const drillUp = useCallback(() => {
    setDrill(prev => {
      if (prev.level === 'zone') return { ...prev, level: 'state', zoneSlug: null };
      if (prev.level === 'state') return { ...prev, level: 'national', stateAbbr: null, zoneSlug: null };
      return prev;
    });
  }, []);

  const setSpecies = useCallback((species: Species) => {
    setDrill(prev => ({
      ...prev,
      species,
      // Keep state if switching species, reset zone
      zoneSlug: null,
      level: prev.stateAbbr ? 'state' : 'national',
    }));
  }, []);

  const reset = useCallback(() => {
    setDrill(prev => ({
      level: 'national',
      species: prev.species,
      stateAbbr: null,
      zoneSlug: null,
    }));
  }, []);

  return {
    ...drill,
    drillToState,
    drillToZone,
    drillUp,
    setSpecies,
    reset,
  };
}
