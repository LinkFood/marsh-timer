import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { generateEmbedding } from '../_shared/embedding.ts';

/**
 * hunt-days-like-today — the "days like today" precedent engine.
 *
 * Builds a compact text portrait of today's conditions for a state from
 * cheap bounded reads (forecast, convergence, radar), embeds it via Voyage,
 * and searches the 7M-row archive for historical days that looked the same.
 * For each precedent day it does a bounded effective_date lookup of what
 * followed in the next 7 days.
 *
 * Product law: the archive replays, it never predicts. This returns
 * receipts — dates, similarity, source counts — never forecasts.
 *
 * Self-degrading: ANY timeout or failure returns { degraded: true } fast so
 * the landing keeps its this-day-in-history fallback. While the IVFFlat
 * rebuild is in flight the search will time out and this endpoint degrades;
 * when the new index lands it lights up on its own. No feature flags.
 *
 * Invoked from the frontend — NOT a cron (no logCronRun).
 */

const EMBED_TIMEOUT_MS = 6_000;      // Voyage should answer in <1s
const SEARCH_TIMEOUT_MS = 10_000;    // hard client-side cap on the vector RPC
const AFTERMATH_TIMEOUT_MS = 6_000;  // btree-bounded reads, normally <1s
const HISTORICAL_CUTOFF_DAYS = 60;   // precedents must be at least this old
const MAX_PRECEDENT_DAYS = 4;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// Condition-bearing content types with deep historical effective_date
// coverage — same family the this-day fallback samples from.
const CONDITION_TYPES = [
  'ghcn-daily', 'nasa-daily', 'storm-event', 'drought-weekly', 'drought-index',
  'climate-index', 'climate-index-daily', 'snotel-daily', 'air-quality',
  'soil-conditions', 'river-discharge', 'usgs-water', 'ocean-buoy',
  'noaa-tide', 'tide-gauge', 'space-weather', 'geomagnetic-kp',
];

// What counts as "what followed" — notable outcome types (mirrors the
// landing's latest-from-the-layers notable set, plus historical archives).
const AFTERMATH_TYPES = [
  'storm-event', 'earthquake-event', 'nws-alert', 'anomaly-alert',
  'migration-spike-extreme', 'migration-spike-significant',
  'bio-absence-signal', 'wildfire-perimeter', 'drought-weekly',
];

interface ArchiveRow {
  title: string | null;
  content_type: string | null;
  state_abbr: string | null;
  effective_date: string | null;
  similarity?: number;
  signal_weight?: number;
}

function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().split('T')[0];
}

function addDays(dateStr: string, days: number): string {
  return new Date(new Date(dateStr + 'T12:00:00Z').getTime() + days * 86_400_000)
    .toISOString().split('T')[0];
}

