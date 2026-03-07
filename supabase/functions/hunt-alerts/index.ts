import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';

// 50 US state centroids
const STATE_CENTROIDS: Record<string, { name: string; lat: number; lng: number }> = {
  AL: { name: "Alabama", lat: 32.807, lng: -86.791 },
  AK: { name: "Alaska", lat: 63.589, lng: -154.493 },
  AZ: { name: "Arizona", lat: 34.049, lng: -111.094 },
  AR: { name: "Arkansas", lat: 34.970, lng: -92.373 },
  CA: { name: "California", lat: 36.116, lng: -119.682 },
  CO: { name: "Colorado", lat: 39.060, lng: -105.311 },
  CT: { name: "Connecticut", lat: 41.598, lng: -72.755 },
  DE: { name: "Delaware", lat: 39.319, lng: -75.507 },
  FL: { name: "Florida", lat: 27.766, lng: -81.687 },
  GA: { name: "Georgia", lat: 33.041, lng: -83.643 },
  HI: { name: "Hawaii", lat: 21.094, lng: -157.498 },
  ID: { name: "Idaho", lat: 44.240, lng: -114.479 },
  IL: { name: "Illinois", lat: 40.349, lng: -88.986 },
  IN: { name: "Indiana", lat: 39.849, lng: -86.258 },
  IA: { name: "Iowa", lat: 42.012, lng: -93.211 },
  KS: { name: "Kansas", lat: 38.527, lng: -96.726 },
  KY: { name: "Kentucky", lat: 37.668, lng: -84.670 },
  LA: { name: "Louisiana", lat: 31.170, lng: -91.868 },
  ME: { name: "Maine", lat: 44.694, lng: -69.382 },
  MD: { name: "Maryland", lat: 39.064, lng: -76.802 },
  MA: { name: "Massachusetts", lat: 42.230, lng: -71.530 },
  MI: { name: "Michigan", lat: 43.327, lng: -84.536 },
  MN: { name: "Minnesota", lat: 45.694, lng: -93.900 },
  MS: { name: "Mississippi", lat: 32.742, lng: -89.679 },
  MO: { name: "Missouri", lat: 38.456, lng: -92.288 },
  MT: { name: "Montana", lat: 46.922, lng: -110.454 },
  NE: { name: "Nebraska", lat: 41.125, lng: -98.268 },
  NV: { name: "Nevada", lat: 38.314, lng: -117.055 },
  NH: { name: "New Hampshire", lat: 43.452, lng: -71.564 },
  NJ: { name: "New Jersey", lat: 40.299, lng: -74.521 },
  NM: { name: "New Mexico", lat: 34.841, lng: -106.248 },
  NY: { name: "New York", lat: 42.166, lng: -74.948 },
  NC: { name: "North Carolina", lat: 35.630, lng: -79.806 },
  ND: { name: "North Dakota", lat: 47.529, lng: -99.784 },
  OH: { name: "Ohio", lat: 40.389, lng: -82.765 },
  OK: { name: "Oklahoma", lat: 35.565, lng: -96.929 },
  OR: { name: "Oregon", lat: 44.572, lng: -122.071 },
  PA: { name: "Pennsylvania", lat: 40.591, lng: -77.210 },
  RI: { name: "Rhode Island", lat: 41.681, lng: -71.512 },
  SC: { name: "South Carolina", lat: 33.857, lng: -80.945 },
  SD: { name: "South Dakota", lat: 44.300, lng: -99.439 },
  TN: { name: "Tennessee", lat: 35.748, lng: -86.692 },
  TX: { name: "Texas", lat: 31.054, lng: -97.563 },
  UT: { name: "Utah", lat: 40.150, lng: -111.862 },
  VT: { name: "Vermont", lat: 44.046, lng: -72.711 },
  VA: { name: "Virginia", lat: 37.769, lng: -78.170 },
  WA: { name: "Washington", lat: 47.401, lng: -121.490 },
  WV: { name: "West Virginia", lat: 38.491, lng: -80.954 },
  WI: { name: "Wisconsin", lat: 44.269, lng: -89.617 },
  WY: { name: "Wyoming", lat: 42.756, lng: -107.302 },
};

interface HuntAlert {
  stateAbbr: string;
  stateName: string;
  severity: "high" | "medium";
  conditions: {
    tempDropF: number;
    windSpeedMph: number;
    pressureChangeMb: number;
    precipMm: number;
  };
  patterns: string[];
  forecastSummary: string;
}

interface StateConditions {
  stateAbbr: string;
  stateName: string;
  tempDropF: number;
  maxWindMph: number;
  pressureChangeMb: number;
  totalPrecipMm: number;
}

function extractConditions(
  stateAbbr: string,
  stateName: string,
  hourly: {
    temperature_2m: number[];
    wind_speed_10m: number[];
    pressure_msl: number[];
    precipitation: number[];
  },
): StateConditions {
  const temps = hourly.temperature_2m;
  const winds = hourly.wind_speed_10m;
  const pressures = hourly.pressure_msl;
  const precip = hourly.precipitation;

  // Temp drop: first 24h avg vs last 24h avg
  const first24Avg = temps.slice(0, 24).reduce((a, b) => a + b, 0) / 24;
  const last24Avg = temps.slice(-24).reduce((a, b) => a + b, 0) / 24;
  const tempDropF = Math.max(0, first24Avg - last24Avg);

  const maxWindMph = Math.max(...winds);
  const pressureChangeMb = Math.max(...pressures) - Math.min(...pressures);
  const totalPrecipMm = precip.reduce((a, b) => a + b, 0);

  return { stateAbbr, stateName, tempDropF, maxWindMph, pressureChangeMb, totalPrecipMm };
}

