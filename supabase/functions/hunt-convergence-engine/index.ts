import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { STATE_ABBRS, STATE_NAMES } from '../_shared/states.ts';
import { generateEmbedding, batchEmbed } from '../_shared/embedding.ts';
import { logCronRun } from '../_shared/cronLog.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScoreResult {
  state_abbr: string;
  weather: number;
  solunar: number;
  migration: number;
  pattern: number;
  birdcast: number;
  water: number;
  photoperiod: number;
  tide: number;
  score: number;
  reasoning: string;
  signals: Record<string, unknown>;
  weatherDetails: string;
  moonPhase: string;
  migrationDetails: string;
  patternSummary: string;
  birdcastDetails: string;
}

// Coastal states that have tide data
const COASTAL_STATES = new Set([
  'ME','NH','MA','RI','CT','NY','NJ','DE','MD','VA','NC','SC','GA','FL',
  'AL','MS','LA','TX','CA','OR','WA','AK',
]);

// Batch-fetched data caches (populated once, used per-state)
interface BatchData {
  water: Map<string, { trend: string }>;
  photoperiod: Map<string, { below_13h: boolean; below_11h: boolean }>;
  tide: Map<string, { avg_tidal_range_ft: number }>;
}

// ---------------------------------------------------------------------------
// Component Scorers
// ---------------------------------------------------------------------------

async function scoreWeather(
  supabase: ReturnType<typeof createSupabaseClient>,
  stateAbbr: string,
  today: string,
  endDate: string,
): Promise<{ score: number; details: string; signals: Record<string, unknown> }> {
  // Query weather events for this state, today through +3 days
  const { data: events } = await supabase
    .from('hunt_weather_events')
    .select('event_type, severity, details')
    .eq('state_abbr', stateAbbr)
    .gte('event_date', today)
    .lte('event_date', endDate);

  // Query active NWS alerts for this state
  const { data: alerts } = await supabase
    .from('hunt_nws_alerts')
    .select('event_type, severity, headline')
    .contains('states', [stateAbbr])
    .gte('expires', new Date().toISOString());

  let score = 0;
  const parts: string[] = [];
  const signalData: Record<string, unknown> = {};

  if (events && events.length > 0) {
    const types = new Set(events.map((e: { event_type: string }) => e.event_type));
    if (types.has('cold_front')) { score += 15; parts.push('cold front'); }
    if (types.has('pressure_drop')) { score += 10; parts.push('pressure drop'); }
    if (types.has('high_wind')) { score += 5; parts.push('high wind'); }
    if (types.has('first_freeze')) { score += 10; parts.push('first freeze'); }
    if (types.has('heavy_precip')) { score -= 5; parts.push('heavy precip (-)'); }
    signalData.weather_events = events.length;
    signalData.event_types = [...types];
  }

  if (alerts && alerts.length > 0) {
    const alertTypes = new Set(alerts.map((a: { event_type: string }) => a.event_type.toLowerCase()));
    for (const et of alertTypes) {
      if (et.includes('winter storm')) { score += 10; parts.push('NWS winter storm'); }
      else if (et.includes('wind')) { score += 5; parts.push('NWS wind advisory'); }
      else if (et.includes('freeze')) { score += 8; parts.push('NWS freeze warning'); }
    }
    signalData.nws_alerts = alerts.length;
  }

  // No events = stable weather penalty
  if ((!events || events.length === 0) && (!alerts || alerts.length === 0)) {
    score -= 10;
    parts.push('stable (no events)');
  }

  score = Math.min(25, Math.max(0, score));
  return { score, details: parts.join(', ') || 'none', signals: signalData };
}

