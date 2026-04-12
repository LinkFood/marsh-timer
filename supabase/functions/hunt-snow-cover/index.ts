import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { logCronRun } from '../_shared/cronLog.ts';

// NCEI Daily Snow Depth API — returns GeoJSON with station-level readings per state/month
// Values are snow depth in inches. "M" = missing, "T" = trace.
const NCEI_BASE = "https://www.ncei.noaa.gov/access/monitoring/daily-snow";

// All 50 states — NCEI uses uppercase abbreviations
const STATE_ABBRS = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

const STATE_NAMES: Record<string, string> = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",
  CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",
  IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",
  ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",
  MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",
  NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",
  OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",
  TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",
  WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",
};

function classifySnowCover(avgDepth: number, pctWithSnow: number): string {
  if (avgDepth >= 12 && pctWithSnow >= 60) return "heavy_snow_cover";
  if (avgDepth >= 6 && pctWithSnow >= 40) return "moderate_snow_cover";
  if (avgDepth >= 2 && pctWithSnow >= 20) return "light_snow_cover";
  if (pctWithSnow > 0) return "trace_snow_cover";
  return "no_snow";
}

function environmentalImpact(avgDepth: number, pctWithSnow: number, maxDepth: number): string {
  if (avgDepth >= 12 && pctWithSnow >= 60)
    return "heavy snow/ice lockout — strong environmental disruption trigger, terrestrial foraging blocked, open water concentrated";
  if (avgDepth >= 6 && pctWithSnow >= 40)
    return "significant snow cover — moderate biological timing pressure, field access limited, shallow wetlands freezing";
  if (avgDepth >= 2 && pctWithSnow >= 20)
    return "light snow cover — mild ecosystem influence, some field access restricted, shallow wetlands may ice over";
  if (pctWithSnow > 5)
    return "minimal snow — negligible environmental impact, most habitat accessible";
  return "no snow — no snow-driven environmental pressure";
}

interface StationFeature {
  properties: {
    ghcnid: string;
    station_name: string;
    state: { abbr: string };
    county: string;
    elev: number;
    values: Record<string, string>;
  };
}

interface DayStats {
  stationsReporting: number;
  stationsWithSnow: number;
  avgDepth: number;
  maxDepth: number;
  pctWithSnow: number;
}

function aggregateDay(features: StationFeature[], dayKey: string): DayStats | null {
  const depths: number[] = [];
  let stationsReporting = 0;

  for (const f of features) {
    const val = f.properties.values[dayKey];
    if (val === "M" || val === undefined || val === null) continue;
    stationsReporting++;
    if (val === "T") {
      depths.push(0.1); // trace = 0.1 inches
    } else {
      const num = parseFloat(val);
      if (!isNaN(num)) depths.push(num);
    }
  }

  if (stationsReporting === 0) return null;

  const withSnow = depths.filter(d => d > 0).length;
  const avg = depths.reduce((s, d) => s + d, 0) / depths.length;
  const max = Math.max(...depths);

  return {
    stationsReporting,
    stationsWithSnow: withSnow,
    avgDepth: parseFloat(avg.toFixed(1)),
    maxDepth: parseFloat(max.toFixed(1)),
    pctWithSnow: parseFloat(((withSnow / stationsReporting) * 100).toFixed(1)),
  };
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();

    // Target yesterday's data
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const year = yesterday.getUTCFullYear();
    const month = String(yesterday.getUTCMonth() + 1).padStart(2, "0");
    const dayOfMonth = String(yesterday.getUTCDate());
    const dateStr = `${year}-${month}-${dayOfMonth.padStart(2, "0")}`;
    const yyyymm = `${year}${month}`;

    console.log(`Fetching NCEI snow depth for ${dateStr} (day key: ${dayOfMonth})`);

    let totalEmbedded = 0;
    let errors = 0;
    let skipped = 0;

    // Process states in batches of 10 to avoid timeout
    for (let s = 0; s < STATE_ABBRS.length; s += 10) {
      const stateChunk = STATE_ABBRS.slice(s, s + 10);
      const entries: { text: string; meta: Record<string, unknown> }[] = [];

      for (const abbr of stateChunk) {
        try {
          const url = `${NCEI_BASE}/${abbr}/snow-depth/${yyyymm}/map-data.json`;
          const res = await fetch(url);

          if (!res.ok) {
            if (res.status >= 500) {
              console.warn(`${abbr}: server error ${res.status}, skipping`);
              errors++;
            } else {
              // 4xx — no data for this state/month, skip silently
              skipped++;
            }
            continue;
          }

          const geojson = await res.json();
          const features: StationFeature[] = geojson?.features || [];
          if (features.length === 0) {
            skipped++;
            continue;
          }

          const stats = aggregateDay(features, dayOfMonth);
          if (!stats || stats.stationsReporting === 0) {
            skipped++;
            continue;
          }

          const classification = classifySnowCover(stats.avgDepth, stats.pctWithSnow);
          const impact = environmentalImpact(stats.avgDepth, stats.pctWithSnow, stats.maxDepth);

          const text = `snow-cover-daily | ${abbr} | ${dateStr} | avg_depth:${stats.avgDepth}in | max_depth:${stats.maxDepth}in | stations_reporting:${stats.stationsReporting} | stations_with_snow:${stats.stationsWithSnow} | pct_with_snow:${stats.pctWithSnow}% | class:${classification} | impact: ${impact}`;

          entries.push({
            text,
            meta: {
              title: `${abbr} snow-cover ${dateStr}`,
              content: text,
              content_type: "snow-cover-daily",
              tags: [abbr, "snow", "ice", "snow-cover", "environmental-trigger", "freeze"],
              state_abbr: abbr,
              species: null,
              effective_date: dateStr,
              metadata: {
                source: "ncei-daily-snow",
                stations_reporting: stats.stationsReporting,
                stations_with_snow: stats.stationsWithSnow,
                avg_depth_inches: stats.avgDepth,
                max_depth_inches: stats.maxDepth,
                pct_with_snow: stats.pctWithSnow,
                classification,
              },
            },
          });
        } catch (err) {
          console.warn(`${abbr}: ${err}`);
          errors++;
        }

        // Rate limit headroom — NCEI is a government service
        await new Promise(r => setTimeout(r, 300));
      }

      if (entries.length === 0) continue;

      // Batch embed (already capped at 20 inside batchEmbed, but our chunks are <=10)
      const texts = entries.map(e => e.text);
      const embeddings = await batchEmbed(texts);

      const rows = entries.map((e, i) => ({
        ...e.meta,
        embedding: JSON.stringify(embeddings[i]),
      }));

      const { error: upsertError } = await supabase
        .from("hunt_knowledge")
        .insert(rows);

      if (upsertError) {
        console.error(`Upsert error for batch starting ${stateChunk[0]}: ${upsertError.message}`);
        errors++;
      } else {
        totalEmbedded += rows.length;
      }
    }

    const durationMs = Date.now() - startTime;
    await logCronRun({
      functionName: "hunt-snow-cover",
      status: errors > 0 ? "partial" : "success",
      summary: { date: dateStr, states_embedded: totalEmbedded, skipped, errors },
      durationMs,
    });

    return successResponse(req, { date: dateStr, embedded: totalEmbedded, skipped, errors, durationMs });

  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error("Fatal:", err);
    await logCronRun({
      functionName: "hunt-snow-cover",
      status: "error",
      errorMessage: String(err),
      durationMs,
    });
    return errorResponse(req, String(err), 500);
  }
});
