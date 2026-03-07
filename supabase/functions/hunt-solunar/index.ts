import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    if (req.method !== 'POST') return errorResponse(req, 'Method not allowed', 405);

    const { lat, lng, date, timezone } = await req.json();
    if (!lat || !lng || !date) return errorResponse(req, 'lat, lng, and date required');

    const supabase = createSupabaseClient();

    // Check cache (round to 0.1 degree for cache hits)
    const roundLat = Math.round(lat * 10) / 10;
    const roundLng = Math.round(lng * 10) / 10;
    const { data: cached } = await supabase
      .from('hunt_solunar_cache')
      .select('data')
      .eq('lat', roundLat)
      .eq('lng', roundLng)
      .eq('date', date)
      .maybeSingle();

    if (cached) return successResponse(req, cached.data);

    // Fetch solunar + sunrise in parallel
    const dateFormatted = date.replace(/-/g, '');
    const tzOffset = getTimezoneOffset(timezone || 'America/New_York');

    const [solunarRes, sunriseRes] = await Promise.all([
      fetch(`https://api.solunar.org/solunar/${lat},${lng},${dateFormatted},${tzOffset}`),
      fetch(`https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lng}&date=${date}&formatted=0`),
    ]);

    const solunar = solunarRes.ok ? await solunarRes.json() : null;
    const sunrise = sunriseRes.ok ? await sunriseRes.json() : null;

    const combined = {
      solunar: solunar || {},
      sunrise: sunrise?.results || {},
      date,
      lat: roundLat,
      lng: roundLng,
    };

    // Cache
    await supabase.from('hunt_solunar_cache').upsert({
      lat: roundLat,
      lng: roundLng,
      date,
      data: combined,
      fetched_at: new Date().toISOString(),
    }, { onConflict: 'lat,lng,date' });

    return successResponse(req, combined);
  } catch (error) {
    console.error('[hunt-solunar]', error);
    return errorResponse(req, 'Internal server error', 500);
  }
});

function getTimezoneOffset(tz: string): number {
  try {
    const now = new Date();
    const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
    return Math.round((local.getTime() - utc.getTime()) / (60 * 60 * 1000));
  } catch {
    return -5; // Default EST
  }
}
