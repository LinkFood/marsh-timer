import { useMemo } from 'react';
import type { Species } from '@/data/types';
import { getSeasonsByState } from '@/data/seasons';
import { getSeasonStatus, getCompactCountdown } from '@/lib/seasonUtils';

export interface HuntContext {
  seasons: Array<{
    seasonType: string;
    zone: string;
    status: string;
    countdown: string;
    dates: Array<{ open: string; close: string }>;
  }>;
  species: Species;
  stateAbbr: string | null;
}

export function useHuntContext(species: Species, stateAbbr: string | null): HuntContext {
  const seasons = useMemo(() => {
    if (!stateAbbr) return [];
    const all = getSeasonsByState(species, stateAbbr);
    const now = new Date();
    return all.map(s => ({
      seasonType: s.seasonType,
      zone: s.zone,
      status: getSeasonStatus(s, now),
      countdown: getCompactCountdown(s),
      dates: s.dates.map(d => ({ open: d.open, close: d.close })),
    }));
  }, [species, stateAbbr]);

  return { seasons, species, stateAbbr };
}
