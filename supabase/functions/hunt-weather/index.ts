import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    if (req.method !== 'POST') return errorResponse(req, 'Method not allowed', 405);

    const { lat, lng, state_abbr, zone_slug } = await req.json();
    if (!lat || !lng) return errorResponse(req, 'lat and lng required');

    const supabase = createSupabaseClient();

    // Check cache (< 1 hour old)
    const { data: cached } = await supabase
      .from('hunt_weather_cache')
      .select('forecast, fetched_at')
      .eq('state_abbr', state_abbr)
      .eq('zone_slug', zone_slug || 'statewide')
      .gte('fetched_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .maybeSingle();

    if (cached) return successResponse(req, cached.forecast);

    // Fetch from Open-Meteo (free, no API key needed)
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,pressure_msl,precipitation,cloud_cover&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=3`;
    const response = await fetch(url);
    if (!response.ok) return errorResponse(req, 'Weather API error', 502);
    const forecast = await response.json();

    // Upsert cache
    await supabase.from('hunt_weather_cache').upsert({
      state_abbr,
      zone_slug: zone_slug || 'statewide',
      lat,
      lng,
      forecast,
      fetched_at: new Date().toISOString(),
    }, { onConflict: 'state_abbr,zone_slug' });

    return successResponse(req, forecast);
  } catch (error) {
    console.error('[hunt-weather]', error);
    return errorResponse(req, 'Internal server error', 500);
  }
});