async function scoreSolunar(
  supabase: ReturnType<typeof createSupabaseClient>,
  today: string,
  endDate: string,
): Promise<{ score: number; moonPhase: string; signals: Record<string, unknown> }> {
  const { data: solunar } = await supabase
    .from('hunt_solunar_calendar')
    .select('date, moon_phase, illumination_pct, is_prime')
    .gte('date', today)
    .lte('date', endDate)
    .order('date');

  let score = 0;
  let moonPhase = 'unknown';
  const signalData: Record<string, unknown> = {};

  if (solunar && solunar.length > 0) {
    // Use today's entry as primary
    const todayEntry = solunar[0];
    moonPhase = todayEntry.moon_phase || 'unknown';
    const illum = todayEntry.illumination_pct ?? 50;
    signalData.illumination_pct = illum;
    signalData.moon_phase = moonPhase;

    // New moon bonus
    if (illum < 5) { score += 10; }
    else if (illum < 15) { score += 5; }

    // Full moon penalty
    if (illum > 95) { score -= 5; }

    // Check if any day in window is prime
    const hasPrime = solunar.some((s: { is_prime: boolean }) => s.is_prime);
    if (hasPrime) { score += 15; signalData.is_prime = true; }
  }

  score = Math.min(15, Math.max(0, score));
  return { score, moonPhase, signals: signalData };
}

async function scoreMigration(
  supabase: ReturnType<typeof createSupabaseClient>,
  stateAbbr: string,
  today: string,
): Promise<{ score: number; details: string; signals: Record<string, unknown> }> {
  // Query migration spikes for this state, last 7 days
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];

  const { data: spikes } = await supabase
    .from('hunt_migration_spikes')
    .select('deviation_pct, sighting_count, baseline_avg, date')
    .eq('state_abbr', stateAbbr)
    .gte('date', sevenDaysAgoStr)
    .order('deviation_pct', { ascending: false });

  // Query recent migration history for trend
  const threeDaysAgo = new Date(today);
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  const threeDaysAgoStr = threeDaysAgo.toISOString().split('T')[0];

  const { data: history } = await supabase
    .from('hunt_migration_history')
    .select('sighting_count, date')
    .eq('state_abbr', stateAbbr)
    .gte('date', threeDaysAgoStr)
    .order('date', { ascending: false })
    .limit(10);

  let score = 0;
  let details = 'no recent data';
  const signalData: Record<string, unknown> = {};

  if (spikes && spikes.length > 0) {
    const topSpike = spikes[0];
    const dev = topSpike.deviation_pct;
    signalData.top_deviation_pct = dev;
    signalData.spike_count = spikes.length;

    if (dev > 100) {
      score = 30;
      details = `spike ${Math.round(dev)}% above baseline`;
    } else if (dev > 50) {
      score = 20;
      details = `elevated ${Math.round(dev)}% above baseline`;
    } else if (dev > 25) {
      score = 10;
      details = `above baseline ${Math.round(dev)}%`;
    } else {
      details = 'at baseline';
    }
  } else if (history && history.length > 0) {
    signalData.recent_sightings = history.length;
    details = `${history.length} recent observations, no spikes`;
  }

  score = Math.min(25, Math.max(0, score));
  return { score, details, signals: signalData };
}

async function scorePattern(
  supabase: ReturnType<typeof createSupabaseClient>,
  stateAbbr: string,
  stateName: string,
  weatherDetails: string,
  moonPhase: string,
  migrationDetails: string,
): Promise<{ score: number; summary: string; signals: Record<string, unknown> }> {
  const searchText = `${stateName} environmental conditions: ${weatherDetails}, ${moonPhase}, ${migrationDetails}`;

  let score = 0;
  let summary = 'no historical match';
  const signalData: Record<string, unknown> = {};

  try {
    const embedding = await generateEmbedding(searchText, 'query');

    const { data: matches } = await supabase.rpc('search_hunt_knowledge_v3', {
      query_embedding: embedding,
      match_threshold: 0.3,
      match_count: 5,
      filter_content_types: null,
      filter_state_abbr: stateAbbr,
      filter_species: null,
      filter_date_from: null,
      filter_date_to: null,
      recency_weight: 0.1,
      exclude_du_report: true,
    });

    if (matches && matches.length > 0) {
      const bestSim = matches[0].similarity;
      signalData.best_similarity = bestSim;
      signalData.match_count = matches.length;

      if (bestSim > 0.5) {
        score = 20;
        summary = matches[0].content?.substring(0, 200) || 'strong pattern match';
      } else {
        score = 10;
        summary = matches[0].content?.substring(0, 200) || 'moderate pattern match';
      }
    }
  } catch (err) {
    console.error(`[hunt-convergence-engine] Pattern search error for ${stateAbbr}:`, err);
  }

  score = Math.min(15, Math.max(0, score));
  return { score, summary, signals: signalData };
}

