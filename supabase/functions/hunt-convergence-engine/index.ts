import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { STATE_ABBRS, STATE_NAMES } from '../_shared/states.ts';
import { generateEmbedding, batchEmbed } from '../_shared/embedding.ts';
import { logCronRun } from '../_shared/cronLog.ts';
import { getOpenArc, createArc, transitionArc } from '../_shared/arcReactor.ts';

// ---------------------------------------------------------------------------
// DOMAIN-AGNOSTIC CONVERGENCE ENGINE
//
// Scores 50 states daily across ALL environmental domains with fresh data.
// No domain gets preferential weight. The score reflects how many independent
// environmental systems are active in a state, not how good the hunting is.
// ---------------------------------------------------------------------------

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

const COASTAL_STATES = new Set([
  'ME','NH','MA','RI','CT','NY','NJ','DE','MD','VA','NC','SC','GA','FL',
  'AL','MS','LA','TX','CA','OR','WA','AK',
]);

// ---------------------------------------------------------------------------
// Batch-fetched data for ALL domains (populated once, used per-state)
// ---------------------------------------------------------------------------

interface BatchData {
  water: Map<string, { trend: string }>;
  photoperiod: Map<string, { below_13h: boolean; below_11h: boolean }>;
  tide: Map<string, { avg_tidal_range_ft: number }>;
  // New domains
  drought: Map<string, { class: string; d2_pct: number }>;
  air_quality: Map<string, { aqi: number; pm25: number }>;
  soil: Map<string, { moisture: number; temp: number }>;
  ocean: Map<string, { wave_height: number; water_temp: number }>;
  space_weather: Map<string, { kp: number; storm_level: string }>;
  river: Map<string, { discharge_class: string }>;
}

async function fetchBatchData(
  supabase: ReturnType<typeof createSupabaseClient>,
): Promise<BatchData> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const [waterRes, photoRes, tideRes, droughtRes, aqRes, soilRes, oceanRes, spaceRes, riverRes] = await Promise.all([
    supabase.from('hunt_knowledge').select('state_abbr, metadata')
      .eq('content_type', 'usgs-water').gte('created_at', sevenDaysAgo)
      .order('effective_date', { ascending: false }).limit(200),
    supabase.from('hunt_knowledge').select('state_abbr, metadata')
      .eq('content_type', 'photoperiod')
      .order('effective_date', { ascending: false }).limit(200),
    supabase.from('hunt_knowledge').select('state_abbr, metadata')
      .eq('content_type', 'noaa-tide').gte('created_at', sevenDaysAgo)
      .order('effective_date', { ascending: false }).limit(200),
    supabase.from('hunt_knowledge').select('state_abbr, metadata, content')
      .eq('content_type', 'drought-weekly').gte('created_at', sevenDaysAgo)
      .order('effective_date', { ascending: false }).limit(200),
    supabase.from('hunt_knowledge').select('state_abbr, metadata')
      .eq('content_type', 'air-quality').gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false }).limit(200),
    supabase.from('hunt_knowledge').select('state_abbr, metadata')
      .eq('content_type', 'soil-conditions').gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false }).limit(200),
    supabase.from('hunt_knowledge').select('state_abbr, metadata')
      .eq('content_type', 'ocean-buoy').gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false }).limit(200),
    supabase.from('hunt_knowledge').select('state_abbr, metadata')
      .eq('content_type', 'space-weather').gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false }).limit(100),
    supabase.from('hunt_knowledge').select('state_abbr, metadata')
      .eq('content_type', 'river-discharge').gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false }).limit(200),
  ]);

  // Build per-state maps (first match = most recent)
  const buildMap = <T>(res: { data: any[] | null }, extract: (row: any) => T | null): Map<string, T> => {
    const map = new Map<string, T>();
    if (res.data) {
      for (const row of res.data) {
        if (!map.has(row.state_abbr)) {
          const val = extract(row);
          if (val !== null) map.set(row.state_abbr, val);
        }
      }
    }
    return map;
  };

  return {
    water: buildMap(waterRes, r => r.metadata?.trend ? { trend: r.metadata.trend } : null),
    photoperiod: buildMap(photoRes, r => r.metadata ? { below_13h: !!r.metadata.below_13h, below_11h: !!r.metadata.below_11h } : null),
    tide: buildMap(tideRes, r => r.metadata?.avg_tidal_range_ft != null ? { avg_tidal_range_ft: r.metadata.avg_tidal_range_ft } : null),
    drought: buildMap(droughtRes, r => {
      const meta = r.metadata;
      const content = r.content || '';
      const d2Match = content.match(/D2:([\d.]+)%/);
      const classMatch = content.match(/class:(\S+)/);
      return {
        class: classMatch?.[1] || meta?.drought_class || 'unknown',
        d2_pct: d2Match ? parseFloat(d2Match[1]) : (meta?.d2_pct || 0),
      };
    }),
    air_quality: buildMap(aqRes, r => {
      const m = r.metadata;
      return m ? { aqi: m.aqi || m.us_aqi || 0, pm25: m.pm25 || m.pm2_5 || 0 } : null;
    }),
    soil: buildMap(soilRes, r => {
      const m = r.metadata;
      return m ? { moisture: m.soil_moisture_avg || m.moisture || 0, temp: m.soil_temp_avg || m.temp || 0 } : null;
    }),
    ocean: buildMap(oceanRes, r => {
      const m = r.metadata;
      return m ? { wave_height: m.wave_height || m.wvht || 0, water_temp: m.water_temp || m.wtmp || 0 } : null;
    }),
    space_weather: buildMap(spaceRes, r => {
      const m = r.metadata;
      return m ? { kp: m.kp_index || m.kp || 0, storm_level: m.storm_level || 'none' } : null;
    }),
    river: buildMap(riverRes, r => {
      const m = r.metadata;
      return m ? { discharge_class: m.discharge_class || m.classification || 'normal' } : null;
    }),
  };
}

