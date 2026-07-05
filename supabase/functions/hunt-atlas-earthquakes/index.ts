import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';

// ---------------------------------------------------------------------------
// hunt-atlas-earthquakes  (READ-ONLY)
//
// Atlas map layer: earthquake points from the archive. This is the ONLY deep,
// true-point layer — every quake carries metadata.lat / metadata.lng back to
// 1990+ (USGS ComCat, content_type = 'earthquake-event').
//
// GET params:
//   minMag  number   default 4.0     magnitude floor
//   from    ISO date default today-5y  effective_date lower bound (inclusive)
//   to      ISO date default today      effective_date upper bound (inclusive)
//   bbox    "minLng,minLat,maxLng,maxLat"  optional spatial window
//
// Each point: { lat, lng, magnitude, date, place, depth_km }
//
// PERFORMANCE NOTE: hunt_knowledge is ~8M rows. Ordering by effective_date
// across the earthquake subset TIMES OUT (no supporting index). BUT filtering
// by effective_date range + jsonb metadata->magnitude is fast. So we filter
// server-side (no SQL ORDER BY) and sort by date desc in JS. Result set is
// bounded to MAX_ROWS.
//
// READ-ONLY: this function performs SELECT only. It never writes, updates,
// deletes, or runs DDL against the archive.
// ---------------------------------------------------------------------------

const CONTENT_TYPE = 'earthquake-event';
const MAX_ROWS = 2000;
const DEFAULT_MIN_MAG = 4.0;
const DEFAULT_YEARS_BACK = 5;

interface QuakePoint {
  lat: number;
  lng: number;
  magnitude: number;
  date: string;
  place: string;
  depth_km: number;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const url = new URL(req.url);
    const p = url.searchParams;

    // --- params ---
    const minMag = (() => {
      const v = parseFloat(p.get('minMag') ?? '');
      return Number.isFinite(v) ? v : DEFAULT_MIN_MAG;
    })();

    const now = new Date();
    const defaultFrom = new Date(now);
    defaultFrom.setFullYear(now.getFullYear() - DEFAULT_YEARS_BACK);

    const from = p.get('from') || isoDate(defaultFrom);
    const to = p.get('to') || isoDate(now);

    // bbox = minLng,minLat,maxLng,maxLat
    let bbox: [number, number, number, number] | null = null;
    const bboxRaw = p.get('bbox');
    if (bboxRaw) {
      const parts = bboxRaw.split(',').map((s) => parseFloat(s.trim()));
      if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
        bbox = [parts[0], parts[1], parts[2], parts[3]];
      } else {
        return errorResponse(req, 'bbox must be "minLng,minLat,maxLng,maxLat"', 400);
      }
    }

    const supabase = createSupabaseClient();

    // --- query (SELECT only) ---
    // No ORDER BY: sorting the earthquake subset by effective_date times out.
    let q = supabase
      .from('hunt_knowledge')
      .select('effective_date, metadata')
      .eq('content_type', CONTENT_TYPE)
      .gte('effective_date', from)
      .lte('effective_date', to)
      // jsonb numeric comparison — metadata->magnitude keeps it numeric
      .gte('metadata->magnitude', minMag);

    if (bbox) {
      const [minLng, minLat, maxLng, maxLat] = bbox;
      q = q
        .gte('metadata->lng', minLng)
        .lte('metadata->lng', maxLng)
        .gte('metadata->lat', minLat)
        .lte('metadata->lat', maxLat);
    }

    // Bound the fetch. Sort happens in JS after.
    q = q.limit(MAX_ROWS);

    const { data, error } = await q;

    if (error) {
      return errorResponse(req, `query failed: ${error.message}`, 500);
    }

    // --- shape + dedup (archive contains some duplicate event rows) ---
    const seen = new Set<string>();
    const points: QuakePoint[] = [];

    for (const row of data ?? []) {
      const m = (row as { metadata?: Record<string, unknown> }).metadata ?? {};
      const lat = Number(m.lat);
      const lng = Number(m.lng);
      const magnitude = Number(m.magnitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(magnitude)) {
        continue; // never emit a point without a real lat/lng
      }
      const date = String((row as { effective_date?: string }).effective_date ?? '');
      const key = `${date}|${lat}|${lng}|${magnitude}`;
      if (seen.has(key)) continue;
      seen.add(key);

      points.push({
        lat,
        lng,
        magnitude,
        date,
        place: typeof m.place === 'string' ? m.place : '',
        depth_km: Number.isFinite(Number(m.depth_km)) ? Number(m.depth_km) : 0,
      });
    }

    // Most recent first.
    points.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    return successResponse(req, {
      type: 'earthquakes',
      count: points.length,
      truncated: (data?.length ?? 0) >= MAX_ROWS,
      params: { minMag, from, to, bbox: bboxRaw ?? null },
      points,
    });
  } catch (err) {
    return errorResponse(req, `unexpected error: ${err instanceof Error ? err.message : String(err)}`, 500);
  }
});