function isInteresting(c: StateConditions): boolean {
  return c.tempDropF > 10 || c.pressureChangeMb > 3 || c.maxWindMph > 15 || c.totalPrecipMm > 5;
}

function scoreSeverity(c: StateConditions): "high" | "medium" {
  let score = 0;
  if (c.tempDropF > 20) score += 2;
  else if (c.tempDropF > 10) score += 1;
  if (c.pressureChangeMb > 6) score += 2;
  else if (c.pressureChangeMb > 3) score += 1;
  if (c.maxWindMph > 25) score += 2;
  else if (c.maxWindMph > 15) score += 1;
  if (c.totalPrecipMm > 15) score += 1;
  return score >= 4 ? "high" : "medium";
}

function buildSummary(c: StateConditions): string {
  const parts: string[] = [];
  if (c.tempDropF > 10) parts.push(`${Math.round(c.tempDropF)}F temp drop`);
  if (c.maxWindMph > 15) parts.push(`${Math.round(c.maxWindMph)}mph winds`);
  if (c.pressureChangeMb > 3) parts.push(`${c.pressureChangeMb.toFixed(1)}mb pressure swing`);
  if (c.totalPrecipMm > 5) parts.push(`${c.totalPrecipMm.toFixed(1)}mm precip`);

  if (c.tempDropF > 15 && c.maxWindMph > 20) {
    return `Cold front: ${parts.join(", ")}`;
  }
  if (c.pressureChangeMb > 5) {
    return `Pressure system: ${parts.join(", ")}`;
  }
  return `Active weather: ${parts.join(", ")}`;
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const entries = Object.entries(STATE_CENTROIDS);
    const lats = entries.map(([, s]) => s.lat).join(",");
    const lngs = entries.map(([, s]) => s.lng).join(",");

    // Single bulk request to Open-Meteo for all 50 states
    const meteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}&hourly=temperature_2m,wind_speed_10m,pressure_msl,precipitation&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=3`;
    const weatherRes = await fetch(meteoUrl);
    if (!weatherRes.ok) {
      console.error('[hunt-alerts] Open-Meteo error:', weatherRes.status, await weatherRes.text());
      return errorResponse(req, 'Weather API error', 502);
    }

    const meteoData = await weatherRes.json();
    // Open-Meteo returns array for multiple locations, single object for one
    const forecasts: unknown[] = Array.isArray(meteoData) ? meteoData : [meteoData];
    if (forecasts.length !== entries.length) {
      return errorResponse(req, `Expected ${entries.length} forecasts, got ${forecasts.length}`, 502);
    }

    // Extract conditions for each state, filter to interesting ones
    const interesting: StateConditions[] = [];
    for (let i = 0; i < entries.length; i++) {
      const [abbr, info] = entries[i];
      // deno-lint-ignore no-explicit-any
      const forecast = forecasts[i] as any;
      if (!forecast?.hourly) continue;
      const cond = extractConditions(abbr, info.name, forecast.hourly);
      if (isInteresting(cond)) {
        interesting.push(cond);
      }
    }

    if (interesting.length === 0) {
      return successResponse(req, { alerts: [], generated_at: new Date().toISOString() });
    }

    // Vector search for matching hunting patterns per interesting state
    const supabase = createSupabaseClient();
    const embedUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/hunt-generate-embedding`;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const alerts: HuntAlert[] = [];

    // Process in parallel batches of 10
    const batchSize = 10;
    for (let i = 0; i < interesting.length; i += batchSize) {
      const batch = interesting.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(async (c): Promise<HuntAlert> => {
        const conditionText = `${c.stateName} weather: ${Math.round(c.tempDropF)}F temperature drop, ${Math.round(c.maxWindMph)}mph wind, ${c.pressureChangeMb.toFixed(1)}mb pressure change, ${c.totalPrecipMm.toFixed(1)}mm precipitation. Hunting conditions and migration patterns.`;

        let patterns: string[] = [];
        try {
          const embedRes = await fetch(embedUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${serviceKey}`,
            },
            body: JSON.stringify({ text: conditionText, input_type: 'query' }),
          });

          if (embedRes.ok) {
            const { embedding } = await embedRes.json();
            if (embedding) {
              const { data } = await supabase.rpc('search_hunt_knowledge_by_embedding', {
                query_embedding: embedding,
                match_threshold: 0.3,
                match_count: 3,
              });
              if (data && Array.isArray(data)) {
                patterns = data
                  .map((d: { content?: string }) => d.content || '')
                  .filter(Boolean);
              }
            }
          }
        } catch (e) {
          console.error(`[hunt-alerts] Pattern search failed for ${c.stateAbbr}:`, e);
        }

        return {
          stateAbbr: c.stateAbbr,
          stateName: c.stateName,
          severity: scoreSeverity(c),
          conditions: {
            tempDropF: Math.round(c.tempDropF * 10) / 10,
            windSpeedMph: Math.round(c.maxWindMph * 10) / 10,
            pressureChangeMb: Math.round(c.pressureChangeMb * 10) / 10,
            precipMm: Math.round(c.totalPrecipMm * 10) / 10,
          },
          patterns,
          forecastSummary: buildSummary(c),
        };
      }));

      alerts.push(...batchResults);
    }

    // Sort: high severity first, then by temp drop descending
    alerts.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === "high" ? -1 : 1;
      return b.conditions.tempDropF - a.conditions.tempDropF;
    });

    return successResponse(req, { alerts: alerts.slice(0, 10), generated_at: new Date().toISOString() });
  } catch (error) {
    console.error('[hunt-alerts]', error);
    return errorResponse(req, 'Internal server error', 500);
  }
});
