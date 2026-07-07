import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';

// ---------------------------------------------------------------------------
// hunt-atlas-storms  (READ-ONLY)
//
// The Sonar Ring's backend: one storm-event ghost for a descended state, plus
// the honest denominator. Clone of the proven hunt-atlas-earthquakes pattern
// (content_type + date filters + jsonb metadata extraction + MAX_ROWS + coord
// guard). storm-event rows (~1.5M) carry state_abbr (verified live: populated,
// no null-state rows), effective_date (btree), and metadata
// {event_type, county, deaths, injuries, magnitude, property_damage, lat, lng}.
// lat/lng are null on zone-scale events (winter storms etc.), real on point
// events (hail, tornado, tstm wind).
//
// GET params:
//   state     required   2-letter USPS abbreviation
//   monthDay  optional   MM-DD (defaults to today UTC) — the "today in
//                        history" calendar probe
//
// Returns:
//   {
//     state, total, earliest_year, month_day,
//     event: {
//       date, event_type, county, deaths, injuries, magnitude,
//       property_damage, lat, lng, located: 'point'|'county',
//       kind: 'today-in-history'|'notable'
//     } | null
//   }
//
// PERFORMANCE NOTES (all verified live 2026-07-05):
// - ORDER BY effective_date on the storm-event subset TIMES OUT (57014). We
//   never ORDER BY in SQL; selection sorts happen in JS over bounded pulls.
// - .in('effective_date', [76 dates]) + state filter: ~0.3s.
// - jsonb metadata->deaths gte filter + state filter: ~0.3s.
// - earliest year found via binary-search existence probes (limit 1, btree).
// - count uses estimated (never exact on hunt_knowledge).
//
// READ-ONLY: SELECT only. Never writes, updates, deletes, or runs DDL.
// No retries anywhere (and never on 4xx).
// ---------------------------------------------------------------------------

const CONTENT_TYPE = 'storm-event';
const MAX_ROWS = 400;
const FLOOR_YEAR = 1950;

interface StormEvent {
  date: string;
  event_type: string;
  county: string | null;
  deaths: number;
  injuries: number;
  magnitude: number | null;
  property_damage: string | null;
  lat: number | null;
  lng: number | null;
  located: 'point' | 'county';
  kind: 'today-in-history' | 'notable';
}

/** "5.00K" / "2.5M" / "1.2B" → USD number (0 when absent/unparseable). */
function damageUsd(raw: unknown): number {
  if (typeof raw !== 'string' || raw.length === 0) return 0;
  const m = raw.trim().match(/^([\d.]+)\s*([KMB])?$/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return 0;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? '').toUpperCase() as 'K' | 'M' | 'B'] ?? 1;
  return n * mult;
}

interface Row {
  effective_date?: string;
  metadata?: Record<string, unknown>;
}

/** Coord guard: some zone-scale rows carry 0/0 instead of null (verified live
 *  on PA Excessive Heat). Only trust coordinates inside a plausible US
 *  envelope (CONUS + AK + HI). Anything else is county-located. */
function realCoords(m: Record<string, unknown>): boolean {
  const lat = Number(m.lat);
  const lng = Number(m.lng);
  return (
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= 17 && lat <= 72 && lng >= -180 && lng <= -64
  );
}

/** Deterministic notability sort: casualties, then damage, then magnitude,
 *  then rows with real coordinates, then most recent. Plain ordering — never
 *  a summed score. */
function pickMostNotable(rows: Row[]): Row | null {
  if (rows.length === 0) return null;
  const ranked = [...rows].sort((a, b) => {
    const am = a.metadata ?? {}, bm = b.metadata ?? {};
    const d = (Number(bm.deaths) || 0) - (Number(am.deaths) || 0);
    if (d !== 0) return d;
    const i = (Number(bm.injuries) || 0) - (Number(am.injuries) || 0);
    if (i !== 0) return i;
    const dm = damageUsd(bm.property_damage) - damageUsd(am.property_damage);
    if (dm !== 0) return dm;
    const mg = (Number(bm.magnitude) || 0) - (Number(am.magnitude) || 0);
    if (mg !== 0) return mg;
    const ac = realCoords(am) ? 1 : 0;
    const bc = realCoords(bm) ? 1 : 0;
    if (bc !== ac) return bc - ac;
    const ad = a.effective_date ?? '', bd = b.effective_date ?? '';
    return ad < bd ? 1 : ad > bd ? -1 : 0;
  });
  return ranked[0];
}

