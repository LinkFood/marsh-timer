import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { STATE_ABBRS, STATE_NAMES } from '../_shared/states.ts';
import { batchEmbed } from '../_shared/embedding.ts';

const LOG_PREFIX = '[hunt-migration-monitor]';

const DUCK_SPECIES = [
  'mallard', 'wood duck', 'pintail', 'teal', 'wigeon', 'shoveler',
  'gadwall', 'canvasback', 'redhead', 'scaup', 'bufflehead',
  'goldeneye', 'merganser', 'scoter', 'eider', 'ring-necked duck',
  'ruddy duck', 'black duck', 'mottled duck', 'duck sp.',
  'whistling-duck', 'long-tailed duck',
];

function isDuck(comName: string): boolean {
  const lower = comName.toLowerCase();
  return DUCK_SPECIES.some(sp => lower.includes(sp));
}

function getISOWeek(d: Date): number {
  const date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface EBirdObs {
  comName: string;
  howMany: number | null;
  locName: string;
}

interface StateResult {
  state: string;
  sightingCount: number;
  locationCount: number;
  notableLocations: { name: string; count: number }[];
  baselineAvg: number;
  deviationPct: number;
  isSpike: boolean;
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const ebirdKey = Deno.env.get('EBIRD_API_KEY');
    if (!ebirdKey) return errorResponse(req, 'EBIRD_API_KEY not configured', 500);

    const body = await req.json().catch(() => ({}));
    const states: string[] = body.states && Array.isArray(body.states) && body.states.length > 0
      ? body.states
      : STATE_ABBRS;

    console.log(`${LOG_PREFIX} Processing ${states.length} states: ${states.join(', ')}`);

    const supabase = createSupabaseClient();
    const today = todayStr();
    const currentWeek = getISOWeek(new Date());
    const results: StateResult[] = [];

    // Process states sequentially with 1s delay between eBird calls
    for (const state of states) {
      try {
        // 1. Fetch recent duck observations from eBird
        const url = `https://api.ebird.org/v2/data/obs/US-${state}/recent?back=1&cat=domestic,species`;
        const resp = await fetch(url, {
          headers: {
            'X-eBirdApiToken': ebirdKey,
            'User-Agent': 'DuckCountdown/1.0 (duckcountdown.com)',
          },
        });

        if (!resp.ok) {
          const errBody = await resp.text().catch(() => '');
          console.log(`${LOG_PREFIX} eBird API error for ${state}: ${resp.status} ${errBody.substring(0, 200)}`);
          await sleep(1000);
          continue;
        }

        const observations: EBirdObs[] = await resp.json();

        // 2. Filter to duck/waterfowl species
        const duckObs = observations.filter(o => isDuck(o.comName));

        // 3. Count total sightings (default howMany to 1 if null)
        const sightingCount = duckObs.reduce((sum, o) => sum + (o.howMany ?? 1), 0);

        // 4. Count unique locations
        const uniqueLocations = new Set(duckObs.map(o => o.locName));
        const locationCount = uniqueLocations.size;

        // 5. Extract notable locations: top 5 by sighting count
        const locationCounts = new Map<string, number>();
        for (const o of duckObs) {
          locationCounts.set(o.locName, (locationCounts.get(o.locName) || 0) + (o.howMany ?? 1));
        }
        const notableLocations = Array.from(locationCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([name, count]) => ({ name, count }));

        // 6. Query historical baseline (same week-of-year)
        const { data: historical } = await supabase
          .from('hunt_migration_history')
          .select('date,sighting_count')
          .eq('state_abbr', state)
          .eq('species', 'duck');

        const baselineData = (historical || []).filter(h => {
          const d = new Date(h.date);
          return getISOWeek(d) === currentWeek;
        });
        const baselineAvg = baselineData.length > 0
          ? baselineData.reduce((s, d) => s + d.sighting_count, 0) / baselineData.length
          : 0;

        // 7. Calculate deviation
        const deviationPct = ((sightingCount - baselineAvg) / Math.max(baselineAvg, 1)) * 100;
        const isSpike = deviationPct > 50;

        results.push({
          state,
          sightingCount,
          locationCount,
          notableLocations,
          baselineAvg,
          deviationPct,
          isSpike,
        });

        console.log(`${LOG_PREFIX} ${state}: ${sightingCount} sightings, ${locationCount} locations, baseline=${baselineAvg.toFixed(1)}, deviation=${deviationPct.toFixed(1)}%${isSpike ? ' SPIKE' : ''}`);

        // 1s delay between eBird API calls
        await sleep(1000);
      } catch (err) {
        console.log(`${LOG_PREFIX} Error processing ${state}: ${err instanceof Error ? err.message : String(err)}`);
        await sleep(1000);
      }
    }

    // 8. Upsert into hunt_migration_history
    const historyRows = results.map(r => ({
      state_abbr: r.state,
      species: 'duck',
      date: today,
      sighting_count: r.sightingCount,
      location_count: r.locationCount,
      notable_locations: r.notableLocations,
    }));

    if (historyRows.length > 0) {
      const { error: histErr } = await supabase
        .from('hunt_migration_history')
        .upsert(historyRows, { onConflict: 'state_abbr,species,date' });
      if (histErr) console.log(`${LOG_PREFIX} History upsert error: ${histErr.message}`);
    }

    // 9. Insert spikes
    const spikeResults = results.filter(r => r.isSpike);
    if (spikeResults.length > 0) {
      const spikeRows = spikeResults.map(r => ({
        state_abbr: r.state,
        date: today,
        sighting_count: r.sightingCount,
        baseline_avg: r.baselineAvg,
        deviation_pct: r.deviationPct,
        species: 'duck',
        notable_locations: r.notableLocations,
      }));

      const { error: spikeErr } = await supabase
        .from('hunt_migration_spikes')
        .insert(spikeRows);
      if (spikeErr) console.log(`${LOG_PREFIX} Spike insert error: ${spikeErr.message}`);
    }

    // 10. Embed every daily observation into hunt_knowledge
    const embedTexts: string[] = [];
    const embedRows: { title: string; content: string; content_type: string; tags: string[] }[] = [];

    for (const r of results) {
      const stateName = STATE_NAMES[r.state] || r.state;
      const topLocs = r.notableLocations.map(l => l.name).join(', ');
      const prefix = r.isSpike ? 'SPIKE migration' : 'migration';
      const contentType = r.isSpike ? 'migration-spike' : 'migration-daily';

      const text = `${prefix} | ${stateName} | ${today} | species:duck sightings:${r.sightingCount} baseline:${r.baselineAvg.toFixed(1)} deviation:${r.deviationPct.toFixed(1)}% | ${topLocs}`;

      embedTexts.push(text);
      embedRows.push({
        title: `${r.isSpike ? 'SPIKE: ' : ''}Duck migration ${stateName} ${today}`,
        content: text,
        content_type: contentType,
        tags: ['migration', r.state.toLowerCase(), 'duck', r.isSpike ? 'spike' : 'daily'],
        state_abbr: r.state,
      });
    }

    let embeddingsCreated = 0;
    if (embedTexts.length > 0) {
      try {
        const embeddings = await batchEmbed(embedTexts);

        const knowledgeRows = embedRows.map((row, i) => ({
          ...row,
          embedding: embeddings[i],
        }));

        const { error: embedErr } = await supabase
          .from('hunt_knowledge')
          .insert(knowledgeRows);

        if (embedErr) {
          console.log(`${LOG_PREFIX} Knowledge insert error: ${embedErr.message}`);
        } else {
          embeddingsCreated = knowledgeRows.length;
        }
      } catch (err) {
        console.log(`${LOG_PREFIX} Embedding error: ${err.message}`);
      }
    }

    const summary = {
      states_processed: results.length,
      states_requested: states.length,
      total_sightings: results.reduce((s, r) => s + r.sightingCount, 0),
      spikes_detected: spikeResults.length,
      embeddings_created: embeddingsCreated,
    };

    console.log(`${LOG_PREFIX} Done: ${JSON.stringify(summary)}`);
    return successResponse(req, summary);
  } catch (err) {
    console.log(`${LOG_PREFIX} Fatal error: ${err.message}`);
    return errorResponse(req, err.message, 500);
  }
});