// ---------------------------------------------------------------------------
// Per-State Scorers (require individual DB queries)
// ---------------------------------------------------------------------------

async function scoreWeather(
  supabase: ReturnType<typeof createSupabaseClient>,
  stateAbbr: string, today: string, endDate: string,
): Promise<{ score: number; details: string; signals: Record<string, unknown> }> {
  const { data: events } = await supabase
    .from('hunt_weather_events')
    .select('event_type, severity, details')
    .eq('state_abbr', stateAbbr)
    .gte('event_date', today).lte('event_date', endDate);

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
    if (types.has('heavy_precip')) { score += 5; parts.push('heavy precip'); }
    signalData.weather_events = events.length;
    signalData.event_types = [...types];
  }

  if (alerts && alerts.length > 0) {
    const alertTypes = new Set(alerts.map((a: { event_type: string }) => a.event_type.toLowerCase()));
    for (const et of alertTypes) {
      if (et.includes('winter storm')) { score += 10; parts.push('NWS winter storm'); }
      else if (et.includes('wind')) { score += 5; parts.push('NWS wind advisory'); }
      else if (et.includes('freeze')) { score += 8; parts.push('NWS freeze warning'); }
      else if (et.includes('flood')) { score += 8; parts.push('NWS flood warning'); }
      else if (et.includes('fire')) { score += 8; parts.push('NWS fire weather'); }
    }
    signalData.nws_alerts = alerts.length;
  }

  if ((!events || events.length === 0) && (!alerts || alerts.length === 0)) {
    score = 0; parts.push('stable');
  }

  return { score: Math.min(20, Math.max(0, score)), details: parts.join(', ') || 'none', signals: signalData };
}

