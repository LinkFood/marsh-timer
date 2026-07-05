import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';

// ---------------------------------------------------------------------------
// hunt-atlas-events  (READ-ONLY)
//
// Atlas map layer: the human "who happened here" points — geolocated + dated
// notable events/places/people ingested from Wikidata (content_type
// 'wikidata-event' | 'wikidata-place' | 'wikidata-person'). Each carries a true
// metadata.lat / metadata.lng, a date, a label, and a source URL.
//
// GET params:
//   from  ISO date  optional  effective_date lower bound (inclusive)
//   to    ISO date  optional  effective_date upper bound (inclusive; default today = past-only)
//   bbox  "minLng,minLat,maxLng,maxLat"  optional spatial window
//   kinds "event,place,person"  optional filter (default all three)
//
// Each point: { lat, lng, date, label, kind, url }
//
// READ-ONLY: SELECT only. Never writes/updates/deletes/DDL. The wikidata subset
// is small (indexed by content_type), so a direct query is fast.
// ---------------------------------------------------------------------------

const KIND_TYPES: Record<string, string> = {
  event: 'wikidata-event',
  place: 'wikidata-place',
  person: 'wikidata-person',
};
const MAX_ROWS = 3000;

interface EventPoint {
  lat: number;
  lng: number;
  date: string;
  label: string;
  kind: string;
  url: string;
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const url = new URL(req.url);
    const p = url.searchParams;

    const to = p.get('to') || isoToday(); // default: past-only (no scheduled-future items)
    const from = p.get('from') || null;

    const kindsRaw = (p.get('kinds') || 'event,place,person').split(',').map((s) => s.trim());
    const contentTypes = kindsRaw.map((k) => KIND_TYPES[k]).filter(Boolean);
    if (contentTypes.length === 0) {
      return errorResponse(req, 'kinds must be any of: event,place,person', 400);
    }

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

    let q = supabase
      .from('hunt_knowledge')
      .select('effective_date, content_type, metadata')
      .in('content_type', contentTypes)
      .lte('effective_date', to);

    if (from) q = q.gte('effective_date', from);
    if (bbox) {
      const [minLng, minLat, maxLng, maxLat] = bbox;
      q = q
        .gte('metadata->lng', minLng)
        .lte('metadata->lng', maxLng)
        .gte('metadata->lat', minLat)
        .lte('metadata->lat', maxLat);
    }
    q = q.limit(MAX_ROWS);

    const { data, error } = await q;
    if (error) return errorResponse(req, `query failed: ${error.message}`, 500);

    const seen = new Set<string>();
    const points: EventPoint[] = [];
    for (const row of data ?? []) {
      const r = row as { effective_date?: string; content_type?: string; metadata?: Record<string, unknown> };
      const m = r.metadata ?? {};
      const lat = Number(m.lat);
      const lng = Number(m.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const qid = typeof m.qid === 'string' ? m.qid : '';
      const key = qid || `${lat}|${lng}|${r.effective_date}`;
      if (seen.has(key)) continue;
      seen.add(key);

      points.push({
        lat,
        lng,
        date: String(r.effective_date ?? ''),
        label: typeof m.label === 'string' ? m.label : (typeof m.wd_type_label === 'string' ? m.wd_type_label : ''),
        kind: (r.content_type ?? '').replace('wikidata-', ''),
        url: typeof m.url === 'string' ? m.url : '',
      });
    }

    points.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    return successResponse(req, {
      type: 'events',
      count: points.length,
      truncated: (data?.length ?? 0) >= MAX_ROWS,
      params: { from, to, bbox: bboxRaw ?? null, kinds: kindsRaw },
      points,
    });
  } catch (err) {
    return errorResponse(req, `unexpected error: ${err instanceof Error ? err.message : String(err)}`, 500);
  }
});
