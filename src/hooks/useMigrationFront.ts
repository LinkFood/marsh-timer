import { useState, useEffect } from 'react';
import type { Feature, LineString } from 'geojson';
import { estimateMigrationFront, getMigrationSeason } from '@/lib/migrationFront';

export function useMigrationFront() {
  const [frontLine, setFrontLine] = useState<Feature<LineString> | null>(null);

  useEffect(() => {
    async function fetchFront() {
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        if (!supabaseUrl || !supabaseKey) return;

        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        const dateStr = weekAgo.toISOString().split('T')[0];

        // Fetch recent migration data (columns: state_abbr, sighting_count, date)
        const res = await fetch(
          `${supabaseUrl}/rest/v1/hunt_migration_history?select=state_abbr,sighting_count&date=gte.${dateStr}`,
          {
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
            },
          }
        );

        if (!res.ok) return;
        const rows: { state_abbr: string; sighting_count: number }[] = await res.json();

        // Aggregate by state
        const stateCounts = new Map<string, number>();
        for (const row of rows) {
          const abbr = row.state_abbr;
          stateCounts.set(abbr, (stateCounts.get(abbr) || 0) + (row.sighting_count || 0));
        }

        const sightings = [...stateCounts.entries()].map(([state, count]) => ({ state, count }));
        const season = getMigrationSeason();
        const front = estimateMigrationFront(sightings, season);
        setFrontLine(front);
      } catch {
        // silent fail — data may not exist yet
      }
    }

    fetchFront();
  }, []);

  return frontLine;
}
