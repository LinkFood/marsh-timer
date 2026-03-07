import { useQuery } from "@tanstack/react-query";
import { SUPABASE_FUNCTIONS_URL } from "@/lib/supabase";
import type { Species } from "@/data/types";

export interface IntelResult {
  title: string;
  content: string;
  content_type: string;
  similarity?: number;
}

export function useStateIntel(species: Species, stateAbbr: string | null) {
  return useQuery({
    queryKey: ["state-intel", species, stateAbbr],
    queryFn: async (): Promise<IntelResult[]> => {
      if (!stateAbbr || !SUPABASE_FUNCTIONS_URL) return [];

      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/hunt-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `${species} hunting ${stateAbbr} weather patterns tips`,
          species,
          state_abbr: stateAbbr,
          limit: 5,
        }),
      });

      if (!res.ok) return [];
      const data = await res.json();

      const results: IntelResult[] = [];

      // Vector results (patterns, facts)
      for (const v of data.vector || []) {
        if (v.similarity > 0.3) {
          results.push({
            title: v.title,
            content: v.content,
            content_type: v.content_type,
            similarity: v.similarity,
          });
        }
      }

      return results.slice(0, 3);
    },
    enabled: !!stateAbbr,
    staleTime: 10 * 60 * 1000,
  });
}
