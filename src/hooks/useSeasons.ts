import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Species, HuntingSeason } from '@/data/types';
import { getSeasonsForSpecies as getStaticSeasons, getSeasonsByState as getStaticByState, getPrimarySeasonForState as getStaticPrimary, getStatesForSpecies as getStaticStates, getAllSpeciesForState as getStaticAllSpecies } from '@/data/seasons';

interface DbSeason {
  id: string;
  species_id: string;
  state_abbr: string;
  state_name: string;
  season_type: string;
  zone: string;
  zone_slug: string;
  dates: { open: string; close: string }[];
  bag_limit: number;
  flyway: string | null;
  weapon: string | null;
  notes: string | null;
  verified: boolean;
  source_url: string | null;
  season_year: string;
}

function dbToHuntingSeason(row: DbSeason): HuntingSeason {
  return {
    species: row.species_id as Species,
    state: row.state_name,
    abbreviation: row.state_abbr,
    seasonType: row.season_type as HuntingSeason['seasonType'],
    zone: row.zone,
    zoneSlug: row.zone_slug,
    dates: row.dates,
    bagLimit: row.bag_limit,
    flyway: row.flyway || undefined,
    weapon: row.weapon || undefined,
    notes: row.notes || undefined,
    verified: row.verified,
    sourceUrl: row.source_url || undefined,
    seasonYear: row.season_year,
  };
}

export function useSeasons(species: Species) {
  return useQuery({
    queryKey: ['seasons', species],
    queryFn: async (): Promise<HuntingSeason[]> => {
      if (!supabase) return getStaticSeasons(species);

      const { data, error } = await supabase
        .from('hunt_seasons')
        .select('*')
        .eq('species_id', species);

      if (error || !data || data.length === 0) {
        console.warn('Supabase seasons fetch failed, using static fallback:', error);
        return getStaticSeasons(species);
      }

      return data.map(dbToHuntingSeason);
    },
    staleTime: 10 * 60 * 1000, // 10 min
  });
}

// Re-export static helpers for components that don't need reactivity
export { getStaticSeasons as getSeasonsForSpecies };
export { getStaticByState as getSeasonsByState };
export { getStaticPrimary as getPrimarySeasonForState };
export { getStaticStates as getStatesForSpecies };
export { getStaticAllSpecies as getAllSpeciesForState };
