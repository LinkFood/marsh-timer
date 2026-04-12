import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { logCronRun } from '../_shared/cronLog.ts';

// USA-NPN API base
const NPN_BASE = "https://services.usanpn.org/npn_portal";

// Indicator plant species whose phenological stages correlate with ecosystem behavior.
// Green-up timing shapes biological timing and ecological staging across regions.
const INDICATOR_SPECIES = [
  { id: 3, name: "red maple", slug: "red-maple" },
  { id: 12, name: "flowering dogwood", slug: "flowering-dogwood" },
  { id: 36, name: "common lilac", slug: "common-lilac" },
  { id: 61, name: "sugar maple", slug: "sugar-maple" },
  { id: 100, name: "white oak", slug: "white-oak" },
  { id: 976, name: "eastern cottonwood", slug: "eastern-cottonwood" },
];

// All 50 US state abbreviations
const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

// Phenophase descriptions we care about for environmental pattern correlation
const KEY_PHENOPHASES = new Set([
  "Breaking leaf buds",
  "Leaves",
  "Increasing leaf size",
  "Colored leaves",
  "Falling leaves",
  "Flowers or flower buds",
  "Open flowers",
  "Fruits",
  "Ripe fruits",
  "Recent fruit or seed drop",
  "Early season leaf expansion",
]);

interface SiteLevelRecord {
  site_id: number;
  latitude: number;
  longitude: number;
  state: string;
  species_id: number;
  common_name: string;
  phenophase_id: number;
  phenophase_description: string;
  first_yes_sample_size: number;
  mean_first_yes_year: number;
  mean_first_yes_doy: number;
  last_yes_sample_size: number;
  mean_last_yes_year: number;
  mean_last_yes_doy: number;
}