function shapeEvent(row: Row, kind: StormEvent['kind']): StormEvent {
  const m = row.metadata ?? {};
  const lat = Number(m.lat);
  const lng = Number(m.lng);
  const hasCoords = realCoords(m);
  return {
    date: String(row.effective_date ?? ''),
    event_type: typeof m.event_type === 'string' ? m.event_type : 'storm',
    county: typeof m.county === 'string' && m.county.length > 0 ? m.county : null,
    deaths: Number(m.deaths) || 0,
    injuries: Number(m.injuries) || 0,
    magnitude: Number.isFinite(Number(m.magnitude)) && m.magnitude !== null ? Number(m.magnitude) : null,
    property_damage: typeof m.property_damage === 'string' ? m.property_damage : null,
    lat: hasCoords ? lat : null,
    lng: hasCoords ? lng : null,
    located: hasCoords ? 'point' : 'county',
    kind,
  };
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const url = new URL(req.url);
    const state = (url.searchParams.get('state') ?? '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(state)) {
      return errorResponse(req, 'state must be a 2-letter USPS abbreviation', 400);
    }

    const now = new Date();
    const currentYear = now.getUTCFullYear();

    let monthDay = url.searchParams.get('monthDay') ?? '';
    if (!/^\d{2}-\d{2}$/.test(monthDay)) {
      monthDay = now.toISOString().slice(5, 10);
    }

    const supabase = createSupabaseClient();
    const base = () =>
      supabase
        .from('hunt_knowledge')
        .select('effective_date, metadata')
        .eq('content_type', CONTENT_TYPE)
        .is('metadata->superseded', null)
        .eq('state_abbr', state);

    // existsIn(a, b) = any row with effective_date in [a-01-01, b-01-01).
    // Bounded limit-1 probes on the effective_date btree — verified ~0.4s each,
    // fired in PARALLEL rounds (sequential binary search cost 10s+ per call).
    const existsIn = async (fromYear: number, toYear: number): Promise<boolean> => {
      const { data, error } = await base()
        .gte('effective_date', `${fromYear}-01-01`)
        .lt('effective_date', `${toYear}-01-01`)
        .limit(1);
      if (error) throw new Error(`probe failed: ${error.message}`);
      return (data?.length ?? 0) > 0;
    };

    // --- (1) parallel round one: denominator + pre-1990 floor probe +
    //         "today in history" in-list over the full possible span ---
    const [mm, dd] = monthDay.split('-').map(Number);
    const dates: string[] = [];
    for (let y = FLOOR_YEAR; y <= currentYear; y++) {
      // skip invalid dates (Feb 29 on non-leap years)
      const d = new Date(Date.UTC(y, mm - 1, dd));
      if (d.getUTCMonth() === mm - 1 && d.getUTCDate() === dd) {
        dates.push(d.toISOString().slice(0, 10));
      }
    }

    const [countRes, pre1990, inListRes] = await Promise.all([
      // EXACT count, deliberately: estimated is planner-guess garbage per
      // state (verified live: HI estimated 35,107 vs exact 3,128; OK estimated
      // 38,925 vs exact 71,770) and the denominator is the honesty law. This
      // filtered count is index-supported and verified <0.7s even for TX
      // (131k rows) — the "never count exact" rule targets broad/unfiltered
      // counts on hunt_knowledge.
      supabase
        .from('hunt_knowledge')
        .select('id', { count: 'exact', head: true })
        .eq('content_type', CONTENT_TYPE)
        .is('metadata->superseded', null)
        .eq('state_abbr', state),
      existsIn(FLOOR_YEAR, 1990),
      dates.length > 0 ? base().in('effective_date', dates).limit(MAX_ROWS) : Promise.resolve({ data: [], error: null }),
    ]);
    if (countRes.error) return errorResponse(req, `count failed: ${countRes.error.message}`, 500);
    const total = countRes.count ?? 0;

    if (total === 0) {
      return successResponse(req, {
        type: 'storms', state, total: 0, earliest_year: null, month_day: monthDay, event: null,
      });
    }

    // --- (2) earliest year: parallel year-window probes over the likely floor
    //         decade (backfill floor is 1990 — verified PA/OK/VA), with a
    //         sequential binary-search fallback for anything unusual ---
    let earliestYear: number;
    if (!pre1990) {
      const probeYears = Array.from({ length: 8 }, (_, i) => 1990 + i);
      const hits = await Promise.all(probeYears.map((y) => existsIn(y, y + 1)));
      const first = probeYears.find((_, i) => hits[i]);
      if (first !== undefined) {
        earliestYear = first;
      } else {
        // rare: file starts 1998+ — binary search [1998, currentYear]
        let lo = 1998, hi = currentYear;
        while (lo < hi) {
          const mid = Math.floor((lo + hi) / 2);
          if (await existsIn(1998, mid + 1)) hi = mid;
          else lo = mid + 1;
        }
        earliestYear = lo;
      }
    } else {
      // rare: rows before 1990 — binary search [FLOOR_YEAR, 1990]
      let lo = FLOOR_YEAR, hi = 1990;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (await existsIn(FLOOR_YEAR, mid + 1)) hi = mid;
        else lo = mid + 1;
      }
      earliestYear = lo;
    }

    // --- (3) pick the "today in history" event from the in-list pull ---
    let event: StormEvent | null = null;
    if (inListRes.error) {
      return errorResponse(req, `today-in-history query failed: ${inListRes.error.message}`, 500);
    }
    {
      const top = pickMostNotable((inListRes.data ?? []) as Row[]);
      if (top) event = shapeEvent(top, 'today-in-history');
    }

    // --- (4) fallback: most notable event on file (deadly → injurious → any) ---
    if (!event) {
      const pulls = [
        () => base().gte('metadata->deaths', 1).limit(MAX_ROWS),
        () => base().gte('metadata->injuries', 1).limit(MAX_ROWS),
        () => base().limit(MAX_ROWS),
      ];
      for (const pull of pulls) {
        const { data, error } = await pull();
        if (error) return errorResponse(req, `notable query failed: ${error.message}`, 500);
        const top = pickMostNotable((data ?? []) as Row[]);
        if (top) {
          event = shapeEvent(top, 'notable');
          break;
        }
      }
    }

    return successResponse(req, {
      type: 'storms',
      state,
      total,
      earliest_year: earliestYear,
      month_day: monthDay,
      event,
    });
  } catch (err) {
    return errorResponse(req, `unexpected error: ${err instanceof Error ? err.message : String(err)}`, 500);
  }
});