async function scoreBiological(
  supabase: ReturnType<typeof createSupabaseClient>,
  stateAbbr: string, today: string,
): Promise<{ score: number; migrationDetails: string; birdcastDetails: string; migrationScore: number; birdcastScore: number; signals: Record<string, unknown> }> {
  const sevenDaysAgo = new Date(new Date(today).getTime() - 7 * 86400000).toISOString().split('T')[0];
  const threeDaysAgo = new Date(new Date(today).getTime() - 3 * 86400000).toISOString().split('T')[0];

  const [spikesRes, birdcastRes] = await Promise.all([
    supabase.from('hunt_migration_spikes')
      .select('deviation_pct, sighting_count, date')
      .eq('state_abbr', stateAbbr)
      .gte('date', sevenDaysAgo)
      .order('deviation_pct', { ascending: false }),
    supabase.from('hunt_birdcast')
      .select('cumulative_birds, is_high')
      .eq('state_abbr', stateAbbr)
      .gte('date', threeDaysAgo).lte('date', today)
      .order('date', { ascending: false }),
  ]);

  let migrationScore = 0;
  let migrationDetails = 'no data';
  let birdcastScore = 0;
  let birdcastDetails = 'no data';
  const signalData: Record<string, unknown> = {};

  // Migration spikes
  const spikes = spikesRes.data;
  if (spikes && spikes.length > 0) {
    const dev = spikes[0].deviation_pct;
    signalData.top_deviation_pct = dev;
    if (dev > 100) { migrationScore = 15; migrationDetails = `spike ${Math.round(dev)}% above baseline`; }
    else if (dev > 50) { migrationScore = 10; migrationDetails = `elevated ${Math.round(dev)}%`; }
    else if (dev > 25) { migrationScore = 5; migrationDetails = `above baseline ${Math.round(dev)}%`; }
    else { migrationDetails = 'at baseline'; }
  }

  // BirdCast
  const birdcast = birdcastRes.data;
  if (birdcast && birdcast.length > 0) {
    const latest = birdcast[0];
    if (latest.is_high) { birdcastScore += 5; birdcastDetails = 'high intensity'; }
    const birds = latest.cumulative_birds || 0;
    if (birds > 1000000) { birdcastScore += 5; birdcastDetails += ` ${(birds / 1e6).toFixed(1)}M birds`; }
    else if (birds > 100000) { birdcastScore += 2; birdcastDetails += ` ${(birds / 1e3).toFixed(0)}K birds`; }
    birdcastDetails = birdcastDetails.trim() || 'low activity';
  }

  // Combined biological score — capped at 15 (was 45 when migration+birdcast were separate)
  const combined = Math.min(15, migrationScore + birdcastScore);
  return { score: combined, migrationDetails, birdcastDetails, migrationScore, birdcastScore, signals: signalData };
}

async function scoreLunar(
  supabase: ReturnType<typeof createSupabaseClient>,
  today: string, endDate: string,
): Promise<{ score: number; moonPhase: string; signals: Record<string, unknown> }> {
  const { data: solunar } = await supabase
    .from('hunt_solunar_calendar')
    .select('date, moon_phase, illumination_pct')
    .gte('date', today).lte('date', endDate)
    .order('date');

  let score = 0;
  let moonPhase = 'unknown';
  const signalData: Record<string, unknown> = {};

  if (solunar && solunar.length > 0) {
    const todayEntry = solunar[0];
    moonPhase = todayEntry.moon_phase || 'unknown';
    const illum = todayEntry.illumination_pct ?? 50;
    signalData.illumination_pct = illum;
    signalData.moon_phase = moonPhase;
    // New/crescent moon = high tidal variation, biological activity trigger
    if (illum < 5) score = 10;
    else if (illum < 15) score = 5;
    else if (illum > 95) score = 8; // Full moon also drives tidal + nocturnal activity
    else score = 2;
  }

  return { score: Math.min(10, score), moonPhase, signals: signalData };
}

// ---------------------------------------------------------------------------
// Batch-Data Scorers (no per-state queries, use pre-fetched data)
// ---------------------------------------------------------------------------

function scoreWater(bd: BatchData, st: string): number {
  const w = bd.water.get(st);
  const r = bd.river.get(st);
  let score = 0;
  if (w) {
    if (w.trend === 'rising') score += 8;
    else if (w.trend === 'stable') score += 3;
    else if (w.trend === 'falling') score += 5; // falling water is also a signal
  }
  if (r) {
    if (r.discharge_class === 'flood' || r.discharge_class === 'flood conditions') score += 7;
    else if (r.discharge_class === 'elevated' || r.discharge_class === 'elevated flow') score += 4;
    else if (r.discharge_class === 'low flow' || r.discharge_class === 'drought conditions') score += 5;
    else score += 1;
  }
  return Math.min(15, score);
}