function doyToDate(year: number, doy: number): string {
  const d = new Date(year, 0);
  d.setDate(doy);
  return d.toISOString().slice(0, 10);
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();

    // Query the last 30 days of phenology data
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
    const startDate = thirtyDaysAgo.toISOString().slice(0, 10);
    const endDate = now.toISOString().slice(0, 10);
    const year = now.getUTCFullYear();

    console.log(`Fetching NPN phenology data: ${startDate} to ${endDate}`);

    let totalEmbedded = 0;
    let errors = 0;
    let apiCalls = 0;

    // Process each indicator species
    for (const species of INDICATOR_SPECIES) {
      console.log(`\n${species.name}:`);
      const entries: { text: string; meta: Record<string, unknown> }[] = [];

      // Batch states in groups of 10 to keep API requests reasonable
      for (let si = 0; si < STATES.length; si += 10) {
        const stateChunk = STATES.slice(si, si + 10);

        // Build query params: state[1]=AL&state[2]=AK&...
        const stateParams = stateChunk
          .map((s, i) => `state[${i + 1}]=${s}`)
          .join("&");

        const url = `${NPN_BASE}/observations/getSiteLevelData.json`;
        const body = `request_src=duck_countdown&species_id[1]=${species.id}&${stateParams}&start_date=${startDate}&end_date=${endDate}&climate_data=0`;

        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
          });
          apiCalls++;

          if (!res.ok) {
            console.warn(`  API error ${res.status} for states ${stateChunk.join(",")}`);
            if (res.status >= 500) {
              errors++;
            }
            continue;
          }

          const data: SiteLevelRecord[] = await res.json();

          if (!Array.isArray(data) || data.length === 0) {
            continue;
          }

          // Group by state + phenophase for aggregation
          const grouped = new Map<string, {
            state: string;
            phenophase: string;
            phenophaseId: number;
            sites: number;
            firstYesDoys: number[];
            lastYesDoys: number[];
            lats: number[];
            lons: number[];
          }>();

          for (const rec of data) {
            if (!KEY_PHENOPHASES.has(rec.phenophase_description)) continue;
            if (rec.mean_first_yes_doy <= 0 || rec.mean_first_yes_year <= 0) continue;

            const key = `${rec.state}|${rec.phenophase_description}`;
            let g = grouped.get(key);
            if (!g) {
              g = {
                state: rec.state,
                phenophase: rec.phenophase_description,
                phenophaseId: rec.phenophase_id,
                sites: 0,
                firstYesDoys: [],
                lastYesDoys: [],
                lats: [],
                lons: [],
              };
              grouped.set(key, g);
            }
            g.sites++;
            g.firstYesDoys.push(rec.mean_first_yes_doy);
            if (rec.mean_last_yes_doy > 0) {
              g.lastYesDoys.push(rec.mean_last_yes_doy);
            }
            g.lats.push(rec.latitude);
            g.lons.push(rec.longitude);
          }

          // Build embedding entries from grouped data
          for (const [, g] of grouped) {
            const avgFirstDoy = Math.round(
              g.firstYesDoys.reduce((a, b) => a + b, 0) / g.firstYesDoys.length
            );
            const firstDate = doyToDate(year, avgFirstDoy);

            let lastDate = "";
            if (g.lastYesDoys.length > 0) {
              const avgLastDoy = Math.round(
                g.lastYesDoys.reduce((a, b) => a + b, 0) / g.lastYesDoys.length
              );
              lastDate = doyToDate(year, avgLastDoy);
            }

            const avgLat = (g.lats.reduce((a, b) => a + b, 0) / g.lats.length).toFixed(2);
            const avgLon = (g.lons.reduce((a, b) => a + b, 0) / g.lons.length).toFixed(2);

            const text = `phenology-observation | ${g.state} | ${species.name} | ${g.phenophase} | first_observed:${firstDate}${lastDate ? ` | last_observed:${lastDate}` : ""} | sites:${g.sites} | avg_doy:${avgFirstDoy} | year:${year}`;

            entries.push({
              text,
              meta: {
                title: `${g.state} ${species.slug} ${g.phenophase.toLowerCase().replace(/\s+/g, "-")} ${year}`,
                content: text,
                content_type: "phenology-observation",
                tags: [g.state, species.slug, "phenology", "npn", g.phenophase.toLowerCase()],
                state_abbr: g.state,
                effective_date: firstDate,
                metadata: {
                  source: "usa-npn",
                  species_id: species.id,
                  species_name: species.name,
                  phenophase: g.phenophase,
                  phenophase_id: g.phenophaseId,
                  sites_observed: g.sites,
                  avg_first_yes_doy: avgFirstDoy,
                  first_date: firstDate,
                  last_date: lastDate || null,
                  avg_lat: parseFloat(avgLat),
                  avg_lon: parseFloat(avgLon),
                  period_start: startDate,
                  period_end: endDate,
                },
              },
            });
          }

          // Rate limit headroom between batches
          await new Promise(r => setTimeout(r, 1000));
        } catch (err) {
          console.warn(`  Fetch error for ${stateChunk.join(",")}: ${err}`);
          errors++;
        }
      }

      // Embed and insert in batches of 20
      for (let i = 0; i < entries.length; i += 20) {
        const chunk = entries.slice(i, i + 20);

        try {
          // Dedup: skip entries whose titles already exist in the brain
          const titles = chunk.map(e => e.meta?.title).filter(Boolean);
          const { data: existing } = await supabase.from("hunt_knowledge").select("title").in("title", titles);
          const existingTitles = new Set((existing || []).map((r: any) => r.title));
          const newChunk = chunk.filter(e => !existingTitles.has(e.meta?.title));

          if (newChunk.length === 0) continue;

          const texts = newChunk.map(e => e.text);
          const embeddings = await batchEmbed(texts);

          const rows = newChunk.map((e, j) => ({
            ...e.meta,
            embedding: JSON.stringify(embeddings[j]),
          }));

          const { error: insertError } = await supabase
            .from("hunt_knowledge")
            .insert(rows);

          if (insertError) {
            console.error(`  Insert error: ${insertError.message}`);
            errors++;
          } else {
            totalEmbedded += rows.length;
          }
        } catch (embedErr) {
          console.error(`  Embed/insert error: ${embedErr}`);
          errors++;
        }
      }

      console.log(`  ${species.name}: ${entries.length} phenophase records across states`);
    }

    const durationMs = Date.now() - startTime;
    await logCronRun({
      functionName: "hunt-phenology",
      status: errors > 0 ? "partial" : "success",
      summary: {
        period: `${startDate} to ${endDate}`,
        embedded: totalEmbedded,
        apiCalls,
        errors,
      },
      durationMs,
    });

    return successResponse(req, {
      period: `${startDate} to ${endDate}`,
      embedded: totalEmbedded,
      apiCalls,
      errors,
      durationMs,
    });

  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error("Fatal:", err);
    await logCronRun({
      functionName: "hunt-phenology",
      status: "error",
      errorMessage: String(err),
      durationMs,
    });
    return errorResponse(req, String(err), 500);
  }
});
