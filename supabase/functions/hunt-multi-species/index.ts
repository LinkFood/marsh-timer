import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { cronResponse, cronErrorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { logCronRun } from '../_shared/cronLog.ts';

// Multi-Species Convergence: detects when multiple species show
// simultaneous activity in the same state. When ducks AND geese AND
// deer are all active in Arkansas at the same time, that's a compound
// biological signal — conditions are favorable across species.

const ALL_SPECIES = ["duck", "goose", "deer", "turkey", "dove"];

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY",
];

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();
    const today = new Date().toISOString().split("T")[0];
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const sinceStr = threeDaysAgo.toISOString();

    // Content types that carry species data — query per-type to hit the
    // compound index (content_type, created_at DESC) and avoid statement_timeout
    const SPECIES_CONTENT_TYPES = [
      "migration-spike-extreme", "migration-spike-significant",
      "birdcast-daily", "birdweather-acoustic",
      "convergence-score", "compound-risk-alert",
      "multi-species-convergence",
    ];

    // Parallel per-type queries — each hits the compound index fast
    const queryPromises = SPECIES_CONTENT_TYPES.map(ct =>
      supabase
        .from("hunt_knowledge")
        .select("state_abbr, species, content_type")
        .eq("content_type", ct)
        .not("state_abbr", "is", null)
        .not("species", "is", null)
        .gte("created_at", sinceStr)
        .limit(200)
    );

    const results = await Promise.all(queryPromises);
    const entries: Array<{ state_abbr: string; species: string; content_type: string }> = [];
    let fetchErrorMsg: string | null = null;

    for (const result of results) {
      if (result.error) {
        console.warn(`[hunt-multi-species] Query error: ${result.error.message}`);
        fetchErrorMsg = result.error.message;
        continue;
      }
      if (result.data) entries.push(...result.data);
    }

    if (entries.length === 0) {
      await logCronRun({
        functionName: "hunt-multi-species",
        status: fetchErrorMsg ? "error" : "success",
        errorMessage: fetchErrorMsg || undefined,
        summary: { reason: "no species data in 3-day window" },
        durationMs: Date.now() - startTime,
      });
      return fetchErrorMsg
        ? cronErrorResponse(fetchErrorMsg, 500)
        : cronResponse({ states_with_convergence: 0, reason: "no species data" });
    }

    // Build state → species → activity map
    const stateActivity = new Map<string, Map<string, { count: number; types: Set<string> }>>();

    for (const entry of entries) {
      const state = entry.state_abbr;
      const species = entry.species;
      if (!state || !species) continue;

      if (!stateActivity.has(state)) stateActivity.set(state, new Map());
      const speciesMap = stateActivity.get(state)!;

      if (!speciesMap.has(species)) speciesMap.set(species, { count: 0, types: new Set() });
      const activity = speciesMap.get(species)!;
      activity.count++;
      activity.types.add(entry.content_type);
    }

    // Find states with 3+ active species
    const convergences: Array<{ text: string; meta: Record<string, any> }> = [];

    for (const [state, speciesMap] of stateActivity) {
      const activeSpecies = [...speciesMap.entries()]
        .filter(([_, act]) => act.count >= 2) // at least 2 data points
        .sort((a, b) => b[1].count - a[1].count);

      if (activeSpecies.length < 2) continue; // need at least 2 species

      const speciesList = activeSpecies.map(([sp, act]) =>
        `${sp}(${act.count} signals from ${[...act.types].join("+")})`
      );

      const totalSignals = activeSpecies.reduce((sum, [_, act]) => sum + act.count, 0);
      const convergenceLevel = activeSpecies.length >= 4 ? "high" :
        activeSpecies.length >= 3 ? "moderate" : "low";

      const text = [
        `multi-species-convergence | ${state} | ${today}`,
        `active_species:${activeSpecies.length} | total_signals:${totalSignals}`,
        `convergence:${convergenceLevel}`,
        `species: ${speciesList.join(", ")}`,
        `Multiple species showing simultaneous activity in ${state}. ${activeSpecies.length} species with ${totalSignals} combined data points in the last 7 days. This cross-species convergence suggests favorable conditions across taxa.`,
      ].join(" | ");

      convergences.push({
        text,
        meta: {
          title: `multi-species ${state} ${today}`,
          content: text,
          content_type: "multi-species-convergence",
          tags: [state, "multi-species", convergenceLevel, ...activeSpecies.map(s => s[0])],
          species: null,
          state_abbr: state,
          effective_date: today,
          metadata: {
            source: "multi-species-detector",
            active_species_count: activeSpecies.length,
            total_signals: totalSignals,
            convergence_level: convergenceLevel,
            species_detail: Object.fromEntries(
              activeSpecies.map(([sp, act]) => [sp, { count: act.count, types: [...act.types] }])
            ),
          },
        },
      });
    }

    // Sort by species count descending
    convergences.sort((a, b) =>
      (b.meta.metadata as any).active_species_count - (a.meta.metadata as any).active_species_count
    );

    console.log(`${convergences.length} states with multi-species convergence`);

    // Embed and upsert
    let totalEmbedded = 0;
    let errors = 0;

    for (let i = 0; i < convergences.length; i += 20) {
      const chunk = convergences.slice(i, i + 20);
      const texts = chunk.map(e => e.text);
      const embeddings = await batchEmbed(texts);
      const rows = chunk.map((e, j) => ({
        ...e.meta,
        embedding: JSON.stringify(embeddings[j]),
      }));

      const { error: upsertError } = await supabase
        .from("hunt_knowledge")
        .insert(rows);

      if (upsertError) {
        console.error(`Upsert error: ${upsertError.message}`);
        errors++;
      } else {
        totalEmbedded += rows.length;
      }
    }

    const durationMs = Date.now() - startTime;
    await logCronRun({
      functionName: "hunt-multi-species",
      status: errors > 0 ? "partial" : "success",
      summary: { states_with_convergence: convergences.length, embedded: totalEmbedded, errors },
      durationMs,
    });

    return cronResponse({
      states_with_convergence: convergences.length,
      embedded: totalEmbedded,
      top_states: convergences.slice(0, 5).map(c => ({
        state: c.meta.state_abbr,
        species_count: (c.meta.metadata as any).active_species_count,
      })),
      errors,
      durationMs,
    });

  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error("Fatal:", err);
    await logCronRun({
      functionName: "hunt-multi-species",
      status: "error",
      errorMessage: String(err),
      durationMs,
    });
    return cronErrorResponse(String(err), 500);
  }
});