const WMO: Record<number, string> = {
  0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'foggy', 48: 'freezing fog', 51: 'light drizzle', 53: 'drizzle',
  55: 'heavy drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 80: 'rain showers',
  81: 'heavy showers', 82: 'violent showers', 85: 'snow showers',
  95: 'thunderstorms', 96: 'thunderstorms with hail', 99: 'severe thunderstorms',
};

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** Compact text portrait of today's conditions — cheap bounded reads only. */
async function buildPortrait(
  supabase: ReturnType<typeof createSupabaseClient>,
  stateAbbr: string | null,
  today: string,
): Promise<string | null> {
  const now = new Date();
  const dateLine = `${MONTHS[now.getUTCMonth()]} ${now.getUTCDate()}`;
  const parts: string[] = [];

  if (stateAbbr) {
    const [weatherRes, convRes, birdRes] = await Promise.all([
      supabase.from('hunt_weather_forecast')
        .select('temp_high_f, temp_low_f, wind_speed_max_mph, wind_direction_dominant, pressure_msl, precipitation_mm, weather_code, cloud_cover_pct')
        .eq('state_abbr', stateAbbr).eq('date', today).limit(1),
      supabase.from('hunt_convergence_scores')
        .select('score, signals')
        .eq('state_abbr', stateAbbr).order('date', { ascending: false }).limit(1),
      supabase.from('hunt_birdcast')
        .select('cumulative_birds, avg_direction')
        .eq('state_abbr', stateAbbr).order('date', { ascending: false }).limit(1),
    ]);

    const w = weatherRes.data?.[0] as Record<string, number | null> | undefined;
    if (w) {
      const bits: string[] = [];
      if (w.temp_high_f != null && w.temp_low_f != null) bits.push(`high ${Math.round(w.temp_high_f)}F low ${Math.round(w.temp_low_f)}F`);
      if (w.weather_code != null) bits.push(WMO[w.weather_code] ?? `weather code ${w.weather_code}`);
      if (w.wind_speed_max_mph != null && w.wind_speed_max_mph > 0) {
        const dir = COMPASS[Math.round((w.wind_direction_dominant ?? 0) / 22.5) % 16];
        bits.push(`wind ${dir} ${Math.round(w.wind_speed_max_mph)} mph`);
      }
      if (w.pressure_msl != null && w.pressure_msl > 0) bits.push(`pressure ${Math.round(w.pressure_msl)} mb`);
      if (w.precipitation_mm != null && w.precipitation_mm > 0) bits.push(`precipitation ${w.precipitation_mm} mm`);
      if (bits.length > 0) parts.push(bits.join(', '));
    }

    const conv = convRes.data?.[0] as { score: number | null; signals: { domain_scores?: Record<string, number> } | null } | undefined;
    if (conv?.score != null) {
      const active = Object.entries(conv.signals?.domain_scores ?? {})
        .filter(([, v]) => typeof v === 'number' && v > 0)
        .map(([k]) => k.replace(/_/g, ' '));
      parts.push(`environmental convergence score ${conv.score}${active.length > 0 ? ` with ${active.join(', ')} active` : ''}`);
    }

    const bird = birdRes.data?.[0] as { cumulative_birds: number | null; avg_direction: number | null } | undefined;
    if (bird?.cumulative_birds != null && bird.cumulative_birds > 0) {
      const dir = bird.avg_direction != null ? ` moving ${COMPASS[Math.round(bird.avg_direction / 22.5) % 16]}` : '';
      parts.push(`radar migration ${bird.cumulative_birds} birds${dir}`);
    }

    if (parts.length === 0) return null;
    return `${dateLine}, ${stateAbbr}: ${parts.join('. ')}.`;
  }

  // National: today's top convergence states
  const { data } = await supabase.from('hunt_convergence_scores')
    .select('state_abbr, score')
    .eq('date', today).order('score', { ascending: false }).limit(5);
  if (!Array.isArray(data) || data.length === 0) return null;
  const tops = data.map((r: { state_abbr: string; score: number }) => `${r.state_abbr} ${r.score}`).join(', ');
  return `${dateLine}, United States: environmental convergence concentrated in ${tops}.`;
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const degrade = (reason: string) => {
    console.log(`[hunt-days-like-today] degraded: ${reason}`);
    return successResponse(req, { degraded: true, reason });
  };

  try {
    const url = new URL(req.url);
    let stateAbbr = url.searchParams.get('state')?.toUpperCase() || null;
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      if (typeof body.state === 'string') stateAbbr = body.state.toUpperCase();
    }
    if (stateAbbr && !/^[A-Z]{2}$/.test(stateAbbr)) stateAbbr = null;

    const supabase = createSupabaseClient();
    const today = new Date().toISOString().split('T')[0];
    const cutoff = isoDaysAgo(HISTORICAL_CUTOFF_DAYS);

    // 1. Portrait of today — cheap bounded reads on small tables
    const portrait = await withTimeout(
      buildPortrait(supabase, stateAbbr, today), EMBED_TIMEOUT_MS, 'portrait');
    if (!portrait) return degrade('no conditions data for today');

    // 2. Embed the portrait
    const embedding = await withTimeout(
      generateEmbedding(portrait, 'query'), EMBED_TIMEOUT_MS, 'embedding');

    // 3. Vector search with a HARD client-side timeout. While the IVFFlat
    //    rebuild is running this times out → degraded. That is by design.
    const searchStart = Date.now();
    const { data: hits, error: searchError } = await withTimeout(
      supabase.rpc('search_hunt_knowledge_v3', {
        query_embedding: embedding,
        match_threshold: 0.3,
        match_count: 24,
        filter_content_types: CONDITION_TYPES,
        filter_state_abbr: stateAbbr,
        filter_species: null,
        filter_date_from: null,
        filter_date_to: cutoff,          // precedents must be historical
        recency_weight: 0.0,             // replay, don't favor recent
        exclude_du_report: true,
      }),
      SEARCH_TIMEOUT_MS, 'vector search');
    const searchMs = Date.now() - searchStart;
    if (searchError) return degrade(`search error: ${searchError.message}`);
    if (!Array.isArray(hits) || hits.length === 0) return degrade('no precedents above threshold');

    // 4. Group hits into distinct precedent days, best-similarity first.
    //    RPC similarity is weighted by signal_weight — recover raw cosine.
    const byDate = new Map<string, { similarity: number; entries: ArchiveRow[] }>();
    for (const hit of hits as ArchiveRow[]) {
      if (!hit.effective_date || hit.effective_date > cutoff) continue;
      const raw = hit.signal_weight && hit.signal_weight > 0
        ? (hit.similarity ?? 0) / hit.signal_weight
        : (hit.similarity ?? 0);
      const day = byDate.get(hit.effective_date) ?? { similarity: 0, entries: [] };
      day.similarity = Math.max(day.similarity, Math.min(raw, 1));
      if (day.entries.length < 3) day.entries.push(hit);
      byDate.set(hit.effective_date, day);
    }
    const precedentDays = [...byDate.entries()]
      .sort((a, b) => b[1].similarity - a[1].similarity)
      .slice(0, MAX_PRECEDENT_DAYS);
    if (precedentDays.length === 0) return degrade('no historical precedent days');

    // 5. What followed each precedent day — bounded effective_date reads
    //    (btree-indexed). Per-day failure tolerated; never fabricated.
    const aftermaths = await withTimeout(
      Promise.all(precedentDays.map(([date]) => {
        let q = supabase.from('hunt_knowledge')
          .select('title, content_type, state_abbr, effective_date')
          .in('content_type', AFTERMATH_TYPES)
          .gt('effective_date', date)
          .lte('effective_date', addDays(date, 7))
          .order('effective_date', { ascending: true })
          .limit(3);
        if (stateAbbr) q = q.eq('state_abbr', stateAbbr);
        return Promise.resolve(q).then(res => (Array.isArray(res.data) ? res.data as ArchiveRow[] : []))
          .catch(() => [] as ArchiveRow[]);
      })),
      AFTERMATH_TIMEOUT_MS, 'aftermath lookups',
    ).catch(() => precedentDays.map(() => [] as ArchiveRow[]));

    const precedents = precedentDays.map(([date, day], i) => ({
      date,
      similarity: Number(day.similarity.toFixed(3)),
      source_count: day.entries.length,
      entries: day.entries.map(e => ({
        title: e.title, content_type: e.content_type, state_abbr: e.state_abbr,
      })),
      aftermath: (aftermaths[i] ?? []).map(a => ({
        date: a.effective_date, title: a.title,
        content_type: a.content_type, state_abbr: a.state_abbr,
      })),
    }));

    console.log(`[hunt-days-like-today] ${stateAbbr ?? 'US'}: ${precedents.length} precedents, search ${searchMs}ms`);
    return successResponse(req, {
      degraded: false,
      state: stateAbbr,
      portrait,
      precedents,
      receipts: { candidates: hits.length, search_ms: searchMs, historical_cutoff: cutoff },
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    return degrade(err instanceof Error ? err.message : String(err));
  }
});