function scoreDrought(bd: BatchData, st: string): number {
  const d = bd.drought.get(st);
  if (!d) return 0; // no data = no score (not neutral)
  if (d.class === 'exceptional_drought' || d.d2_pct > 50) return 15;
  if (d.class === 'extreme_drought' || d.d2_pct > 25) return 12;
  if (d.class === 'severe_drought') return 10;
  if (d.class === 'moderate_drought') return 7;
  if (d.class === 'abnormally_dry') return 4;
  if (d.class === 'normal') return 1;
  return 2;
}

function scoreAirQuality(bd: BatchData, st: string): number {
  const a = bd.air_quality.get(st);
  if (!a) return 0;
  if (a.aqi > 200) return 15; // Very unhealthy — major environmental event
  if (a.aqi > 150) return 12; // Unhealthy
  if (a.aqi > 100) return 8;  // Unhealthy for sensitive
  if (a.aqi > 50) return 4;   // Moderate
  return 1; // Good
}

function scoreSoil(bd: BatchData, st: string): number {
  const s = bd.soil.get(st);
  if (!s) return 0;
  // Extremes in either direction are signals
  let score = 0;
  if (s.temp < 0 || s.temp > 35) score += 5; // Freeze or extreme heat
  if (s.moisture < 0.1 || s.moisture > 0.5) score += 5; // Very dry or saturated
  return Math.min(10, score) || 2; // Baseline of 2 if data exists
}

function scoreOcean(bd: BatchData, st: string): number {
  if (!COASTAL_STATES.has(st)) return 0;
  const o = bd.ocean.get(st);
  if (!o) return 0;
  let score = 0;
  if (o.wave_height > 3) score += 7; // High seas
  else if (o.wave_height > 1.5) score += 4;
  else score += 1;
  // Water temp anomalies (simplified — would need historical baseline for real anomaly detection)
  if (o.water_temp > 0) score += 2;
  return Math.min(10, score);
}

function scoreSpaceWeather(bd: BatchData, _st: string): number {
  // Space weather is global, not per-state. Use the first entry.
  const entries = [...bd.space_weather.values()];
  if (entries.length === 0) return 0;
  const sw = entries[0];
  if (sw.storm_level !== 'none' && sw.storm_level !== 'quiet') return 10;
  if (sw.kp >= 5) return 10; // Geomagnetic storm
  if (sw.kp >= 4) return 6;
  if (sw.kp >= 3) return 3;
  return 1;
}

function scorePhotoperiod(bd: BatchData, st: string): number {
  const p = bd.photoperiod.get(st);
  if (!p) return 2;
  if (p.below_13h && !p.below_11h) return 8; // Transitional — highest biological activity trigger
  if (p.below_11h) return 5; // Deep winter
  return 2;
}

function scoreTide(bd: BatchData, st: string): number {
  if (!COASTAL_STATES.has(st)) return 0;
  const t = bd.tide.get(st);
  if (!t) return 2;
  if (t.avg_tidal_range_ft > 6) return 8;
  if (t.avg_tidal_range_ft >= 3) return 5;
  return 2;
}

// ---------------------------------------------------------------------------
// Score a single state — ALL domains
// ---------------------------------------------------------------------------

