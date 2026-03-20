import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { STATE_CENTROIDS } from '../_shared/states.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { scanBrainOnWrite } from '../_shared/brainScan.ts';
import { logCronRun } from '../_shared/cronLog.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DailyForecast {
  time: string[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation_sum: number[];
  wind_speed_10m_max: number[];
  wind_direction_10m_dominant: number[];
  pressure_msl_mean: number[];
  weather_code: number[];
  cloud_cover_mean: number[];
}

interface WeatherEvent {
  state_abbr: string;
  event_type: string;
  event_date: string;
  details: string;
  severity: 'high' | 'medium' | 'low';
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
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

function detectEvents(
  stateAbbr: string,
  daily: DailyForecast,
): WeatherEvent[] {
  const events: WeatherEvent[] = [];
  const dates = daily.time;
  const highs = daily.temperature_2m_max;
  const lows = daily.temperature_2m_min;
  const winds = daily.wind_speed_10m_max;
  const pressures = daily.pressure_msl_mean;
  const precip = daily.precipitation_sum;

  for (let i = 1; i < dates.length; i++) {
    const date = dates[i];

    // Cold front: temp drop >15F between consecutive days
    const hi = highs[i] ?? 0;
    const hiPrev = highs[i - 1] ?? 0;
    const tempDrop = hiPrev - hi;
    if (tempDrop > 15) {
      events.push({
        state_abbr: stateAbbr,
        event_type: 'cold_front',
        event_date: date,
        details: `High drops ${Math.round(tempDrop)}F: ${Math.round(hiPrev)}F -> ${Math.round(hi)}F`,
        severity: tempDrop > 25 ? 'high' : 'medium',
        metadata: { temp_drop_f: Math.round(tempDrop), prev_high: Math.round(hiPrev), new_high: Math.round(hi) },
      });
    }

    // Pressure drop: >3mb between consecutive days
    const pCur = pressures[i] ?? 0;
    const pPrev = pressures[i - 1] ?? 0;
    const pressureDrop = pPrev - pCur;
    if (pressureDrop > 3) {
      events.push({
        state_abbr: stateAbbr,
        event_type: 'pressure_drop',
        event_date: date,
        details: `Pressure drops ${pressureDrop.toFixed(1)}mb: ${pPrev.toFixed(0)}mb -> ${pCur.toFixed(0)}mb`,
        severity: pressureDrop > 6 ? 'high' : 'medium',
        metadata: { pressure_drop_mb: Math.round(pressureDrop * 10) / 10, prev_pressure: Math.round(pPrev), new_pressure: Math.round(pCur) },
      });
    }

    // High wind: >20mph any day
    const wind = winds[i] ?? 0;
    if (wind > 20) {
      events.push({
        state_abbr: stateAbbr,
        event_type: 'high_wind',
        event_date: date,
        details: `Wind gusts to ${Math.round(wind)}mph`,
        severity: wind > 35 ? 'high' : 'medium',
        metadata: { wind_mph: Math.round(wind) },
      });
    }

    // First freeze: temp_low drops below 32F when previous day was above
    const lo = lows[i] ?? 0;
    const loPrev = lows[i - 1] ?? 0;
    if (lo < 32 && loPrev >= 32) {
      events.push({
        state_abbr: stateAbbr,
        event_type: 'first_freeze',
        event_date: date,
        details: `First freeze: low ${Math.round(lo)}F (prev day ${Math.round(loPrev)}F)`,
        severity: lo < 20 ? 'high' : 'medium',
        metadata: { low_f: Math.round(lo), prev_low_f: Math.round(loPrev) },
      });
    }

    // Heavy precip: >10mm any day
    const pp = precip[i] ?? 0;
    if (pp > 10) {
      events.push({
        state_abbr: stateAbbr,
        event_type: 'heavy_precip',
        event_date: date,
        details: `Heavy precipitation: ${pp.toFixed(1)}mm`,
        severity: pp > 25 ? 'high' : 'medium',
        metadata: { precip_mm: Math.round(pp * 10) / 10 },
      });
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();
  try {
    console.log('[hunt-weather-watchdog] Starting daily weather watchdog run');

    const supabase = createSupabaseClient();
    const entries = Object.entries(STATE_CENTROIDS);

    // -----------------------------------------------------------------------
    // 1. Bulk Open-Meteo fetch — 2 batches of 25 states to avoid TLS errors
    // -----------------------------------------------------------------------
    const midpoint = Math.ceil(entries.length / 2);
    const batch1Entries = entries.slice(0, midpoint);
    const batch2Entries = entries.slice(midpoint);

    async function fetchBatch(batchEntries: typeof entries, batchLabel: string): Promise<unknown[]> {
      const batchLats = batchEntries.map(([, s]) => s.lat).join(",");
      const batchLngs = batchEntries.map(([, s]) => s.lng).join(",");
      const meteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${batchLats}&longitude=${batchLngs}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,wind_direction_10m_dominant,pressure_msl_mean,weather_code,cloud_cover_mean&temperature_unit=fahrenheit&wind_speed_unit=mph&past_days=1&forecast_days=16`;

      console.log(`[hunt-weather-watchdog] Fetching Open-Meteo ${batchLabel} (${batchEntries.length} states)`);
      let weatherRes = await fetch(meteoUrl);

      if (!weatherRes.ok) {
        const errText = await weatherRes.text();
        if (weatherRes.status >= 400 && weatherRes.status < 500) {
          throw new Error(`${batchLabel} client error (${weatherRes.status}): ${errText}`);
        }
        console.warn(`[hunt-weather-watchdog] ${batchLabel} failed (${weatherRes.status}): ${errText} — retrying in 2s`);
        await new Promise(r => setTimeout(r, 2000));
        weatherRes = await fetch(meteoUrl);
        if (!weatherRes.ok) {
          const retryErr = await weatherRes.text();
          throw new Error(`${batchLabel} failed after retry: ${weatherRes.status} ${retryErr}`);
        }
      }

      const meteoData = await weatherRes.json();
      const results: unknown[] = Array.isArray(meteoData) ? meteoData : [meteoData];
      if (results.length !== batchEntries.length) {
        throw new Error(`${batchLabel} count mismatch: expected ${batchEntries.length}, got ${results.length}`);
      }
      return results;
    }

    const forecasts1 = await fetchBatch(batch1Entries, 'batch 1/2');
    await new Promise(r => setTimeout(r, 1000));
    const forecasts2 = await fetchBatch(batch2Entries, 'batch 2/2');
    const forecasts: unknown[] = [...forecasts1, ...forecasts2];

    console.log(`[hunt-weather-watchdog] Received forecasts for ${forecasts.length} states`);

    // -----------------------------------------------------------------------
    // 2. Process each state
    // -----------------------------------------------------------------------
    const historyRows: Record<string, unknown>[] = [];
    const forecastRows: Record<string, unknown>[] = [];
    const allEvents: WeatherEvent[] = [];
    const embedTexts: string[] = [];
    const embedMeta: { title: string; content: string; content_type: string; tags: string[]; state_abbr: string; metadata: Record<string, unknown> }[] = [];

    for (let i = 0; i < entries.length; i++) {
      const [abbr] = entries[i];
      // deno-lint-ignore no-explicit-any
      const forecast = forecasts[i] as any;
      if (!forecast?.daily) {
        console.warn(`[hunt-weather-watchdog] No daily data for ${abbr}, skipping`);
        continue;
      }

      const daily: DailyForecast = forecast.daily;
      const dates = daily.time;

      // Yesterday = index 0 (past_days=1), forecast = index 1..16
      // Upsert yesterday's actual into hunt_weather_history
      const yesterdayIdx = 0;
      const yesterdayDate = dates[yesterdayIdx];
      const hiF = Math.round((daily.temperature_2m_max[yesterdayIdx] ?? 0) * 10) / 10;
      const loF = Math.round((daily.temperature_2m_min[yesterdayIdx] ?? 0) * 10) / 10;
      historyRows.push({
        state_abbr: abbr,
        date: yesterdayDate,
        temp_high_f: hiF,
        temp_low_f: loF,
        temp_avg_f: Math.round(((hiF + loF) / 2) * 10) / 10,
        wind_speed_max_mph: Math.round((daily.wind_speed_10m_max[yesterdayIdx] ?? 0) * 10) / 10,
        wind_direction_dominant: Math.round(daily.wind_direction_10m_dominant[yesterdayIdx] ?? 0),
        pressure_avg_msl: Math.round((daily.pressure_msl_mean[yesterdayIdx] ?? 0) * 10) / 10,
        precipitation_total_mm: Math.round((daily.precipitation_sum[yesterdayIdx] ?? 0) * 10) / 10,
        cloud_cover_avg: Math.round(daily.cloud_cover_mean[yesterdayIdx] ?? 0),
      });

      // All 16 forecast days (index 1..16) into hunt_weather_forecast
      for (let d = 1; d < dates.length; d++) {
        forecastRows.push({
          state_abbr: abbr,
          date: dates[d],
          temp_high_f: Math.round((daily.temperature_2m_max[d] ?? 0) * 10) / 10,
          temp_low_f: Math.round((daily.temperature_2m_min[d] ?? 0) * 10) / 10,
          precipitation_mm: Math.round((daily.precipitation_sum[d] ?? 0) * 10) / 10,
          wind_speed_max_mph: Math.round((daily.wind_speed_10m_max[d] ?? 0) * 10) / 10,
          wind_direction_dominant: Math.round(daily.wind_direction_10m_dominant[d] ?? 0),
          pressure_msl: Math.round((daily.pressure_msl_mean[d] ?? 0) * 10) / 10,
          weather_code: daily.weather_code[d] ?? 0,
          cloud_cover_pct: Math.round(daily.cloud_cover_mean[d] ?? 0),
          updated_at: new Date().toISOString(),
        });
      }

      // Detect events across the full window (including yesterday for context)
      const stateEvents = detectEvents(abbr, daily);
      allEvents.push(...stateEvents);

      // Build embedding text for yesterday's snapshot
      const windDir = degreesToCompass(daily.wind_direction_10m_dominant[yesterdayIdx] ?? 0);
      const windMph = Math.round(daily.wind_speed_10m_max[yesterdayIdx] ?? 0);
      const hi = Math.round(daily.temperature_2m_max[yesterdayIdx] ?? 0);
      const lo = Math.round(daily.temperature_2m_min[yesterdayIdx] ?? 0);
      const precipMm = (daily.precipitation_sum[yesterdayIdx] ?? 0).toFixed(1);
      const pressureMb = Math.round(daily.pressure_msl_mean[yesterdayIdx] ?? 0);

      // Check if there were any events on this date for this state
      const dayEvents = stateEvents.filter(e => e.event_date === yesterdayDate);
      const eventSummary = dayEvents.length > 0
        ? dayEvents.map(e => e.event_type).join(', ')
        : 'stable';

      const embedText = `weather | ${abbr} | ${yesterdayDate} | temp:${hi}/${lo}F wind:${windDir}@${windMph}mph precip:${precipMm}mm pressure:${pressureMb}mb | ${eventSummary}`;
      embedTexts.push(embedText);
      embedMeta.push({
        title: `${abbr} weather ${yesterdayDate}`,
        content: embedText,
        content_type: 'weather-daily',
        tags: [abbr, 'weather', yesterdayDate],
        state_abbr: abbr,
        metadata: { source: 'open-meteo', date: yesterdayDate },
      });

      // Embed forecast for next 2 days (day+1 and day+2 from the daily array)
      const forecastDayOffsets = [1, 2];
      for (const dayOffset of forecastDayOffsets) {
        if (dayOffset >= dates.length) continue;
        const forecastDate = daily.time[dayOffset];
        const forecastHigh = Math.round(daily.temperature_2m_max[dayOffset] ?? 0);
        const forecastLow = Math.round(daily.temperature_2m_min[dayOffset] ?? 0);
        const forecastPrecip = (daily.precipitation_sum[dayOffset] ?? 0).toFixed(1);
        const forecastWind = Math.round(daily.wind_speed_10m_max[dayOffset] ?? 0);
        const forecastWindDir = degreesToCompass(daily.wind_direction_10m_dominant[dayOffset] ?? 0);

        const forecastText = `weather-forecast | ${abbr} | ${forecastDate} | predicted high:${forecastHigh}F low:${forecastLow}F | precip:${forecastPrecip}mm wind:${forecastWind}mph ${forecastWindDir}`;
        embedTexts.push(forecastText);
        embedMeta.push({
          title: `${abbr} forecast ${forecastDate}`,
          content: forecastText,
          content_type: 'weather-forecast',
          tags: [abbr, 'weather', 'forecast', forecastDate],
          state_abbr: abbr,
          metadata: {
            source: 'open-meteo',
            date: forecastDate,
            forecast_made_on: yesterdayDate,
            high_f: forecastHigh,
            low_f: forecastLow,
            precip_mm: Math.round((daily.precipitation_sum[dayOffset] ?? 0) * 10) / 10,
            wind_mph: forecastWind,
            wind_dir: Math.round(daily.wind_direction_10m_dominant[dayOffset] ?? 0),
            is_forecast: true,
          },
        });
      }
    }

    // Build separate embeddings for each detected event
    for (const evt of allEvents) {
      const evtText = `weather-event | ${evt.state_abbr} | ${evt.event_date} | type:${evt.event_type} | ${evt.details}`;
      embedTexts.push(evtText);
      embedMeta.push({
        title: `${evt.state_abbr} ${evt.event_type} ${evt.event_date}`,
        content: evtText,
        content_type: 'weather-event',
        tags: [evt.state_abbr, 'weather', evt.event_type, evt.event_date],
        state_abbr: evt.state_abbr,
        metadata: { source: 'open-meteo', date: evt.event_date, ...evt.metadata },
      });
    }

    // -----------------------------------------------------------------------
    // 3. Upsert history (batch by 50s)
    // -----------------------------------------------------------------------
    console.log(`[hunt-weather-watchdog] Upserting ${historyRows.length} history rows`);
    const { error: histErr } = await supabase
      .from('hunt_weather_history')
      .upsert(historyRows, { onConflict: 'state_abbr,date' });
    if (histErr) {
      console.error('[hunt-weather-watchdog] History upsert error:', histErr);
    }

    // -----------------------------------------------------------------------
    // 4. Upsert forecast (batch to avoid payload limits)
    // -----------------------------------------------------------------------
    console.log(`[hunt-weather-watchdog] Upserting ${forecastRows.length} forecast rows`);
    const FORECAST_BATCH = 200;
    for (let i = 0; i < forecastRows.length; i += FORECAST_BATCH) {
      const batch = forecastRows.slice(i, i + FORECAST_BATCH);
      const { error: fcErr } = await supabase
        .from('hunt_weather_forecast')
        .upsert(batch, { onConflict: 'state_abbr,date' });
      if (fcErr) {
        console.error(`[hunt-weather-watchdog] Forecast upsert error (batch ${i / FORECAST_BATCH}):`, fcErr);
      }
    }

    // -----------------------------------------------------------------------
    // 5. Insert detected events
    // -----------------------------------------------------------------------
    console.log(`[hunt-weather-watchdog] Inserting ${allEvents.length} weather events`);
    if (allEvents.length > 0) {
      // Delete existing events for today's date range to make re-runs idempotent
      const todayStr = new Date().toISOString().split('T')[0];
      const stateAbbrs = [...new Set(allEvents.map(e => e.state_abbr))];
      const { error: delEvtErr } = await supabase
        .from('hunt_weather_events')
        .delete()
        .eq('event_date', todayStr)
        .in('state_abbr', stateAbbrs);
      if (delEvtErr) {
        console.error('[hunt-weather-watchdog] Events delete error:', delEvtErr);
      }

      const eventRows = allEvents.map(e => ({
        state_abbr: e.state_abbr,
        event_type: e.event_type,
        event_date: e.event_date,
        severity: e.severity,
        details: { description: e.details, ...e.metadata },
      }));
      const { error: evtErr } = await supabase
        .from('hunt_weather_events')
        .insert(eventRows);
      if (evtErr) {
        console.error('[hunt-weather-watchdog] Events insert error:', evtErr);
      }
    }

    // -----------------------------------------------------------------------
    // 6. Embed into hunt_knowledge
    // -----------------------------------------------------------------------
    console.log(`[hunt-weather-watchdog] Embedding ${embedTexts.length} entries`);
    let embeddingsCreated = 0;

    try {
      // Delete existing knowledge entries for today to make re-runs idempotent
      const todayStr = new Date().toISOString().split('T')[0];
      const { error: delKnErr } = await supabase
        .from('hunt_knowledge')
        .delete()
        .in('content_type', ['weather-daily', 'weather-forecast', 'weather-event'])
        .gte('created_at', todayStr + 'T00:00:00Z')
        .lte('created_at', todayStr + 'T23:59:59Z');
      if (delKnErr) {
        console.error('[hunt-weather-watchdog] Knowledge delete error:', delKnErr);
      }

      // batchEmbed handles chunking internally (max 20 per batch)
      const embeddings = await batchEmbed(embedTexts, 'document');

      if (embeddings && embeddings.length === embedTexts.length) {
        // Query-on-write: scan brain for pattern matches on weather events
        for (let j = 0; j < embedMeta.length; j++) {
          if (embedMeta[j].content_type === 'weather-event') {
            try {
              const scan = await scanBrainOnWrite(embeddings[j], {
                state_abbr: embedMeta[j].state_abbr,
                exclude_content_type: 'weather-event',
              });
              if (scan.matches.length > 0) {
                embedMeta[j].metadata = {
                  ...embedMeta[j].metadata,
                  pattern_matches: scan.matches,
                  pattern_scan_at: new Date().toISOString(),
                };
                console.log(`[hunt-weather-watchdog] Brain scan: ${embedMeta[j].title} → ${scan.matches.length} pattern matches`);
              }
            } catch { /* scanning is best-effort */ }
          }
        }

        // Upsert into hunt_knowledge in batches
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
              species: null,
              effective_date: (meta.metadata.date as string) || null,
              metadata: meta.metadata,
              embedding: embeddings[j],
            });
          }
          const { error: knErr } = await supabase
            .from('hunt_knowledge')
            .insert(batchRows);
          if (knErr) {
            console.error(`[hunt-weather-watchdog] Knowledge upsert error (batch ${i / KNOWLEDGE_BATCH}):`, knErr);
          } else {
            embeddingsCreated += batchRows.length;
          }
        }
      } else {
        console.error(`[hunt-weather-watchdog] Embedding count mismatch: expected ${embedTexts.length}, got ${embeddings?.length ?? 0}`);
      }
    } catch (embedErr) {
      console.error('[hunt-weather-watchdog] Embedding error:', embedErr);
    }

    // -----------------------------------------------------------------------
    // 7. Done
    // -----------------------------------------------------------------------
    const summary = {
      states_processed: historyRows.length,
      forecast_rows: forecastRows.length,
      events_detected: allEvents.length,
      embeddings_created: embeddingsCreated,
      run_at: new Date().toISOString(),
    };
    console.log('[hunt-weather-watchdog] Complete:', JSON.stringify(summary));

    const endTime = Date.now();
    await logCronRun({
      functionName: 'hunt-weather-watchdog',
      status: 'success',
      summary,
      durationMs: endTime - startTime,
    });

    return successResponse(req, summary);
  } catch (error) {
    console.error('[hunt-weather-watchdog] Fatal error:', error);

    const endTime = Date.now();
    await logCronRun({
      functionName: 'hunt-weather-watchdog',
      status: 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
      durationMs: endTime - startTime,
    });

    return errorResponse(req, 'Internal server error', 500);
  }
});
