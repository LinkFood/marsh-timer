import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { scanBrainOnWrite } from '../_shared/brainScan.ts';
import { logCronRun } from '../_shared/cronLog.ts';

// ODIN (Outage Data Initiative Nationwide) — DOE/ORNL real-time outage data
// County-level outage counts updated every 15 minutes, aggregated by state.
// The entire US electrical grid is a 200K-node wildlife sensor network:
// animal strikes cause ~200K outages/year. Outage spikes also correlate
// with severe weather — a migration trigger.
const ODIN_BASE = "https://ornl.opendatasoft.com/api/explore/v2.1/catalog/datasets/odin-real-time-outages-county/records";

// State name -> abbreviation
const STATE_ABBRS: Record<string, string> = {
  "Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA",
  "Colorado":"CO","Connecticut":"CT","Delaware":"DE","Florida":"FL","Georgia":"GA",
  "Hawaii":"HI","Idaho":"ID","Illinois":"IL","Indiana":"IN","Iowa":"IA",
  "Kansas":"KS","Kentucky":"KY","Louisiana":"LA","Maine":"ME","Maryland":"MD",
  "Massachusetts":"MA","Michigan":"MI","Minnesota":"MN","Mississippi":"MS","Missouri":"MO",
  "Montana":"MT","Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ",
  "New Mexico":"NM","New York":"NY","North Carolina":"NC","North Dakota":"ND","Ohio":"OH",
  "Oklahoma":"OK","Oregon":"OR","Pennsylvania":"PA","Rhode Island":"RI","South Carolina":"SC",
  "South Dakota":"SD","Tennessee":"TN","Texas":"TX","Utah":"UT","Vermont":"VT",
  "Virginia":"VA","Washington":"WA","West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY",
};