async function scoreState(
  supabase: ReturnType<typeof createSupabaseClient>,
  stateAbbr: string, today: string, endDate: string,
  batchData: BatchData,
): Promise<ScoreResult> {
  // Per-state async queries (weather, biology, lunar)
  const [weatherResult, bioResult, lunarResult] = await Promise.all([
    scoreWeather(supabase, stateAbbr, today, endDate),
    scoreBiological(supabase, stateAbbr, today),
    scoreLunar(supabase, today, endDate),
  ]);

  // Batch-data domain scores (no async, already fetched)
  const waterScore = scoreWater(batchData, stateAbbr);
  const droughtScore = scoreDrought(batchData, stateAbbr);
  const airScore = scoreAirQuality(batchData, stateAbbr);
  const soilScore = scoreSoil(batchData, stateAbbr);
  const oceanScore = scoreOcean(batchData, stateAbbr);
  const spaceScore = scoreSpaceWeather(batchData, stateAbbr);
  const photoScore = scorePhotoperiod(batchData, stateAbbr);
  const tideScore = scoreTide(batchData, stateAbbr);

  // Total: all domains contribute equally
  // Max possible: weather(20) + bio(15) + lunar(10) + water(15) + drought(15)
  //             + air(15) + soil(10) + ocean(10) + space(10) + photo(8) + tide(8)
  //             = 136 theoretical max (coastal), ~118 non-coastal
  const rawSum = weatherResult.score + bioResult.score + lunarResult.score
    + waterScore + droughtScore + airScore + soilScore + oceanScore
    + spaceScore + photoScore + tideScore;
  const total = Math.min(100, Math.max(0, Math.round(rawSum * 100 / 120)));

  // Build reasoning
  const parts: string[] = [];
  if (weatherResult.score > 5) parts.push(`Weather: ${weatherResult.details}`);
  if (bioResult.score > 5) parts.push(`Biology: ${bioResult.migrationDetails}`);
  if (droughtScore > 5) parts.push(`Drought active`);
  if (waterScore > 5) parts.push(`Water signal`);
  if (airScore > 5) parts.push(`Air quality notable`);
  if (soilScore > 4) parts.push(`Soil conditions extreme`);
  if (oceanScore > 5) parts.push(`Ocean active`);
  if (spaceScore > 3) parts.push(`Space weather elevated`);
  if (lunarResult.score > 5) parts.push(`Lunar: ${lunarResult.moonPhase}`);
  if (photoScore > 5) parts.push(`Photoperiod transitional`);
  if (tideScore > 5) parts.push(`Strong tidal range`);
  const reasoning = `Score ${total}/100. ${parts.join('. ')}.`;

  return {
    state_abbr: stateAbbr,
    // Map back to legacy column names for backward compatibility
    weather: weatherResult.score,
    migration: bioResult.migrationScore,
    birdcast: bioResult.birdcastScore,
    solunar: lunarResult.score,
    water: waterScore,
    photoperiod: photoScore,
    tide: tideScore,
    pattern: 0, // still disabled
    score: total,
    reasoning,
    signals: {
      weather: weatherResult.signals,
      biological: bioResult.signals,
      lunar: lunarResult.signals,
      water: batchData.water.get(stateAbbr) || null,
      river: batchData.river.get(stateAbbr) || null,
      drought: batchData.drought.get(stateAbbr) || null,
      air_quality: batchData.air_quality.get(stateAbbr) || null,
      soil: batchData.soil.get(stateAbbr) || null,
      ocean: batchData.ocean.get(stateAbbr) || null,
      space_weather: batchData.space_weather.get(stateAbbr) || null,
      photoperiod: batchData.photoperiod.get(stateAbbr) || null,
      tide: batchData.tide.get(stateAbbr) || null,
      // Domain scores for the new domains (not in legacy columns)
      domain_scores: {
        weather: weatherResult.score,
        biological: bioResult.score,
        lunar: lunarResult.score,
        water: waterScore,
        drought: droughtScore,
        air_quality: airScore,
        soil: soilScore,
        ocean: oceanScore,
        space_weather: spaceScore,
        photoperiod: photoScore,
        tide: tideScore,
      },
    },
    weatherDetails: weatherResult.details,
    moonPhase: lunarResult.moonPhase,
    migrationDetails: bioResult.migrationDetails,
    patternSummary: 'skipped (performance)',
    birdcastDetails: bioResult.birdcastDetails,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

serve(async (req) => {
  try { req.headers.get('authorization'); } catch {
    return new Response(JSON.stringify({ error: 'Request closed' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }

  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();
  try {
    let body: Record<string, any> = {};
    try { body = await req.json().catch(() => ({})); } catch {
      await logCronRun({ functionName: 'hunt-convergence-engine', status: 'error', errorMessage: 'Request body unreadable', durationMs: Date.now() - startTime });
      return new Response(JSON.stringify({ error: 'Request body unreadable' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }

    const trigger = body.trigger || 'daily';
    const requestedStates: string[] | undefined = body.states;
    const batch: number | null = body.batch ?? null;

    let statesToScore: string[];
    if (requestedStates && requestedStates.length > 0) {
      statesToScore = requestedStates.filter((s: string) => STATE_ABBRS.includes(s));
    } else if (batch !== null && batch >= 1 && batch <= 5) {
      const batchSize = Math.ceil(STATE_ABBRS.length / 5);
      statesToScore = STATE_ABBRS.slice((batch - 1) * batchSize, (batch - 1) * batchSize + batchSize);
    } else {
      statesToScore = STATE_ABBRS;
    }

    console.log(`[convergence-engine] Starting. trigger=${trigger}, batch=${batch ?? 'all'}, states=${statesToScore.length}`);

    const supabase = createSupabaseClient();
    const today = new Date().toISOString().split('T')[0];
    const endDateObj = new Date(); endDateObj.setDate(endDateObj.getDate() + 3);
    const endDate = endDateObj.toISOString().split('T')[0];

    // Batch-fetch ALL domain data (9 queries, covers all states)
    console.log(`[convergence-engine] Batch-fetching all domain data`);
    const batchData = await fetchBatchData(supabase);
    console.log(`[convergence-engine] Batch data: water=${batchData.water.size} drought=${batchData.drought.size} air=${batchData.air_quality.size} soil=${batchData.soil.size} ocean=${batchData.ocean.size} space=${batchData.space_weather.size} river=${batchData.river.size}`);

    // Score states in batches of 3
    const allResults: ScoreResult[] = [];
    const BATCH_SIZE = 3;
    for (let i = 0; i < statesToScore.length; i += BATCH_SIZE) {
      const b = statesToScore.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(b.map(abbr => scoreState(supabase, abbr, today, endDate, batchData)));
      allResults.push(...results);
    }

    // National rankings
    allResults.sort((a, b) => b.score - a.score);
    for (let i = 0; i < allResults.length; i++) {
      (allResults[i] as ScoreResult & { national_rank: number }).national_rank = i + 1;
    }

    // Previous scores for delta tracking
    const { data: prevScores } = await supabase
      .from('hunt_convergence_scores').select('state_abbr, score')
      .eq('date', today).in('state_abbr', statesToScore);
    const prevMap = new Map<string, number>();
    if (prevScores) for (const p of prevScores) prevMap.set(p.state_abbr, p.score);

    // Upsert convergence scores
    const upsertRows = allResults.map(r => ({
      state_abbr: r.state_abbr, date: today, score: r.score,
      weather_component: r.weather, solunar_component: r.solunar,
      migration_component: r.migration, pattern_component: r.pattern,
      birdcast_component: r.birdcast, water_component: r.water,
      photoperiod_component: r.photoperiod, tide_component: r.tide,
      reasoning: r.reasoning, signals: r.signals,
      national_rank: (r as ScoreResult & { national_rank?: number }).national_rank ?? null,
    }));

    const { error: upsertErr } = await supabase
      .from('hunt_convergence_scores').upsert(upsertRows, { onConflict: 'state_abbr,date' });
    if (upsertErr) console.error('[convergence-engine] Upsert error:', upsertErr);

    // Score history
    const historyRows = allResults.map(r => ({
      state_abbr: r.state_abbr, score: r.score, trigger,
      previous_score: prevMap.get(r.state_abbr) ?? null,
    }));
    const { error: histErr } = await supabase.from('hunt_score_history').insert(historyRows);
    if (histErr) console.error('[convergence-engine] History error:', histErr);

    // Embed top 10
    const top10 = allResults.slice(0, 10);
    if (top10.length > 0) {
      const embedTexts = top10.map(r =>
        `convergence | ${r.state_abbr} | ${today} | score:${r.score}/100 | ${r.reasoning}`
      );
      try {
        const embeddings = await batchEmbed(embedTexts, 'document');
        if (embeddings && embeddings.length === embedTexts.length) {
          const knowledgeRows = top10.map((r, idx) => ({
            title: `${r.state_abbr} convergence ${today}`,
            content: embedTexts[idx],
            content_type: 'convergence-score',
            tags: [r.state_abbr, 'convergence', today],
            state_abbr: r.state_abbr, species: null,
            effective_date: today,
            metadata: { score: r.score, trigger, date: today },
            embedding: embeddings[idx],
          }));
          const { error: knErr } = await supabase.from('hunt_knowledge').insert(knowledgeRows);
          if (knErr) console.error('[convergence-engine] Knowledge error:', knErr);
        }
      } catch (embedErr) { console.error('[convergence-engine] Embed error:', embedErr); }
    }

    // Arc reactor: detect buildup
    try {
      for (const r of allResults) {
        const prev = prevMap.get(r.state_abbr);
        const scoreDelta = prev ? r.score - prev : 0;
        const activeDomains: string[] = [];
        const ds = (r.signals as any)?.domain_scores;
        if (ds) {
          if (ds.weather > 5) activeDomains.push('weather');
          if (ds.biological > 5) activeDomains.push('biological');
          if (ds.drought > 5) activeDomains.push('drought');
          if (ds.water > 5) activeDomains.push('water');
          if (ds.air_quality > 5) activeDomains.push('air_quality');
          if (ds.soil > 4) activeDomains.push('soil');
          if (ds.ocean > 5) activeDomains.push('ocean');
          if (ds.space_weather > 3) activeDomains.push('space_weather');
          if (ds.lunar > 5) activeDomains.push('lunar');
          if (ds.photoperiod > 5) activeDomains.push('photoperiod');
          if (ds.tide > 5) activeDomains.push('tide');
        }

        if (scoreDelta > 15 && activeDomains.length >= 2) {
          const existingArc = await getOpenArc(supabase, r.state_abbr);
          if (!existingArc) {
            await createArc(supabase, r.state_abbr, 'buildup', {
              buildup_signals: {
                domains: activeDomains,
                convergence_score: r.score,
                score_trend: [prev || 0, r.score],
                trigger: `Score rose ${scoreDelta} points, ${activeDomains.length} domains converging: ${activeDomains.join(', ')}`,
              },
            });
          }
        }
      }
    } catch (arcErr) { console.error('[convergence-engine] Arc error:', arcErr); }

    // Briefs for top 20
    try {
      const topStates = allResults.slice(0, 20).map(r => r.state_abbr);
      const briefUrl = `${Deno.env.get('SUPABASE_URL') || 'https://rvhyotvklfowklzjahdd.supabase.co'}/functions/v1/hunt-state-brief`;
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
      for (const abbr of topStates) {
        fetch(briefUrl, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ state_abbr: abbr }),
        }).catch(() => {});
      }
    } catch { /* best-effort */ }

    const summary = {
      batch: batch ?? 'all', states_scored: allResults.length,
      top_5: allResults.slice(0, 5).map(r => ({ state: r.state_abbr, score: r.score, reasoning: r.reasoning })),
      trigger, run_at: new Date().toISOString(),
    };

    console.log('[convergence-engine] Complete:', JSON.stringify(summary));
    await logCronRun({ functionName: 'hunt-convergence-engine', status: 'success', summary, durationMs: Date.now() - startTime });
    return successResponse(req, summary);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[convergence-engine] Fatal:', errMsg);
    await logCronRun({ functionName: 'hunt-convergence-engine', status: 'error', errorMessage: errMsg, durationMs: Date.now() - startTime }).catch(() => {});
    try { return errorResponse(req, 'Internal server error', 500); }
    catch { return new Response(JSON.stringify({ error: errMsg }), { status: 500, headers: { 'Content-Type': 'application/json' } }); }
  }
});