async function getBirdCastScore(
  supabase: ReturnType<typeof createSupabaseClient>,
  stateAbbr: string,
  date: string,
): Promise<{ score: number; detail: string }> {
  const threeDaysAgo = new Date(new Date(date).getTime() - 3 * 86400000).toISOString().split('T')[0];

  const { data } = await supabase
    .from('hunt_birdcast')
    .select('cumulative_birds, is_high, avg_direction, avg_speed')
    .eq('state_abbr', stateAbbr)
    .gte('date', threeDaysAgo)
    .lte('date', date)
    .order('date', { ascending: false });

  if (!data || data.length === 0) return { score: 0, detail: 'No BirdCast data' };

  let score = 0;
  const latest = data[0];
  const details: string[] = [];

  // High intensity flag
  if (latest.is_high) { score += 10; details.push('high intensity'); }

  // Volume-based scoring
  const birds = latest.cumulative_birds || 0;
  if (birds > 1000000) { score += 5; details.push(`${(birds / 1e6).toFixed(1)}M birds`); }
  else if (birds > 500000) { score += 3; details.push(`${(birds / 1e3).toFixed(0)}K birds`); }
  else if (birds > 100000) { score += 1; details.push(`${(birds / 1e3).toFixed(0)}K birds`); }

  // Multi-day activity bonus
  const activeDays = data.filter((d: { cumulative_birds: number | null }) => (d.cumulative_birds || 0) > 50000).length;
  if (activeDays >= 3) { score += 5; details.push('3-day streak'); }
  else if (activeDays >= 2) { score += 3; details.push('2-day activity'); }

  return { score: Math.min(score, 20), detail: details.join(', ') || 'Low activity' };
}

// ---------------------------------------------------------------------------
// Batch fetch new data sources (3 queries total for all states)
// ---------------------------------------------------------------------------

async function fetchBatchData(
  supabase: ReturnType<typeof createSupabaseClient>,
): Promise<BatchData> {
  const [waterRes, photoRes, tideRes] = await Promise.all([
    supabase
      .from('hunt_knowledge')
      .select('state_abbr, metadata')
      .eq('content_type', 'usgs-water')
      .order('effective_date', { ascending: false })
      .limit(500),
    supabase
      .from('hunt_knowledge')
      .select('state_abbr, metadata')
      .eq('content_type', 'photoperiod')
      .order('effective_date', { ascending: false })
      .limit(500),
    supabase
      .from('hunt_knowledge')
      .select('state_abbr, metadata')
      .eq('content_type', 'noaa-tide')
      .order('effective_date', { ascending: false })
      .limit(500),
  ]);

  // Build per-state maps (first match = most recent due to ordering)
  const water = new Map<string, { trend: string }>();
  if (waterRes.data) {
    for (const row of waterRes.data) {
      if (!water.has(row.state_abbr) && row.metadata?.trend) {
        water.set(row.state_abbr, { trend: row.metadata.trend });
      }
    }
  }

  const photoperiod = new Map<string, { below_13h: boolean; below_11h: boolean }>();
  if (photoRes.data) {
    for (const row of photoRes.data) {
      if (!photoperiod.has(row.state_abbr) && row.metadata) {
        photoperiod.set(row.state_abbr, {
          below_13h: !!row.metadata.below_13h,
          below_11h: !!row.metadata.below_11h,
        });
      }
    }
  }

  const tide = new Map<string, { avg_tidal_range_ft: number }>();
  if (tideRes.data) {
    for (const row of tideRes.data) {
      if (!tide.has(row.state_abbr) && row.metadata?.avg_tidal_range_ft != null) {
        tide.set(row.state_abbr, { avg_tidal_range_ft: row.metadata.avg_tidal_range_ft });
      }
    }
  }

  return { water, photoperiod, tide };
}

