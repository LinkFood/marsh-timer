import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { cronResponse, cronErrorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { scanBrainOnWrite } from '../_shared/brainScan.ts';
import { logCronRun } from '../_shared/cronLog.ts';

// State FIPS codes
const STATE_FIPS: Record<string, string> = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09",
  DE: "10", FL: "12", GA: "13", HI: "15", ID: "16", IL: "17", IN: "18",
  IA: "19", KS: "20", KY: "21", LA: "22", ME: "23", MD: "24", MA: "25",
  MI: "26", MN: "27", MS: "28", MO: "29", MT: "30", NE: "31", NV: "32",
  NH: "33", NJ: "34", NM: "35", NY: "36", NC: "37", ND: "38", OH: "39",
  OK: "40", OR: "41", PA: "42", RI: "44", SC: "45", SD: "46", TN: "47",
  TX: "48", UT: "49", VT: "50", VA: "51", WA: "53", WV: "54", WI: "55",
  WY: "56",
};

interface DroughtWeek {
  mapDate: string;
  stateAbbreviation: string;
  none: number;
  d0: number;
  d1: number;
  d2: number;
  d3: number;
  d4: number;
}

function classifyDrought(d0: number, d1: number, d2: number, d3: number, d4: number): string {
  if (d4 > 10) return "exceptional_drought";
  if (d3 > 20) return "extreme_drought";
  if (d2 > 30) return "severe_drought";
  if (d1 > 40) return "moderate_drought";
  if (d0 > 50) return "abnormally_dry";
  return "normal";
}

