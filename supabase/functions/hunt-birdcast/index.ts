import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { STATE_ABBRS } from '../_shared/states.ts';
import { batchEmbed } from '../_shared/embedding.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NightReading {
  numAloft: number;
  meanHeight: number;
  avgDirection: number;
  avgSpeed: number;
  vid: number;
}

interface BirdcastData {
  cumulativeBirds: number;
  isHigh: boolean;
  nightSeries: NightReading[];
}

interface BirdcastRow {
  date: string;
  state_abbr: string;
  cumulative_birds: number | null;
  is_high: boolean;
  peak_num_aloft: number | null;
  avg_direction: number | null;
  avg_speed: number | null;
  mean_height: number | null;
  raw_data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Season check — only run during migration season
// ---------------------------------------------------------------------------

function isInMigrationSeason(): boolean {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-indexed
  const day = now.getDate();

  // Spring: Mar 1 - Jun 15
  if (month >= 3 && (month < 6 || (month === 6 && day <= 15))) return true;
  // Fall: Aug 1 - Nov 15
  if (month >= 8 && (month < 11 || (month === 11 && day <= 15))) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Parse BirdCast NUXT data from HTML via eval of the IIFE
// ---------------------------------------------------------------------------

function parseBirdcastHtml(html: string): BirdcastData | null {
  // The NUXT payload is a minified IIFE: window.__NUXT__=(function(a,b,...){...})(v1,v2,...)
  // Regex won't work because field assignments use variable aliases.
  // We eval the IIFE to get the resolved object, then navigate to the migration data.
  const nuxtMatch = html.match(/window\.__NUXT__\s*=\s*([\s\S]*?)<\/script>/);
  if (!nuxtMatch) {
    console.warn('[hunt-birdcast] No __NUXT__ block found in HTML');
    return null;
  }

  let nuxtObj: Record<string, unknown>;
  try {
    // deno-lint-ignore no-eval
    nuxtObj = eval(nuxtMatch[1].replace(/;$/, ''));
  } catch (e) {
    console.warn(`[hunt-birdcast] Failed to eval NUXT payload: ${e}`);
    return null;
  }

  // Navigate: fetch["Region:0"].migrationLiveDataFromApi
  const fetchData = (nuxtObj as Record<string, unknown>)?.fetch as Record<string, Record<string, unknown>> | undefined;
  if (!fetchData) {
    console.warn('[hunt-birdcast] No fetch data in NUXT object');
    return null;
  }

  const regionData = fetchData['Region:0'];
  if (!regionData) {
    console.warn('[hunt-birdcast] No Region:0 in fetch data');
    return null;
  }

  const liveData = regionData.migrationLiveDataFromApi as {
    cumulativeBirds?: number;
    isHigh?: boolean;
    nightSeries?: Array<{
      numAloft?: number;
      meanHeight?: number;
      avgDirection?: number;
      avgSpeed?: number;
      vid?: number;
    }>;
  } | undefined;

  if (!liveData) {
    console.warn('[hunt-birdcast] No migrationLiveDataFromApi in Region:0');
    return null;
  }

  const nightSeries: NightReading[] = (liveData.nightSeries || [])
    .filter(r => r.numAloft != null)
    .map(r => ({
      numAloft: r.numAloft ?? 0,
      meanHeight: r.meanHeight ?? 0,
      avgDirection: r.avgDirection ?? 0,
      avgSpeed: r.avgSpeed ?? 0,
      vid: r.vid ?? 0,
    }));

  return {
    cumulativeBirds: liveData.cumulativeBirds ?? 0,
    isHigh: liveData.isHigh ?? false,
    nightSeries,
  };
}

// ---------------------------------------------------------------------------
// Process parsed data into a DB row
// ---------------------------------------------------------------------------

function toRow(stateAbbr: string, dateStr: string, data: BirdcastData): BirdcastRow {
  const series = data.nightSeries;

  let peakNumAloft: number | null = null;
  let avgDirection: number | null = null;
  let avgSpeed: number | null = null;
  let meanHeight: number | null = null;

  if (series.length > 0) {
    peakNumAloft = Math.max(...series.map(s => s.numAloft));

    // Average direction, speed, height across all readings
    const sumDir = series.reduce((a, s) => a + s.avgDirection, 0);
    const sumSpd = series.reduce((a, s) => a + s.avgSpeed, 0);
    const sumHt = series.reduce((a, s) => a + s.meanHeight, 0);

    avgDirection = Math.round((sumDir / series.length) * 10) / 10;
    avgSpeed = Math.round((sumSpd / series.length) * 10) / 10;
    meanHeight = Math.round((sumHt / series.length) * 10) / 10;
  }

  return {
    date: dateStr,
    state_abbr: stateAbbr,
    cumulative_birds: data.cumulativeBirds,
    is_high: data.isHigh,
    peak_num_aloft: peakNumAloft,
    avg_direction: avgDirection,
    avg_speed: avgSpeed,
    mean_height: meanHeight,
    raw_data: {
      cumulativeBirds: data.cumulativeBirds,
      isHigh: data.isHigh,
      nightSeriesCount: series.length,
      nightSeries: series.slice(0, 10), // Cap stored series to save space
    },
  };
}

// ---------------------------------------------------------------------------
// Compass helper
// ---------------------------------------------------------------------------

function degreesToCompass(deg: number): string {
  if (deg >= 337 || deg < 23) return 'N';
  if (deg < 68) return 'NE';
  if (deg < 113) return 'E';
  if (deg < 158) return 'SE';
  if (deg < 203) return 'S';
  if (deg < 248) return 'SW';
  if (deg < 293) return 'W';
  return 'NW';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    console.log('[hunt-birdcast] Starting BirdCast scraper run');

    // Check migration season
    if (!isInMigrationSeason()) {
      console.log('[hunt-birdcast] Outside migration season, skipping');
      return successResponse(req, { skipped: true, reason: 'outside_migration_season' });
    }

    const supabase = createSupabaseClient();
    const today = new Date().toISOString().split('T')[0];

    const rows: BirdcastRow[] = [];
    const embedTexts: string[] = [];
    const embedMeta: { title: string; content: string; content_type: string; tags: string[]; state_abbr: string; metadata: Record<string, unknown> }[] = [];
    let fetchErrors = 0;
    let parseErrors = 0;

    // Process all 50 states with 1s delay between requests
    for (const abbr of STATE_ABBRS) {
      const url = `https://dashboard.birdcast.org/region/US-${abbr}`;

      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; DuckCountdown/1.0; +https://duckcountdown.com)',
            'Accept': 'text/html,application/xhtml+xml',
          },
        });