// ---------------------------------------------------------------------------
// New component scorers (use batch data, no per-state queries)
// ---------------------------------------------------------------------------

function scoreWater(batchData: BatchData, stateAbbr: string): number {
  const entry = batchData.water.get(stateAbbr);
  if (!entry) return 5; // no data = neutral
  if (entry.trend === 'rising') return 15;
  if (entry.trend === 'stable') return 8;
  if (entry.trend === 'falling') return 3;
  return 5;
}

function scorePhotoperiod(batchData: BatchData, stateAbbr: string): number {
  const entry = batchData.photoperiod.get(stateAbbr);
  if (!entry) return 2;
  if (entry.below_13h && !entry.below_11h) return 10; // fall migration trigger
  if (entry.below_11h) return 5; // deep winter
  return 2; // spring/summer
}

function scoreTide(batchData: BatchData, stateAbbr: string): number {
  if (!COASTAL_STATES.has(stateAbbr)) return 0; // non-coastal, don't penalize
  const entry = batchData.tide.get(stateAbbr);
  if (!entry) return 4; // coastal but no data
  if (entry.avg_tidal_range_ft > 6) return 10;
  if (entry.avg_tidal_range_ft >= 3) return 7;
  return 4;
}

// ---------------------------------------------------------------------------
// Score a single state
// ---------------------------------------------------------------------------