function droughtImpact(none: number, d0: number, d2: number, d3: number, d4: number): string {
  const severeTotal = d2 + d3 + d4;
  if (severeTotal > 50) return "critical — over half of state in severe+ drought, water sources depleted, ecosystems stressed, agriculture impacted";
  if (severeTotal > 25) return "significant — quarter+ of state in severe drought, reduced water availability, soil moisture declining";
  if (d0 > 60) return "moderate — majority of state abnormally dry, shallow water areas declining, ecological stress increasing";
  if (none > 80) return "minimal — adequate moisture, normal environmental conditions";
  return "mixed — patchy drought conditions, localized environmental impacts";
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();

    // Parse optional batch parameter (1-5, each = 10 states)
    let batch: number | null = null;
    try {
      const body = await req.json();
      if (body.batch && typeof body.batch === "number" && body.batch >= 1 && body.batch <= 5) {
        batch = body.batch;
      }
    } catch (_) { /* no body or invalid JSON — process all */ }

    // Get the most recent Thursday (USDM updates Thursdays)
    const now = new Date();
    const daysSinceThursday = (now.getUTCDay() + 3) % 7;
    const lastThursday = new Date(now);
    lastThursday.setUTCDate(now.getUTCDate() - daysSinceThursday);

    // Fetch last 2 weeks to compute week-over-week change
    const twoWeeksAgo = new Date(lastThursday);
    twoWeeksAgo.setUTCDate(twoWeeksAgo.getUTCDate() - 14);

    const startDate = `${twoWeeksAgo.getUTCMonth() + 1}/${twoWeeksAgo.getUTCDate()}/${twoWeeksAgo.getUTCFullYear()}`;
    const endDate = `${now.getUTCMonth() + 1}/${now.getUTCDate()}/${now.getUTCFullYear()}`;

    const allAbbrs = Object.keys(STATE_FIPS).sort();

    // If batch specified, slice to that batch's 10 states; otherwise process all
    const abbrs = batch
      ? allAbbrs.slice((batch - 1) * 10, batch * 10)
      : allAbbrs;

    console.log(`Fetching drought data: ${startDate} to ${endDate} | batch=${batch ?? "all"} | states=${abbrs.join(",")}`);

    let totalEmbedded = 0;
    let errors = 0;

    // Process states in chunks of 10 for embedding batches
    for (let s = 0; s < abbrs.length; s += 10) {
      const stateChunk = abbrs.slice(s, s + 10);
      const allEntries: { abbr: string; week: DroughtWeek; prevWeek: DroughtWeek | null }[] = [];

      // Fetch all states in this chunk in parallel with per-state timeout
      // USDM API is slow — 20s timeout per state prevents one slow state from killing the run
      const fetchResults = await Promise.allSettled(stateChunk.map(async (abbr) => {
        const fips = STATE_FIPS[abbr];
        const url = `https://usdmdataservices.unl.edu/api/StateStatistics/GetDroughtSeverityStatisticsByAreaPercent?aoi=${fips}&startdate=${startDate}&enddate=${endDate}&statisticsType=1`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
          const res = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
          clearTimeout(timeout);
          if (!res.ok) throw new Error(`API error ${res.status}`);
          const weeks: DroughtWeek[] = await res.json();
          return { abbr, weeks };
        } catch (err) {
          clearTimeout(timeout);
          throw err;
        }
      }));

      for (const result of fetchResults) {
        if (result.status === "rejected") {
          console.warn(`Fetch failed: ${result.reason}`);
          errors++;
          continue;
        }
        const { abbr, weeks } = result.value;
        if (!weeks || weeks.length === 0) continue;

        weeks.sort((a, b) => a.mapDate.localeCompare(b.mapDate));
        const latest = weeks[weeks.length - 1];
        const prev = weeks.length > 1 ? weeks[weeks.length - 2] : null;
        allEntries.push({ abbr, week: latest, prevWeek: prev });
      }

      if (allEntries.length === 0) continue;

      // Skip entries that already exist in the brain
      const candidateTitles = allEntries.map(({ abbr, week }) => {
        const dateStr = week.mapDate.slice(0, 10);
        return `${abbr} drought ${dateStr}`;
      });
      const { data: existing } = await supabase
        .from("hunt_knowledge")
        .select("title")
        .in("title", candidateTitles);
      const existingTitles = new Set((existing || []).map((r: any) => r.title));
      const filteredEntries = allEntries.filter(({ abbr, week }) => {
        const dateStr = week.mapDate.slice(0, 10);
        return !existingTitles.has(`${abbr} drought ${dateStr}`);
      });
      if (filteredEntries.length === 0) continue;

      // Build embed texts
      const texts = filteredEntries.map(({ abbr, week, prevWeek }) => {
        const dateStr = week.mapDate.slice(0, 10);
        const classification = classifyDrought(week.d0, week.d1, week.d2, week.d3, week.d4);
        const impact = droughtImpact(week.none, week.d0, week.d2, week.d3, week.d4);

        let changeStr = "first_week";
        if (prevWeek) {
          const d0Change = (week.d0 - prevWeek.d0).toFixed(1);
          const d2Change = (week.d2 - prevWeek.d2).toFixed(1);
          const noneChange = (week.none - prevWeek.none).toFixed(1);
          changeStr = `none_change:${noneChange}%|d0_change:${d0Change}%|severe_change:${d2Change}%`;
        }

        return `drought-weekly | ${abbr} | ${dateStr} | none:${week.none.toFixed(1)}% | D0:${week.d0.toFixed(1)}% | D1:${week.d1.toFixed(1)}% | D2:${week.d2.toFixed(1)}% | D3:${week.d3.toFixed(1)}% | D4:${week.d4.toFixed(1)}% | class:${classification} | ${changeStr} | impact: ${impact}`;
      });

      // Batch embed
      const embeddings = await batchEmbed(texts);

      // Build rows
      const rows = filteredEntries.map(({ abbr, week, prevWeek }, i) => {
        const dateStr = week.mapDate.slice(0, 10);
        const classification = classifyDrought(week.d0, week.d1, week.d2, week.d3, week.d4);

        return {
          title: `${abbr} drought ${dateStr}`,
          content: texts[i],
          content_type: "drought-weekly",
          tags: [abbr, "drought", "water", "environment"],
          state_abbr: abbr,
          species: null,
          effective_date: dateStr,
          metadata: {
            source: "usdm",
            none_pct: week.none,
            d0_pct: week.d0,
            d1_pct: week.d1,
            d2_pct: week.d2,
            d3_pct: week.d3,
            d4_pct: week.d4,
            classification,
            week_change: prevWeek ? {
              none: parseFloat((week.none - prevWeek.none).toFixed(1)),
              d0: parseFloat((week.d0 - prevWeek.d0).toFixed(1)),
              d1: parseFloat((week.d1 - prevWeek.d1).toFixed(1)),
              d2: parseFloat((week.d2 - prevWeek.d2).toFixed(1)),
              d3: parseFloat((week.d3 - prevWeek.d3).toFixed(1)),
              d4: parseFloat((week.d4 - prevWeek.d4).toFixed(1)),
            } : null,
          },
          embedding: JSON.stringify(embeddings[i]),
        };
      });

      // Insert
      const { error: insertError } = await supabase
        .from("hunt_knowledge")
        .insert(rows);

      if (insertError) {
        console.error(`Insert error for batch starting ${stateChunk[0]}: ${insertError.message}`);
        errors++;
      } else {
        totalEmbedded += rows.length;
      }

      // Brain scan on the first entry of each batch
      if (embeddings.length > 0) {
        try {
          await scanBrainOnWrite(embeddings[0], {
            contentType: "drought-weekly",
            stateAbbr: filteredEntries[0].abbr,
            excludeContentTypes: ["drought-weekly"],
            limit: 5,
          });
        } catch (_) { /* scanning is best-effort */ }
      }
    }

    const durationMs = Date.now() - startTime;
    await logCronRun({
      functionName: "hunt-drought-monitor",
      status: errors > 0 ? "partial" : "success",
      summary: { batch: batch ?? "all", states_processed: abbrs.length, states_embedded: totalEmbedded, errors },
      durationMs,
    });

    return cronResponse({ batch: batch ?? "all", embedded: totalEmbedded, errors, durationMs });

  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error("Fatal:", err);
    await logCronRun({
      functionName: "hunt-drought-monitor",
      status: "error",
      errorMessage: String(err),
      durationMs,
    });
    return cronErrorResponse(String(err), 500);
  }
});