        if (!res.ok) {
          console.warn(`[hunt-birdcast] ${abbr}: HTTP ${res.status}`);
          fetchErrors++;
          continue;
        }

        const html = await res.text();
        const data = parseBirdcastHtml(html);

        if (!data) {
          console.warn(`[hunt-birdcast] ${abbr}: Failed to parse NUXT data`);
          parseErrors++;
          continue;
        }

        const row = toRow(abbr, today, data);
        rows.push(row);

        // Build embedding text
        const dirStr = row.avg_direction != null ? `${degreesToCompass(row.avg_direction)}(${row.avg_direction}°)` : 'unknown';
        const spdStr = row.avg_speed != null ? `${row.avg_speed}` : 'unknown';
        const embedText = `birdcast | ${abbr} | ${today} | birds:${row.cumulative_birds} intensity:${data.isHigh ? 'high' : 'low'} direction:${dirStr} speed:${spdStr}`;
        embedTexts.push(embedText);
        embedMeta.push({
          title: `${abbr} birdcast ${today}`,
          content: embedText,
          content_type: 'birdcast-daily',
          tags: [abbr, 'birdcast', 'migration', today],
          state_abbr: abbr,
          metadata: { source: 'birdcast', date: today },
        });

        console.log(`[hunt-birdcast] ${abbr}: ${row.cumulative_birds} birds, high=${data.isHigh}`);
      } catch (err) {
        console.error(`[hunt-birdcast] ${abbr}: fetch error:`, err);
        fetchErrors++;
      }

      // Rate limit: 1 request per second
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // -----------------------------------------------------------------------
    // Upsert rows into hunt_birdcast
    // -----------------------------------------------------------------------
    console.log(`[hunt-birdcast] Upserting ${rows.length} rows`);
    if (rows.length > 0) {
      const { error: upsertErr } = await supabase
        .from('hunt_birdcast')
        .upsert(rows, { onConflict: 'date,state_abbr' });
      if (upsertErr) {
        console.error('[hunt-birdcast] Upsert error:', upsertErr);
      }
    }

    // -----------------------------------------------------------------------
    // Embed into hunt_knowledge
    // -----------------------------------------------------------------------
    let embeddingsCreated = 0;
    if (embedTexts.length > 0) {
      console.log(`[hunt-birdcast] Embedding ${embedTexts.length} entries`);
      try {
        const embeddings = await batchEmbed(embedTexts, 'document');

        if (embeddings && embeddings.length === embedTexts.length) {
          const KNOWLEDGE_BATCH = 50;
          for (let i = 0; i < embeddings.length; i += KNOWLEDGE_BATCH) {
            const batchRows = [];
            for (let j = i; j < Math.min(i + KNOWLEDGE_BATCH, embeddings.length); j++) {
              const meta = embedMeta[j];
              batchRows.push({
                title: meta.title,
                content: meta.content,
                content_type: meta.content_type,
                tags: meta.tags,
                state_abbr: meta.state_abbr,
                metadata: meta.metadata,
                embedding: embeddings[j],
              });
            }
            const { error: knErr } = await supabase
              .from('hunt_knowledge')
              .insert(batchRows);
            if (knErr) {
              console.error(`[hunt-birdcast] Knowledge insert error (batch ${i / KNOWLEDGE_BATCH}):`, knErr);
            } else {
              embeddingsCreated += batchRows.length;
            }
          }
        } else {
          console.error(`[hunt-birdcast] Embedding count mismatch: expected ${embedTexts.length}, got ${embeddings?.length ?? 0}`);
        }
      } catch (embedErr) {
        console.error('[hunt-birdcast] Embedding error:', embedErr);
      }
    }

    // -----------------------------------------------------------------------
    // Update embedded_at on rows that got embedded
    // -----------------------------------------------------------------------
    if (embeddingsCreated > 0) {
      const embeddedAbbrs = embedMeta.slice(0, embeddingsCreated).map(m => m.state_abbr);
      const { error: updateErr } = await supabase
        .from('hunt_birdcast')
        .update({ embedded_at: new Date().toISOString() })
        .eq('date', today)
        .in('state_abbr', embeddedAbbrs);
      if (updateErr) {
        console.error('[hunt-birdcast] embedded_at update error:', updateErr);
      }
    }

    // -----------------------------------------------------------------------
    // Done
    // -----------------------------------------------------------------------
    const summary = {
      states_scraped: rows.length,
      fetch_errors: fetchErrors,
      parse_errors: parseErrors,
      embeddings_created: embeddingsCreated,
      date: today,
      run_at: new Date().toISOString(),
    };
    console.log('[hunt-birdcast] Complete:', JSON.stringify(summary));

    return successResponse(req, summary);
  } catch (error) {
    console.error('[hunt-birdcast] Fatal error:', error);
    return errorResponse(req, 'Internal server error', 500);
  }
});
