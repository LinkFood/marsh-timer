import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getYesterday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const yesterday = getYesterday();
    console.log(`[hunt-forecast-tracker] Scoring forecast accuracy for ${yesterday}`);

    const supabase = createSupabaseClient();

    // -------------------------------------------------------------------
    // 1. Get yesterday's forecast embeddings from hunt_knowledge
    //    content_type = 'weather-forecast', metadata->>'date' = yesterday
    // -------------------------------------------------------------------
    const { data: forecastRows, error: fcErr } = await supabase
      .from('hunt_knowledge')
      .select('state_abbr, metadata')
      .eq('content_type', 'weather-forecast')
      .eq('metadata->>date', yesterday);

    if (fcErr) {
      console.error('[hunt-forecast-tracker] Forecast query error:', fcErr);
      return errorResponse(req, 'Forecast query failed', 500);
    }

    if (!forecastRows || forecastRows.length === 0) {
      console.log(`[hunt-forecast-tracker] No forecast entries found for ${yesterday}`);
      return successResponse(req, { message: `No forecasts found for ${yesterday}`, scored: 0 });
    }

    console.log(`[hunt-forecast-tracker] Found ${forecastRows.length} forecast entries`);

    // Build lookup: state_abbr -> forecast metadata
    // If multiple forecasts exist for same state (made on different days), use most recent
    const forecastByState: Record<string, { high_f: number; wind_mph: number; precip_mm: number }> = {};
    for (const row of forecastRows) {
      const meta = row.metadata;
      if (!meta || meta.high_f == null) continue;
      forecastByState[row.state_abbr] = {
        high_f: meta.high_f,
        wind_mph: meta.wind_mph ?? 0,
        precip_mm: meta.precip_mm ?? 0,
      };
    }

    const forecastStates = Object.keys(forecastByState);
    if (forecastStates.length === 0) {
      console.log('[hunt-forecast-tracker] No forecast entries with structured metadata');
      return successResponse(req, { message: 'No structured forecasts found', scored: 0 });
    }

    // -------------------------------------------------------------------
    // 2. Get yesterday's actual weather from hunt_weather_history
    // -------------------------------------------------------------------
    const { data: actualRows, error: actErr } = await supabase
      .from('hunt_weather_history')
      .select('state_abbr, temp_high_f, wind_speed_max_mph, precipitation_total_mm')
      .eq('date', yesterday)
      .in('state_abbr', forecastStates);

    if (actErr) {
      console.error('[hunt-forecast-tracker] Actual weather query error:', actErr);
      return errorResponse(req, 'Actual weather query failed', 500);
    }

    if (!actualRows || actualRows.length === 0) {
      console.log(`[hunt-forecast-tracker] No actual weather data for ${yesterday}`);
      return successResponse(req, { message: `No actual weather for ${yesterday}`, scored: 0 });
    }

    console.log(`[hunt-forecast-tracker] Found ${actualRows.length} actual weather entries`);

    // -------------------------------------------------------------------
    // 3. Compare forecast vs actual for each state
    // -------------------------------------------------------------------
    const comparisons: {
      stateAbbr: string;
      forecastHigh: number;
      actualHigh: number;
      tempError: number;
      forecastWind: number;
      actualWind: number;
      windError: number;
      forecastPrecip: number;
      actualPrecip: number;
      precipError: number;
      score: number;
    }[] = [];

    for (const actual of actualRows) {
      const forecast = forecastByState[actual.state_abbr];
      if (!forecast) continue;

      const actualHigh = actual.temp_high_f ?? 0;
      const actualWind = actual.wind_speed_max_mph ?? 0;
      const actualPrecip = actual.precipitation_total_mm ?? 0;

      const tempError = Math.abs(forecast.high_f - actualHigh);
      const windError = Math.abs(forecast.wind_mph - actualWind);
      const precipError = Math.abs(forecast.precip_mm - actualPrecip);

      // Score: 100 - (temp_error*2 + wind_error + precip_error*3), clamped 0-100
      const score = clamp(Math.round(100 - (tempError * 2 + windError + precipError * 3)), 0, 100);

      comparisons.push({
        stateAbbr: actual.state_abbr,
        forecastHigh: forecast.high_f,
        actualHigh,
        tempError: Math.round(tempError * 10) / 10,
        forecastWind: forecast.wind_mph,
        actualWind,
        windError: Math.round(windError * 10) / 10,
        forecastPrecip: forecast.precip_mm,
        actualPrecip,
        precipError: Math.round(precipError * 10) / 10,
        score,
      });
    }

    if (comparisons.length === 0) {
      console.log('[hunt-forecast-tracker] No overlapping forecast/actual pairs');
      return successResponse(req, { message: 'No overlapping data', scored: 0 });
    }

    // -------------------------------------------------------------------
    // 4. Build embed texts and metadata
    // -------------------------------------------------------------------
    const embedTexts: string[] = [];
    const embedMeta: {
      title: string;
      content: string;
      content_type: string;
      tags: string[];
      state_abbr: string;
      effective_date: string;
      metadata: Record<string, unknown>;
    }[] = [];

    for (const c of comparisons) {
      const embedText = `forecast-accuracy | ${c.stateAbbr} | ${yesterday} | predicted:${c.forecastHigh}F/${c.forecastWind}mph/${c.forecastPrecip}mm actual:${c.actualHigh}F/${c.actualWind}mph/${c.actualPrecip}mm | temp_error:${c.tempError}F wind_error:${c.windError}mph precip_error:${c.precipError}mm | accuracy:${c.score}/100`;

      embedTexts.push(embedText);
      embedMeta.push({
        title: `Forecast accuracy ${c.stateAbbr} ${yesterday}`,
        content: embedText,
        content_type: 'forecast-accuracy',
        tags: [c.stateAbbr, 'forecast', 'accuracy', 'self-score'],
        state_abbr: c.stateAbbr,
        effective_date: yesterday,
        metadata: {
          source: 'self-score',
          date: yesterday,
          forecast_high: c.forecastHigh,
          actual_high: c.actualHigh,
          temp_error_f: c.tempError,
          forecast_wind: c.forecastWind,
          actual_wind: c.actualWind,
          wind_error_mph: c.windError,
          forecast_precip: c.forecastPrecip,
          actual_precip: c.actualPrecip,
          precip_error_mm: c.precipError,
          accuracy_score: c.score,
        },
      });
    }

    // -------------------------------------------------------------------
    // 5. Embed and insert into hunt_knowledge
    // -------------------------------------------------------------------
    console.log(`[hunt-forecast-tracker] Embedding ${embedTexts.length} accuracy entries`);
    let embeddingsCreated = 0;

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
              species: null,
              effective_date: meta.effective_date,
              metadata: meta.metadata,
              embedding: embeddings[j],
            });
          }
          const { error: knErr } = await supabase
            .from('hunt_knowledge')
            .insert(batchRows);
          if (knErr) {
            console.error(`[hunt-forecast-tracker] Knowledge insert error (batch ${i / KNOWLEDGE_BATCH}):`, knErr);
          } else {
            embeddingsCreated += batchRows.length;
          }
        }
      } else {
        console.error(`[hunt-forecast-tracker] Embedding count mismatch: expected ${embedTexts.length}, got ${embeddings?.length ?? 0}`);
      }
    } catch (embedErr) {
      console.error('[hunt-forecast-tracker] Embedding error:', embedErr);
    }

    // -------------------------------------------------------------------
    // 6. Log summary
    // -------------------------------------------------------------------
    const avgScore = Math.round(comparisons.reduce((sum, c) => sum + c.score, 0) / comparisons.length);
    const worst = comparisons.reduce((w, c) => c.score < w.score ? c : w, comparisons[0]);

    const summary = {
      date: yesterday,
      states_scored: comparisons.length,
      average_accuracy: avgScore,
      worst_state: worst.stateAbbr,
      worst_score: worst.score,
      embeddings_created: embeddingsCreated,
      run_at: new Date().toISOString(),
    };

    console.log(`[hunt-forecast-tracker] Scored ${comparisons.length} states. Average accuracy: ${avgScore}/100. Worst: ${worst.stateAbbr} (${worst.score}/100).`);

    return successResponse(req, summary);
  } catch (error) {
    console.error('[hunt-forecast-tracker] Fatal error:', error);
    return errorResponse(req, 'Internal server error', 500);
  }
});