function severityLevel(meters: number): string {
  if (meters >= 50000) return "extreme";
  if (meters >= 10000) return "severe";
  if (meters >= 1000) return "significant";
  if (meters >= 100) return "moderate";
  if (meters >= 10) return "minor";
  return "minimal";
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];
    const timeStr = now.toISOString().slice(11, 16);

    console.log(`Fetching ODIN power outage data: ${dateStr} ${timeStr} UTC`);

    // Step 1: Get state-level aggregates from ODIN
    const aggUrl = `${ODIN_BASE}?select=state,count(*)%20as%20outage_count,sum(metersaffected)%20as%20total_meters&group_by=state&order_by=total_meters%20desc&limit=60`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const aggRes = await fetch(aggUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!aggRes.ok) {
      const body = await aggRes.text();
      throw new Error(`ODIN API error ${aggRes.status}: ${body}`);
    }

    const aggData = await aggRes.json();
    const stateResults: Array<{ state: string; outage_count: number; total_meters: number }> = aggData.results || [];

    if (stateResults.length === 0) {
      console.log("No active outages reported by ODIN");
      const durationMs = Date.now() - startTime;
      await logCronRun({
        functionName: "hunt-power-outage",
        status: "success",
        summary: { date: dateStr, time: timeStr, states: 0, embedded: 0, note: "no_active_outages" },
        durationMs,
      });
      return successResponse(req, { date: dateStr, time: timeStr, states: 0, embedded: 0 });
    }

    // Step 2: Get county-level detail for top outage states (top 10 by meters affected)
    const topStates = stateResults.slice(0, 10);
    const countyDetails: Record<string, Array<{ county: string; fips: string; meters: number }>> = {};

    for (const s of topStates) {
      try {
        const countyUrl = `${ODIN_BASE}?select=county,communitydescriptor,metersaffected&where=state%3D%22${encodeURIComponent(s.state)}%22&order_by=metersaffected%20desc&limit=20`;
        const cController = new AbortController();
        const cTimeout = setTimeout(() => cController.abort(), 10000);

        const cRes = await fetch(countyUrl, { signal: cController.signal });
        clearTimeout(cTimeout);

        if (cRes.ok) {
          const cData = await cRes.json();
          const abbr = STATE_ABBRS[s.state];
          if (abbr) {
            countyDetails[abbr] = (cData.results || []).map((r: { county: string; communitydescriptor: string; metersaffected: number }) => ({
              county: r.county,
              fips: r.communitydescriptor,
              meters: r.metersaffected,
            }));
          }
        }

        // Small delay between requests
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        console.warn(`County detail fetch failed for ${s.state}: ${err}`);
      }
    }

    // Step 3: Build embedding entries for each state with outages
    const entries: { text: string; meta: Record<string, unknown> }[] = [];
    let totalMetersNational = 0;
    let totalOutagesNational = 0;

    for (const s of stateResults) {
      const abbr = STATE_ABBRS[s.state];
      if (!abbr) {
        console.warn(`Unknown state name: ${s.state}`);
        continue;
      }

      totalMetersNational += s.total_meters;
      totalOutagesNational += s.outage_count;

      const severity = severityLevel(s.total_meters);
      const counties = countyDetails[abbr];
      const topCountyStr = counties && counties.length > 0
        ? counties.slice(0, 3).map(c => `${c.county}:${c.meters}`).join(",")
        : "n/a";

      const text = [
        `power-outage | ${abbr} | ${dateStr} ${timeStr}UTC`,
        `outages:${s.outage_count} | customers_affected:${s.total_meters}`,
        `severity:${severity}`,
        `top_counties:${topCountyStr}`,
        `source:ODIN/DOE/ORNL (real-time utility reporting)`,
      ].join(" | ");

      entries.push({
        text,
        meta: {
          title: `${abbr} power-outage ${dateStr}`,
          content: text,
          content_type: "power-outage",
          tags: [abbr, "power-outage", "infrastructure", "weather-impact", "wildlife-indicator"],
          state_abbr: abbr,
          species: null,
          effective_date: dateStr,
          metadata: {
            source: "odin-doe-ornl",
            snapshot_time: now.toISOString(),
            outage_count: s.outage_count,
            customers_affected: s.total_meters,
            severity,
            top_counties: counties ? counties.slice(0, 5) : [],
            national_total_meters: 0, // filled after loop
            national_total_outages: 0,
          },
        },
      });
    }

    // Backfill national totals
    for (const e of entries) {
      const meta = e.meta.metadata as Record<string, unknown>;
      meta.national_total_meters = totalMetersNational;
      meta.national_total_outages = totalOutagesNational;
    }

    // Step 4: Also embed a national summary entry
    const nationalSeverity = severityLevel(totalMetersNational);
    const topStatesStr = stateResults.slice(0, 5).map(s => {
      const a = STATE_ABBRS[s.state] || s.state;
      return `${a}:${s.total_meters}`;
    }).join(",");

    const nationalText = [
      `power-outage-national | US | ${dateStr} ${timeStr}UTC`,
      `states_reporting:${stateResults.length} | total_outages:${totalOutagesNational} | total_customers:${totalMetersNational}`,
      `severity:${nationalSeverity}`,
      `top_states:${topStatesStr}`,
      `source:ODIN/DOE/ORNL`,
    ].join(" | ");

    entries.push({
      text: nationalText,
      meta: {
        title: `US power-outage national ${dateStr}`,
        content: nationalText,
        content_type: "power-outage",
        tags: ["US", "power-outage", "infrastructure", "national-summary"],
        state_abbr: null,
        species: null,
        effective_date: dateStr,
        metadata: {
          source: "odin-doe-ornl",
          snapshot_time: now.toISOString(),
          states_reporting: stateResults.length,
          total_outages: totalOutagesNational,
          total_customers: totalMetersNational,
          severity: nationalSeverity,
          top_states: stateResults.slice(0, 10).map(s => ({
            state: STATE_ABBRS[s.state] || s.state,
            outages: s.outage_count,
            customers: s.total_meters,
          })),
        },
      },
    });

    // Step 5: Embed and upsert in batches of 20
    let totalEmbedded = 0;
    let errors = 0;

    for (let i = 0; i < entries.length; i += 20) {
      const chunk = entries.slice(i, i + 20);
      const texts = chunk.map(e => e.text);

      try {
        const embeddings = await batchEmbed(texts);

        const rows = chunk.map((e, j) => ({
          ...e.meta,
          embedding: JSON.stringify(embeddings[j]),
        }));

        const { error: upsertError } = await supabase
          .from("hunt_knowledge")
          .upsert(rows, { onConflict: "title" });

        if (upsertError) {
          console.error(`Upsert error: ${upsertError.message}`);
          errors++;
        } else {
          totalEmbedded += rows.length;
        }

        // Brain scan on first entry of each batch (best-effort cross-domain pattern matching)
        if (embeddings.length > 0) {
          try {
            const firstAbbr = chunk[0].meta.state_abbr as string | null;
            await scanBrainOnWrite(embeddings[0], {
              state_abbr: firstAbbr || undefined,
              exclude_content_type: "power-outage",
              limit: 5,
            });
          } catch (_) { /* scanning is best-effort */ }
        }
      } catch (err) {
        console.error(`Batch embed/upsert error: ${err}`);
        errors++;
      }
    }

    const durationMs = Date.now() - startTime;
    console.log(`Done: ${totalEmbedded} entries embedded, ${errors} errors, ${durationMs}ms`);

    await logCronRun({
      functionName: "hunt-power-outage",
      status: errors > 0 ? "partial" : "success",
      summary: {
        date: dateStr,
        time: timeStr,
        states_reporting: stateResults.length,
        national_customers_affected: totalMetersNational,
        embedded: totalEmbedded,
        errors,
      },
      durationMs,
    });

    return successResponse(req, {
      date: dateStr,
      time: timeStr,
      states_reporting: stateResults.length,
      national_customers_affected: totalMetersNational,
      embedded: totalEmbedded,
      errors,
      durationMs,
    });

  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error("Fatal:", err);
    await logCronRun({
      functionName: "hunt-power-outage",
      status: "error",
      errorMessage: String(err),
      durationMs,
    });
    return errorResponse(req, String(err), 500);
  }
});