async function scoreState(
  supabase: ReturnType<typeof createSupabaseClient>,
  stateAbbr: string,
  today: string,
  endDate: string,
  batchData: BatchData,
): Promise<ScoreResult> {
  const stateName = STATE_NAMES[stateAbbr] || stateAbbr;

  // Run weather, solunar, migration, birdcast in parallel (pattern depends on their results)
  const [weatherResult, solunarResult, migrationResult, birdcastResult] = await Promise.all([
    scoreWeather(supabase, stateAbbr, today, endDate),
    scoreSolunar(supabase, today, endDate),
    scoreMigration(supabase, stateAbbr, today),
    getBirdCastScore(supabase, stateAbbr, today),
  ]);

  // Pattern depends on the other components' details
  const patternResult = await scorePattern(
    supabase,
    stateAbbr,
    stateName,
    weatherResult.details,
    solunarResult.moonPhase,
    migrationResult.details,
  );

  // New components from batch data (no async, already fetched)
  const waterScore = scoreWater(batchData, stateAbbr);
  const photoperiodScore = scorePhotoperiod(batchData, stateAbbr);
  const tideScore = scoreTide(batchData, stateAbbr);

  // Old 5 components max ~100, new 3 max ~35. Normalize to 0-100.
  const rawSum = weatherResult.score + solunarResult.score + migrationResult.score
    + patternResult.score + birdcastResult.score
    + waterScore + photoperiodScore + tideScore;
  const total = Math.min(100, Math.max(0, Math.round(rawSum * 100 / 135)));

  // Build reasoning
  const parts: string[] = [];
  if (weatherResult.score > 10) parts.push(`Weather active: ${weatherResult.details}`);
  if (solunarResult.score > 10) parts.push(`Moon favorable: ${solunarResult.moonPhase}`);
  if (migrationResult.score > 10) parts.push(`Migration elevated: ${migrationResult.details}`);
  if (birdcastResult.score > 5) parts.push(`BirdCast: ${birdcastResult.detail}`);
  if (patternResult.score > 5) parts.push(`Historical match: ${patternResult.summary}`);
  if (waterScore >= 10) parts.push(`Water rising`);
  if (photoperiodScore >= 8) parts.push(`Daylight in migration trigger zone`);
  if (tideScore >= 7) parts.push(`Strong tidal range`);
  const reasoning = `Score ${total}/100. ${parts.join('. ')}.`;

  return {
    state_abbr: stateAbbr,
    weather: weatherResult.score,
    solunar: solunarResult.score,
    migration: migrationResult.score,
    pattern: patternResult.score,
    birdcast: birdcastResult.score,
    water: waterScore,
    photoperiod: photoperiodScore,
    tide: tideScore,
    score: total,
    reasoning,
    signals: {
      weather: weatherResult.signals,
      solunar: solunarResult.signals,
      migration: migrationResult.signals,
      pattern: patternResult.signals,
      birdcast: { detail: birdcastResult.detail },
      water: batchData.water.get(stateAbbr) || null,
      photoperiod: batchData.photoperiod.get(stateAbbr) || null,
      tide: batchData.tide.get(stateAbbr) || null,
    },
    weatherDetails: weatherResult.details,
    moonPhase: solunarResult.moonPhase,
    migrationDetails: migrationResult.details,
    patternSummary: patternResult.summary,
    birdcastDetails: birdcastResult.detail,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const trigger = body.trigger || 'daily';
    const requestedStates: string[] | undefined = body.states;

    const statesToScore = requestedStates && requestedStates.length > 0
      ? requestedStates.filter((s: string) => STATE_ABBRS.includes(s))
      : STATE_ABBRS;

    console.log(`[hunt-convergence-engine] Starting. trigger=${trigger}, states=${statesToScore.length}`);

    const supabase = createSupabaseClient();
    const today = new Date().toISOString().split('T')[0];
    const endDateObj = new Date();
    endDateObj.setDate(endDateObj.getDate() + 3);
    const endDate = endDateObj.toISOString().split('T')[0];

    // -----------------------------------------------------------------------
    // 0. Batch-fetch new data sources (water, photoperiod, tide) — 3 queries
    // -----------------------------------------------------------------------
    console.log(`[hunt-convergence-engine] Batch-fetching water/photoperiod/tide data`);
    const batchData = await fetchBatchData(supabase);
    console.log(`[hunt-convergence-engine] Batch data: water=${batchData.water.size} states, photoperiod=${batchData.photoperiod.size} states, tide=${batchData.tide.size} states`);

    // -----------------------------------------------------------------------
    // 1. Score states in parallel batches of 10
    // -----------------------------------------------------------------------
    const allResults: ScoreResult[] = [];
    const BATCH_SIZE = 10;

    for (let i = 0; i < statesToScore.length; i += BATCH_SIZE) {
      const batch = statesToScore.slice(i, i + BATCH_SIZE);
      console.log(`[hunt-convergence-engine] Scoring batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.join(',')}`);
      const batchResults = await Promise.all(
        batch.map(abbr => scoreState(supabase, abbr, today, endDate, batchData))
      );
      allResults.push(...batchResults);
    }

    // -----------------------------------------------------------------------
    // 2. Compute national rankings
    // -----------------------------------------------------------------------
    allResults.sort((a, b) => b.score - a.score);
    for (let i = 0; i < allResults.length; i++) {
      // Only assign ranks when scoring all 50
      if (statesToScore.length === 50) {
        (allResults[i] as ScoreResult & { national_rank: number }).national_rank = i + 1;
      }
    }

    // -----------------------------------------------------------------------
    // 3. Fetch previous scores for history tracking
    // -----------------------------------------------------------------------
    const { data: prevScores } = await supabase
      .from('hunt_convergence_scores')
      .select('state_abbr, score')
      .eq('date', today)
      .in('state_abbr', statesToScore);

    const prevMap = new Map<string, number>();
    if (prevScores) {
      for (const p of prevScores) {
        prevMap.set(p.state_abbr, p.score);
      }
    }

    // -----------------------------------------------------------------------
    // 4. Upsert convergence scores
    // -----------------------------------------------------------------------
    const upsertRows = allResults.map(r => ({
      state_abbr: r.state_abbr,
      date: today,
      score: r.score,
      weather_component: r.weather,
      solunar_component: r.solunar,
      migration_component: r.migration,
      pattern_component: r.pattern,
      birdcast_component: r.birdcast,
      water_component: r.water,
      photoperiod_component: r.photoperiod,
      tide_component: r.tide,
      reasoning: r.reasoning,
      signals: r.signals,
      national_rank: (r as ScoreResult & { national_rank?: number }).national_rank ?? null,
    }));

    console.log(`[hunt-convergence-engine] Upserting ${upsertRows.length} convergence scores`);
    const { error: upsertErr } = await supabase
      .from('hunt_convergence_scores')
      .upsert(upsertRows, { onConflict: 'state_abbr,date' });

    if (upsertErr) {
      console.error('[hunt-convergence-engine] Upsert error:', upsertErr);
    }

    // -----------------------------------------------------------------------
    // 5. Insert score history
    // -----------------------------------------------------------------------
    const historyRows = allResults.map(r => ({
      state_abbr: r.state_abbr,
      score: r.score,
      trigger,
      previous_score: prevMap.get(r.state_abbr) ?? null,
    }));

    console.log(`[hunt-convergence-engine] Inserting ${historyRows.length} history rows`);
    const { error: histErr } = await supabase
      .from('hunt_score_history')
      .insert(historyRows);

    if (histErr) {
      console.error('[hunt-convergence-engine] History insert error:', histErr);
    }

    // -----------------------------------------------------------------------
    // 6. Embed top 10 states into hunt_knowledge
    // -----------------------------------------------------------------------
    const top10 = allResults.slice(0, 10);
    if (top10.length > 0) {
      console.log(`[hunt-convergence-engine] Embedding top ${top10.length} states`);
      const embedTexts = top10.map(r =>
        `convergence | ${r.state_abbr} | ${today} | score:${r.score}/100 | birdcast:${r.birdcastDetails} | ${r.reasoning}`
      );

      try {
        const embeddings = await batchEmbed(embedTexts, 'document');

        if (embeddings && embeddings.length === embedTexts.length) {
          const knowledgeRows = top10.map((r, idx) => ({
            title: `${r.state_abbr} convergence ${today}`,
            content: embedTexts[idx],
            content_type: 'convergence-score',
            tags: [r.state_abbr, 'convergence', today],
            state_abbr: r.state_abbr,
            species: null,
            effective_date: today,
            metadata: { score: r.score, trigger, date: today },
            embedding: embeddings[idx],
          }));

          const { error: knErr } = await supabase
            .from('hunt_knowledge')
            .insert(knowledgeRows);

          if (knErr) {
            console.error('[hunt-convergence-engine] Knowledge insert error:', knErr);
          }
        }
      } catch (embedErr) {
        console.error('[hunt-convergence-engine] Embedding error:', embedErr);
      }
    }

    // -----------------------------------------------------------------------
    // 7. Return summary
    // -----------------------------------------------------------------------
    const top5 = allResults.slice(0, 5).map(r => ({
      state: r.state_abbr,
      score: r.score,
      reasoning: r.reasoning,
    }));

    const summary = {
      states_scored: allResults.length,
      top_5: top5,
      trigger,
      run_at: new Date().toISOString(),
    };

    console.log('[hunt-convergence-engine] Complete:', JSON.stringify(summary));
    await logCronRun({
      functionName: 'hunt-convergence-engine',
      status: 'success',
      summary,
      durationMs: Date.now() - startTime,
    });
    return successResponse(req, summary);
  } catch (error) {
    console.error('[hunt-convergence-engine] Fatal error:', error);
    await logCronRun({
      functionName: 'hunt-convergence-engine',
      status: 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
    });
    return errorResponse(req, 'Internal server error', 500);
  }
});
