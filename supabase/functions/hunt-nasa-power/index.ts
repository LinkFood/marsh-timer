import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { STATE_CENTROIDS, STATE_ABBRS } from '../_shared/states.ts';
import { batchEmbed } from '../_shared/embedding.ts';

const NASA_POWER_BASE = 'https://power.larc.nasa.gov/api/temporal/daily/point';
const NASA_PARAMS = 'T2M,T2M_MAX,T2M_MIN,ALLSKY_SFC_SW_DWN,CLOUD_AMT,WS10M,PS,PRECTOTCORR';
const MAX_RUNTIME_MS = 140_000;
const DELAY_MS = 1000;

function celsiusToFahrenheit(c: number): number {
  return (c * 9) / 5 + 32;
}

function formatDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function isoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

interface NasaData {
  solar_radiation_kwh_m2: number | null;
  cloud_cover_pct: number | null;
  wind_speed_ms: number | null;
  surface_pressure_kpa: number | null;
  precipitation_mm: number | null;
  temp_avg_c: number | null;
  temp_max_c: number | null;
  temp_min_c: number | null;
  temp_avg_f: number | null;
  temp_max_f: number | null;
  temp_min_f: number | null;
}

function val(v: number | undefined): number | null {
  if (v === undefined || v === -999) return null;
  return v;
}

serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();

  try {
    let batch: number | null = null;
    try {
      const body = await req.json();
      if (body?.batch === 1 || body?.batch === 2) batch = body.batch;
    } catch {
      // No body or invalid JSON — process all states
    }

    // Target date: day before yesterday (NASA POWER ~2 day lag)
    const now = new Date();
    const target = new Date(now);
    target.setDate(target.getDate() - 2);
    const dateKey = formatDate(target);
    const dateStr = isoDate(target);

    console.log(`[hunt-nasa-power] Starting. Target date: ${dateStr}, batch: ${batch ?? 'all'}`);

    // Determine which states to process
    let states: string[];
    if (batch === 1) {
      states = STATE_ABBRS.slice(0, 25);
    } else if (batch === 2) {
      states = STATE_ABBRS.slice(25);
    } else {
      states = [...STATE_ABBRS];
    }

    const supabase = createSupabaseClient();
    let statesProcessed = 0;
    let statesUpdated = 0;
    const embedTexts: string[] = [];
    const embedMeta: { title: string; content: string; content_type: string; tags: string[]; state_abbr: string; metadata: Record<string, unknown> }[] = [];

    for (let i = 0; i < states.length; i++) {
      // Timeout check
      if (Date.now() - startTime > MAX_RUNTIME_MS) {
        console.log(`[hunt-nasa-power] Approaching timeout at state ${i}/${states.length}`);
        break;
      }

      const abbr = states[i];
      const centroid = STATE_CENTROIDS[abbr];
      if (!centroid) continue;

      try {
        const url = `${NASA_POWER_BASE}?parameters=${NASA_PARAMS}&community=RE&longitude=${centroid.lng}&latitude=${centroid.lat}&start=${dateKey}&end=${dateKey}&format=JSON`;

        const resp = await fetch(url);
        statesProcessed++;

        if (!resp.ok) {
          console.error(`[hunt-nasa-power] NASA API error for ${abbr}: ${resp.status}`);
          if (i < states.length - 1) await new Promise(r => setTimeout(r, DELAY_MS));
          continue;
        }

        const data = await resp.json();
        const params = data?.properties?.parameter;
        if (!params) {
          console.error(`[hunt-nasa-power] No parameter data for ${abbr}`);
          if (i < states.length - 1) await new Promise(r => setTimeout(r, DELAY_MS));
          continue;
        }

        const solarRaw = val(params.ALLSKY_SFC_SW_DWN?.[dateKey]);
        const cloudRaw = val(params.CLOUD_AMT?.[dateKey]);
        const windRaw = val(params.WS10M?.[dateKey]);
        const pressureRaw = val(params.PS?.[dateKey]);
        const precipRaw = val(params.PRECTOTCORR?.[dateKey]);
        const tempAvgRaw = val(params.T2M?.[dateKey]);
        const tempMaxRaw = val(params.T2M_MAX?.[dateKey]);
        const tempMinRaw = val(params.T2M_MIN?.[dateKey]);

        const nasaObj: NasaData = {
          solar_radiation_kwh_m2: solarRaw,
          cloud_cover_pct: cloudRaw,
          wind_speed_ms: windRaw,
          surface_pressure_kpa: pressureRaw,
          precipitation_mm: precipRaw,
          temp_avg_c: tempAvgRaw,
          temp_max_c: tempMaxRaw,
          temp_min_c: tempMinRaw,
          temp_avg_f: tempAvgRaw !== null ? Math.round(celsiusToFahrenheit(tempAvgRaw) * 10) / 10 : null,
          temp_max_f: tempMaxRaw !== null ? Math.round(celsiusToFahrenheit(tempMaxRaw) * 10) / 10 : null,
          temp_min_f: tempMinRaw !== null ? Math.round(celsiusToFahrenheit(tempMinRaw) * 10) / 10 : null,
        };

        // Update hunt_weather_history
        const { error: updateErr } = await supabase
          .from('hunt_weather_history')
          .update({ nasa_data: nasaObj })
          .eq('state_abbr', abbr)
          .eq('date', dateStr);

        if (updateErr) {
          console.error(`[hunt-nasa-power] DB update error for ${abbr}: ${updateErr.message}`);
        } else {
          statesUpdated++;
        }

        // Build embed text
        const solarStr = solarRaw !== null ? solarRaw.toFixed(2) : 'N/A';
        const cloudStr = cloudRaw !== null ? cloudRaw.toFixed(1) : 'N/A';
        const pressureStr = pressureRaw !== null ? pressureRaw.toFixed(2) : 'N/A';
        const embedText = `nasa | ${abbr} | ${dateStr} | solar:${solarStr}kWh/m2 cloud:${cloudStr}% pressure:${pressureStr}kPa | satellite-derived weather data`;
        embedTexts.push(embedText);
        embedMeta.push({
          title: `NASA POWER ${abbr} ${dateStr}`,
          content: embedText,
          content_type: 'nasa-daily',
          tags: ['nasa', 'satellite', 'weather', abbr.toLowerCase()],
          state_abbr: abbr,
          metadata: { date: dateStr, source: 'nasa-power', ...nasaObj },
        });

      } catch (stateErr) {
        console.error(`[hunt-nasa-power] Error processing ${abbr}:`, stateErr);
      }

      // Rate limit delay
      if (i < states.length - 1) {
        await new Promise(r => setTimeout(r, DELAY_MS));
      }
    }

    // Embed into hunt_knowledge
    let embeddingsCreated = 0;
    if (embedTexts.length > 0) {
      try {
        console.log(`[hunt-nasa-power] Embedding ${embedTexts.length} entries`);
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
              console.error(`[hunt-nasa-power] Knowledge insert error (batch ${Math.floor(i / KNOWLEDGE_BATCH)}):`, knErr);
            } else {
              embeddingsCreated += batchRows.length;
            }
          }
        } else {
          console.error(`[hunt-nasa-power] Embedding count mismatch: expected ${embedTexts.length}, got ${embeddings?.length ?? 0}`);
        }
      } catch (embedErr) {
        console.error('[hunt-nasa-power] Embedding error:', embedErr);
      }
    }

    const result = {
      states_processed: statesProcessed,
      states_updated: statesUpdated,
      embeddings_created: embeddingsCreated,
      batch: batch,
      target_date: dateStr,
      runtime_ms: Date.now() - startTime,
    };

    console.log(`[hunt-nasa-power] Done.`, JSON.stringify(result));
    return successResponse(req, result);

  } catch (err) {
    console.error('[hunt-nasa-power] Fatal error:', err);
    return errorResponse(req, err instanceof Error ? err.message : 'Internal error', 500);
  }
});
