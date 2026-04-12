import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { STATE_CENTROIDS } from '../_shared/states.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { scanAndLink } from '../_shared/brainScan.ts';
import { logCronRun } from '../_shared/cronLog.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MetarObs {
  icaoId: string;
  lat: number;
  lon: number;
  temp: number | null;     // Celsius
  dewp: number | null;     // Celsius
  wdir: number | null;     // degrees (0-360) or "VRB"
  wspd: number | null;     // knots
  altim: number | null;    // millibars (aviationweather.gov API returns mb, NOT inHg)
  visib: number | null;    // statute miles
  obsTime: string;         // ISO 8601
  rawOb?: string;
}

interface RealtimeEvent {
  station: string;
  state_abbr: string;
  event_type: string;
  details: string;
  severity: 'high' | 'medium' | 'low';
  metadata: Record<string, unknown>;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Celsius to Fahrenheit */
function cToF(c: number): number {
  return Math.round((c * 9 / 5 + 32) * 10) / 10;
}

/** Knots to MPH */
function ktsToMph(kts: number): number {
  return Math.round(kts * 1.15078 * 10) / 10;
}

/** Inches of Hg to millibars */
function inHgToMb(inHg: number): number {
  return Math.round(inHg * 33.8639 * 10) / 10;
}

/** Compass direction from degrees */
function degreesToCompass(deg: number): string {
  if (deg >= 337 || deg < 23) return 'N';
  if (deg < 68) return 'NE';
  if (deg < 113) return 'E';
  if (deg < 158) return 'SE';
  if (deg < 203) return 'S';
  if (deg < 248) return 'SW';
  if (deg < 293) return 'W';
  return 'NW';
}

/** Angular difference between two compass bearings (0-180) */
function windShiftDegrees(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Find the closest US state for a lat/lon using haversine distance
 * to state centroids. Returns null if the station is too far from
 * any state centroid (>500km — likely non-CONUS/non-US).
 */
function latLonToState(lat: number, lon: number): string | null {
  let bestAbbr: string | null = null;
  let bestDist = Infinity;

  for (const [abbr, centroid] of Object.entries(STATE_CENTROIDS)) {
    const dLat = (lat - centroid.lat) * Math.PI / 180;
    const dLon = (lon - centroid.lng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat * Math.PI / 180) * Math.cos(centroid.lat * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
    const dist = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 6371; // km
    if (dist < bestDist) {
      bestDist = dist;
      bestAbbr = abbr;
    }
  }

  // Skip stations too far from any US state centroid (non-US stations)
  if (bestDist > 500) return null;
  return bestAbbr;
}

// ---------------------------------------------------------------------------
// METAR fetch
// ---------------------------------------------------------------------------

// Key ASOS stations — 3-5 per state, covering major monitoring regions + metro areas
// ~200 stations total, fetched in batches of 40 (API ID limit per request)
const METAR_STATIONS = [
  // AL
  'KBHM','KMOB','KHSV',
  // AK
  'PANC','PAFA',
  // AZ
  'KPHX','KTUS',
  // AR — key duck state
  'KLIT','KFSM','KJBR','KPBF',
  // CA
  'KLAX','KSFO','KSMF','KFAT',
  // CO
  'KDEN','KCOS',
  // CT
  'KBDL',
  // DE
  'KILG',
  // FL
  'KMIA','KJAX','KTLH','KTPA',
  // GA
  'KATL','KSAV',
  // HI
  'PHNL',
  // ID
  'KBOI',
  // IL
  'KORD','KSPI',
  // IN
  'KIND',
  // IA
  'KDSM','KDBQ',
  // KS
  'KICT','KTOP',
  // KY
  'KSDF','KLEX',
  // LA — key duck state
  'KMSY','KSHV','KLFT','KLCH',
  // ME
  'KPWM',
  // MD
  'KBWI',
  // MA
  'KBOS',
  // MI
  'KDTW','KGRR',
  // MN
  'KMSP','KDLH',
  // MS — key duck state
  'KJAN','KGPT','KGLH',
  // MO
  'KSTL','KMCI',
  // MT
  'KBIL','KGTF',
  // NE
  'KOMA','KLNK',
  // NV
  'KLAS','KRNO',
  // NH
  'KMHT',
  // NJ
  'KEWR',
  // NM
  'KABQ',
  // NY
  'KJFK','KBUF','KSYR',
  // NC
  'KRDU','KCLT',
  // ND
  'KFAR','KBIS',
  // OH
  'KCLE','KCMH',
  // OK
  'KOKC','KTUL',
  // OR
  'KPDX','KMED',
  // PA
  'KPHL','KPIT',
  // RI
  'KPVD',
  // SC
  'KCHS','KCAE',
  // SD
  'KFSD','KRAP',
  // TN
  'KBNA','KMEM',
  // TX — key duck state
  'KDFW','KIAH','KSAT','KCRP','KBPT',
  // UT
  'KSLC',
  // VT
  'KBTV',
  // VA
  'KRIC','KORF',
  // WA
  'KSEA','KGEG',
  // WV
  'KCRW',
  // WI
  'KMKE','KMSN',
  // WY
  'KCYS',
];

const METAR_BASE = 'https://aviationweather.gov/api/data/metar';
const BATCH_SIZE = 40; // API handles ~40 IDs per request comfortably

async function fetchMetars(): Promise<MetarObs[]> {
  const allObs: MetarObs[] = [];

  for (let i = 0; i < METAR_STATIONS.length; i += BATCH_SIZE) {
    const batch = METAR_STATIONS.slice(i, i + BATCH_SIZE);
    const ids = batch.join(',');
    const url = `${METAR_BASE}?ids=${ids}&format=json&taf=false&hours=3`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data)) allObs.push(...data);
    } catch (err) {
      console.warn(`[hunt-weather-realtime] METAR batch fetch error: ${err}`);
    }
  }

