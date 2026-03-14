import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { extractUserIdWithServiceRole } from '../_shared/auth.ts';
import { generateEmbedding } from '../_shared/embedding.ts';

interface HuntLogBody {
  date: string;
  state_abbr: string;
  county?: string;
  species: string;
  harvest_count: number;
  notes?: string;
  lat?: number;
  lng?: number;
}

serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return errorResponse(req, 'Method not allowed', 405);
  }

  try {
    const body = await req.json();
    const { userId, error } = await extractUserIdWithServiceRole(req, body);
    if (error || !userId) {
      return errorResponse(req, error || 'Unauthorized', 401);
    }

    const {
      date,
      state_abbr,
      county,
      species,
      harvest_count,
      notes,
      lat,
      lng,
    } = body as HuntLogBody;

    // Validate required fields
    if (!date || !state_abbr || !species || harvest_count == null) {
      return errorResponse(req, 'Missing required fields: date, state_abbr, species, harvest_count', 400);
    }

    const validSpecies = ['duck', 'goose', 'deer', 'turkey', 'dove'];
    if (!validSpecies.includes(species)) {
      return errorResponse(req, `Invalid species. Must be one of: ${validSpecies.join(', ')}`, 400);
    }

    const supabase = createSupabaseClient();

    // Auto-fill weather from hunt_weather_history
    let weather: Record<string, unknown> | null = null;
    const { data: weatherRow } = await supabase
      .from('hunt_weather_history')
      .select('temp_high,temp_low,wind_max,wind_dir,pressure,precip,cloud_cover')
      .eq('state_abbr', state_abbr)
      .eq('date', date)
      .maybeSingle();

    if (weatherRow) {
      weather = weatherRow;
    }

    // Auto-fill solunar from hunt_solunar_precomputed
    let solunar: Record<string, unknown> | null = null;
    const { data: solunarRow } = await supabase
      .from('hunt_solunar_precomputed')
      .select('moon_phase,illumination,major_start_1,major_end_1,rating')
      .eq('date', date)
      .maybeSingle();

    if (solunarRow) {
      solunar = solunarRow;
    }

    // Insert hunt log
    const { data: log, error: insertError } = await supabase
      .from('hunt_logs')
      .insert({
        user_id: userId,
        date,
        state_abbr,
        county: county || null,
        species,
        harvest_count,
        notes: notes || null,
        lat: lat ?? null,
        lng: lng ?? null,
        weather,
        solunar,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Insert error:', insertError);
      return errorResponse(req, `Failed to save log: ${insertError.message}`, 500);
    }

    // Build embedding text
    const weatherStr = weather
      ? `weather:temp:${weather.temp_high}/${weather.temp_low} wind:${weather.wind_dir}@${weather.wind_max} pressure:${weather.pressure}`
      : 'weather:unknown';
    const moonStr = solunar ? `moon:${solunar.moon_phase}` : 'moon:unknown';
    const notesStr = notes ? ` | ${notes}` : '';
    const embeddingText = `hunt_log | ${state_abbr} | ${date} | ${species} | harvest:${harvest_count} | ${weatherStr} | ${moonStr}${notesStr}`;

    // Generate embedding and store in hunt_knowledge
    try {
      const embedding = await generateEmbedding(embeddingText, 'document');

      await supabase.from('hunt_knowledge').insert({
        content_type: 'hunt_log',
        title: `Hunt Log: ${species} in ${state_abbr} on ${date}`,
        content: embeddingText,
        species: species || null,
        effective_date: date || null,
        embedding,
        metadata: { hunt_log_id: log.id, user_id: userId, species, state_abbr, date },
      });

      // Mark as embedded
      await supabase
        .from('hunt_logs')
        .update({ embedded_at: new Date().toISOString() })
        .eq('id', log.id);

      log.embedded_at = new Date().toISOString();
    } catch (embedErr) {
      // Embedding failure is non-fatal — log will be picked up by backfill
      console.error('Embedding failed (non-fatal):', embedErr);
    }

    return successResponse(req, { log });
  } catch (err) {
    console.error('hunt-log error:', err);
    return errorResponse(req, 'Internal server error', 500);
  }
});