  return allObs;
}

// ---------------------------------------------------------------------------
// Change detection
// ---------------------------------------------------------------------------

function detectChanges(
  station: string,
  stateAbbr: string,
  recent: MetarObs,
  older: MetarObs,
): RealtimeEvent[] {
  const events: RealtimeEvent[] = [];

  // Time gap in hours between the two observations
  // obsTime from METAR API is Unix timestamp in SECONDS (not milliseconds)
  const recentTime = typeof recent.obsTime === 'number' ? recent.obsTime * 1000 : new Date(recent.obsTime).getTime();
  const olderTime = typeof older.obsTime === 'number' ? older.obsTime * 1000 : new Date(older.obsTime).getTime();
  const hoursGap = (recentTime - olderTime) / (1000 * 60 * 60);
  if (hoursGap < 1 || hoursGap > 6) return events; // need 1-6 hour window

  const hoursLabel = `${hoursGap.toFixed(1)}h`;

  // --- Temperature drop ---
  if (recent.temp !== null && older.temp !== null) {
    const recentF = cToF(recent.temp);
    const olderF = cToF(older.temp);
    const tempDrop = olderF - recentF;

    if (tempDrop > 12) {
      events.push({
        station, state_abbr: stateAbbr,
        event_type: 'major-temp-drop',
        details: `Temp dropped ${Math.round(tempDrop)}F in ${hoursLabel}: ${Math.round(olderF)}F -> ${Math.round(recentF)}F`,
        severity: 'high',
        metadata: { temp_drop_f: Math.round(tempDrop), from_f: Math.round(olderF), to_f: Math.round(recentF), hours: hoursGap },
        timestamp: recent.obsTime,
      });
    } else if (tempDrop > 5) {
      events.push({
        station, state_abbr: stateAbbr,
        event_type: 'temp-drop',
        details: `Temp dropped ${Math.round(tempDrop)}F in ${hoursLabel}: ${Math.round(olderF)}F -> ${Math.round(recentF)}F`,
        severity: 'medium',
        metadata: { temp_drop_f: Math.round(tempDrop), from_f: Math.round(olderF), to_f: Math.round(recentF), hours: hoursGap },
        timestamp: recent.obsTime,
      });
    }
  }

  // --- Wind direction shift ---
  if (recent.wdir !== null && older.wdir !== null &&
      typeof recent.wdir === 'number' && typeof older.wdir === 'number') {
    const shift = windShiftDegrees(older.wdir, recent.wdir);
    if (shift > 60) {
      events.push({
        station, state_abbr: stateAbbr,
        event_type: 'wind-shift',
        details: `Wind shifted ${Math.round(shift)} deg in ${hoursLabel}: ${degreesToCompass(older.wdir)} -> ${degreesToCompass(recent.wdir)}`,
        severity: shift > 135 ? 'high' : 'medium',
        metadata: { shift_degrees: Math.round(shift), from_dir: older.wdir, to_dir: recent.wdir, hours: hoursGap },
        timestamp: recent.obsTime,
      });
    }
  }

  // --- Pressure changes ---
  // altim from aviationweather.gov METAR API is ALREADY in millibars.
  // Do NOT apply inHgToMb() — that was a double-conversion bug inflating values 33.86x.
  if (recent.altim !== null && older.altim !== null
    && recent.altim > 870 && recent.altim < 1100
    && older.altim > 870 && older.altim < 1100) {
    const recentMb = Math.round(recent.altim * 10) / 10;
    const olderMb = Math.round(older.altim * 10) / 10;
    const pressureDelta = recentMb - olderMb;

    if (pressureDelta < -2) {
      events.push({
        station, state_abbr: stateAbbr,
        event_type: 'pressure-drop',
        details: `Pressure dropped ${Math.abs(pressureDelta).toFixed(1)}mb in ${hoursLabel}: ${olderMb.toFixed(0)}mb -> ${recentMb.toFixed(0)}mb`,
        severity: pressureDelta < -6 ? 'high' : 'medium',
        metadata: { pressure_change_mb: Math.round(pressureDelta * 10) / 10, from_mb: olderMb, to_mb: recentMb, hours: hoursGap },
        timestamp: recent.obsTime,
      });
    } else if (pressureDelta > 3) {
      events.push({
        station, state_abbr: stateAbbr,
        event_type: 'pressure-rise',
        details: `Pressure rose ${pressureDelta.toFixed(1)}mb in ${hoursLabel}: ${olderMb.toFixed(0)}mb -> ${recentMb.toFixed(0)}mb (front passage)`,
        severity: pressureDelta > 6 ? 'high' : 'medium',
        metadata: { pressure_change_mb: Math.round(pressureDelta * 10) / 10, from_mb: olderMb, to_mb: recentMb, hours: hoursGap },
        timestamp: recent.obsTime,
      });
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();
  try {
    console.log('[hunt-weather-realtime] Starting METAR observation scan');

    const supabase = createSupabaseClient();

    // -----------------------------------------------------------------
    // 1. Fetch METAR observations (last 3 hours, all US stations)
    // -----------------------------------------------------------------
    const metars = await fetchMetars();
    console.log(`[hunt-weather-realtime] Fetched ${metars.length} METAR observations`);

    // -----------------------------------------------------------------
    // 2. Group observations by station, keep only US stations
    // -----------------------------------------------------------------
    const stationObs: Map<string, { state: string; obs: MetarObs[] }> = new Map();

    for (const m of metars) {
      // Only K-prefix stations (CONUS ASOS/AWOS) + P-prefix (AK/HI)
      if (!m.icaoId || (!m.icaoId.startsWith('K') && !m.icaoId.startsWith('P'))) continue;
      if (m.lat == null || m.lon == null) continue;

      const state = latLonToState(m.lat, m.lon);
      if (!state) continue;

      if (!stationObs.has(m.icaoId)) {
        stationObs.set(m.icaoId, { state, obs: [] });
      }
      stationObs.get(m.icaoId)!.obs.push(m);
    }

    console.log(`[hunt-weather-realtime] ${stationObs.size} US stations with observations`);

    // -----------------------------------------------------------------
    // 3. Detect significant weather changes at each station
    // -----------------------------------------------------------------
    const allEvents: RealtimeEvent[] = [];
    const statesWithEvents = new Set<string>();

    for (const [stationId, { state, obs }] of stationObs) {
      if (obs.length < 2) continue;

      // Sort by time ascending
      obs.sort((a, b) => new Date(a.obsTime).getTime() - new Date(b.obsTime).getTime());

      const oldest = obs[0];
      const newest = obs[obs.length - 1];

      const stationEvents = detectChanges(stationId, state, newest, oldest);

      // If 2+ triggers at same station, upgrade to front-passage
      if (stationEvents.length >= 2) {
        const types = stationEvents.map(e => e.event_type).join('+');
        stationEvents.push({
          station: stationId,
          state_abbr: state,
          event_type: 'front-passage',
          details: `Multiple signals at ${stationId}: ${types}`,
          severity: 'high',
          metadata: {
            component_events: types,
            component_count: stationEvents.length,
          },
          timestamp: newest.obsTime,
        });
      }

      if (stationEvents.length > 0) {
        statesWithEvents.add(state);
        allEvents.push(...stationEvents);
      }
    }

    console.log(`[hunt-weather-realtime] Detected ${allEvents.length} events across ${statesWithEvents.size} states`);

    // -----------------------------------------------------------------
    // 4. If no events, log and exit
    // -----------------------------------------------------------------
    if (allEvents.length === 0) {
      const summary = {
        stations_scanned: stationObs.size,
        events_detected: 0,
        states_affected: 0,
        embeddings_created: 0,
        run_at: new Date().toISOString(),
      };
      console.log('[hunt-weather-realtime] No significant events detected');
      await logCronRun({
        functionName: 'hunt-weather-realtime',
        status: 'success',
        summary,
        durationMs: Date.now() - startTime,
      });
      return successResponse(req, summary);
    }

    // -----------------------------------------------------------------
    // 5. Build embed texts for each event
    // -----------------------------------------------------------------
    const today = new Date().toISOString().split('T')[0];
    const embedTexts: string[] = [];
    const embedMeta: {
      title: string;
      content: string;
      content_type: string;
      tags: string[];
      state_abbr: string;
      metadata: Record<string, unknown>;
    }[] = [];

    for (const evt of allEvents) {
      // Build structured embed text
      const parts: string[] = [
        `weather-realtime`,
        evt.state_abbr,
        evt.station,
        evt.timestamp,
        `type:${evt.event_type}`,
      ];

      if (evt.metadata.temp_drop_f) {
        parts.push(`temp_change:${evt.metadata.temp_drop_f}F/${evt.metadata.hours}h`);
      }
      if (evt.metadata.shift_degrees) {
        parts.push(`wind_shift:${degreesToCompass(evt.metadata.from_dir as number)}->${degreesToCompass(evt.metadata.to_dir as number)}`);
      }
      if (evt.metadata.pressure_change_mb) {
        parts.push(`pressure_change:${evt.metadata.pressure_change_mb}mb/${evt.metadata.hours}h`);
      }

      const embedText = parts.join(' | ');
      embedTexts.push(embedText);
      embedMeta.push({
        title: `${evt.state_abbr} ${evt.event_type} ${evt.station} ${today}`,
        content: embedText,
        content_type: 'weather-realtime',
        tags: [evt.state_abbr, 'weather', 'realtime', evt.event_type, evt.station],
        state_abbr: evt.state_abbr,
        metadata: {
          source: 'nws-metar',
          station: evt.station,
          date: today,
          severity: evt.severity,
          ...evt.metadata,
        },
      });
    }

    // -----------------------------------------------------------------
    // 6. Embed into hunt_knowledge
    // -----------------------------------------------------------------
    console.log(`[hunt-weather-realtime] Embedding ${embedTexts.length} events`);
    let embeddingsCreated = 0;

    // Delete entries from the last 20 minutes to prevent duplicates on rapid re-invocations
    const twentyMinAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const { error: delKnErr } = await supabase
      .from('hunt_knowledge')
      .delete()
      .eq('content_type', 'weather-realtime')
      .gte('created_at', twentyMinAgo);
    if (delKnErr) {
      console.error('[hunt-weather-realtime] Knowledge delete error:', delKnErr);
    }

    const embeddings = await batchEmbed(embedTexts, 'document');

    if (embeddings && embeddings.length === embedTexts.length) {
      // Insert into hunt_knowledge in batches of 50, returning IDs so we can scan+link
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
            effective_date: today,
            metadata: meta.metadata,
            embedding: embeddings[j],
          });
        }
        const { data: inserted, error: knErr } = await supabase
          .from('hunt_knowledge')
          .insert(batchRows)
          .select('id');
        if (knErr) {
          console.error(`[hunt-weather-realtime] Knowledge insert error (batch ${i / KNOWLEDGE_BATCH}):`, knErr);
        } else {
          embeddingsCreated += batchRows.length;
          // Fire-and-forget scan+link for each inserted entry (writes to hunt_pattern_links)
          if (inserted && inserted.length === batchRows.length) {
            for (let k = 0; k < inserted.length; k++) {
              const entryIdx = i + k;
              const sourceId = inserted[k].id;
              scanAndLink(sourceId, embeddings[entryIdx], {
                state_abbr: embedMeta[entryIdx].state_abbr,
                source_content_type: 'weather-realtime',
              }).catch(() => {});
            }
          }
        }
      }
    } else {
      console.error(`[hunt-weather-realtime] Embedding count mismatch: expected ${embedTexts.length}, got ${embeddings?.length ?? 0}`);
    }

    // -----------------------------------------------------------------
    // 6b. Trigger convergence scan for states with high-severity events
    // -----------------------------------------------------------------
    const highSeverityStates = new Set<string>();
    for (const evt of allEvents) {
      if ((evt.severity === 'high' || evt.event_type === 'front-passage') && evt.state_abbr) {
        highSeverityStates.add(evt.state_abbr);
      }
    }

    if (highSeverityStates.size > 0) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      let triggeredCount = 0;
      let throttledCount = 0;

      for (const state of highSeverityStates) {
        // Throttle: skip if a compound-risk-alert exists for this state in the last 3 hours
        const { data: recentScan } = await supabase
          .from('hunt_knowledge')
          .select('id')
          .eq('content_type', 'compound-risk-alert')
          .eq('state_abbr', state)
          .gte('created_at', threeHoursAgo)
          .limit(1)
          .maybeSingle();

        if (recentScan) {
          throttledCount++;
          continue;
        }

        fetch(`${supabaseUrl}/functions/v1/hunt-convergence-scan`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            state_abbr: state,
            trigger_event: 'High-severity weather event detected',
            trigger_type: 'weather-realtime',
            trigger_severity: 'high',
          }),
        }).catch(err => console.error(`[convergence-scan] Trigger failed for ${state}:`, err));
        triggeredCount++;
      }

      console.log(`[hunt-weather-realtime] Convergence scan: ${triggeredCount} triggered, ${throttledCount} throttled (3hr dedup) out of ${highSeverityStates.size} high-severity states`);
    }

    // -----------------------------------------------------------------
    // 7. Summary
    // -----------------------------------------------------------------
    const summary = {
      stations_scanned: stationObs.size,
      events_detected: allEvents.length,
      states_affected: statesWithEvents.size,
      embeddings_created: embeddingsCreated,
      event_types: [...new Set(allEvents.map(e => e.event_type))],
      run_at: new Date().toISOString(),
    };
    console.log(`[hunt-weather-realtime] Complete: Scanned ${stationObs.size} stations, detected ${allEvents.length} events in ${statesWithEvents.size} states`);

    await logCronRun({
      functionName: 'hunt-weather-realtime',
      status: 'success',
      summary,
      durationMs: Date.now() - startTime,
    });

    return successResponse(req, summary);
  } catch (error) {
    console.error('[hunt-weather-realtime] Fatal error:', error);
    await logCronRun({
      functionName: 'hunt-weather-realtime',
      status: 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
    });
    return errorResponse(req, 'Internal server error', 500);
  }
});
