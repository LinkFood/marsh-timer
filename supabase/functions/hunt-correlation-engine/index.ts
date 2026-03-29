import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { logCronRun } from '../_shared/cronLog.ts';

// Correlation Discovery Engine: the brain does science on its own data.
// Picks a random recent entry, vector-searches for the most similar entries
// across DIFFERENT content types, and embeds the cross-domain connection.
//
// This is how the brain discovers patterns nobody hypothesized:
// "This weather event in AR is 0.94 similar to a migration spike from 2024"
// "This snow cover pattern in ND matches a BirdWeather acoustic surge"

// Seed types: multi-domain entries produce the best cross-domain discoveries
const SEED_TYPES = [
  "compound-risk-alert", "convergence-score", "anomaly-alert",
  "weather-event", "nws-alert", "migration-spike-extreme", "migration-spike-significant",
  "birdcast-daily", "climate-index", "disaster-watch",
];

// Cross-domain search targets: what we match seeds AGAINST (different domain)
const CROSS_DOMAIN_TYPES = [
  "weather-realtime", "weather-event", "migration-spike-extreme", "migration-spike-significant",
  "birdcast-daily", "birdweather-acoustic", "usgs-water", "climate-index",
  "drought-weekly", "nws-alert", "convergence-score", "compound-risk-alert",
  "noaa-tide", "crop-progress", "gbif-monthly", "snow-cover-daily",
];

serve(async (req) => {
  // Cache request data before any async work — request object can become invalid
  // when concurrent calls arrive
  try {
    req.headers.get('authorization');
  } catch {
    console.error('[hunt-correlation-engine] Cannot read headers: request closed before processing');
    return new Response(JSON.stringify({ error: 'Request closed before processing' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();
    const today = new Date().toISOString().split("T")[0];

    // Step 1: Pick 10 random recent entries as "seeds"
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: seeds, error: seedError } = await supabase
      .from("hunt_knowledge")
      .select("id, title, content, content_type, state_abbr, species, effective_date, embedding")
      .in("content_type", SEED_TYPES)
      .gte("created_at", sevenDaysAgo.toISOString())
      .order("signal_weight", { ascending: false })
      .limit(50);

    if (seedError || !seeds || seeds.length === 0) {
      await logCronRun({
        functionName: "hunt-correlation-engine",
        status: "success",
        summary: { seeds: 0, correlations: 0, reason: "no recent data" },
        durationMs: Date.now() - startTime,
      });
      return successResponse(req, { correlations: 0, reason: "no recent data" });
    }

    // Pick 3 random seeds (reduced from 10 to stay within 150s timeout)
    const shuffled = seeds.sort(() => Math.random() - 0.5).slice(0, 3);

    let totalCorrelations = 0;
    let errors = 0;
    const correlationEntries: Array<{ text: string; meta: Record<string, any> }> = [];

    for (const seed of shuffled) {
      if (!seed.embedding) continue;

      // Parse embedding string to array if needed (Supabase returns vectors as strings)
      const embedding = typeof seed.embedding === 'string'
        ? JSON.parse(seed.embedding)
        : seed.embedding;

      try {
        // Step 2: Vector search for similar entries in OTHER content types
        // Explicitly filter to cross-domain types, excluding the seed's own type
        const targetTypes = CROSS_DOMAIN_TYPES.filter(t => t !== seed.content_type);

        const { data: matches, error: matchError } = await supabase
          .rpc("search_hunt_knowledge_v3", {
            query_embedding: embedding,
            match_threshold: 0.45,
            match_count: 10,
            filter_content_types: targetTypes,
            filter_state_abbr: null,
            filter_species: null,
            filter_date_from: null,
            filter_date_to: null,
            recency_weight: 0.15,
            exclude_du_report: true,
          });

        if (matchError || !matches) continue;

        // All matches are already cross-domain due to the type filter
        const crossDomain = matches.filter(
          (m: any) => m.similarity >= 0.45
        );

        if (crossDomain.length === 0) continue;

        // Step 3: Build correlation entry
        const bestMatch = crossDomain[0];
        const similarity = bestMatch.similarity;

        const text = [
          `correlation-discovered | ${today}`,
          `source: ${seed.content_type} — ${seed.title}`,
          `matches: ${bestMatch.content_type} — ${bestMatch.title}`,
          `similarity:${similarity.toFixed(3)}`,
          `states: ${[seed.state_abbr, bestMatch.state_abbr].filter(Boolean).join(" + ") || "national"}`,
          `species: ${[seed.species, bestMatch.species].filter(Boolean).join(" + ") || "all"}`,
          `Cross-domain pattern: ${seed.content_type} data is ${(similarity * 100).toFixed(0)}% similar to ${bestMatch.content_type} data. These signals may be driven by the same underlying environmental conditions.`,
          `Source content: ${(seed.content || "").slice(0, 150)}`,
          `Match content: ${(bestMatch.content || "").slice(0, 150)}`,
        ].join(" | ");

        correlationEntries.push({
          text,
          meta: {
            title: `correlation ${seed.content_type}-${bestMatch.content_type} ${seed.state_abbr || "US"} ${today}`,
            content: text,
            content_type: "correlation-discovery",
            tags: [
              seed.content_type, bestMatch.content_type,
              "correlation", "cross-domain", "pattern-discovery",
              seed.state_abbr, bestMatch.state_abbr,
            ].filter(Boolean) as string[],
            species: seed.species || bestMatch.species || null,
            state_abbr: seed.state_abbr || bestMatch.state_abbr || null,
            effective_date: today,
            metadata: {
              source: "correlation-engine",
              seed_id: seed.id,
              seed_type: seed.content_type,
              seed_title: seed.title,
              match_type: bestMatch.content_type,
              match_title: bestMatch.title,
              similarity,
              cross_domain_matches: crossDomain.length,
            },
          },
        });

        totalCorrelations++;
        console.log(`  CORR: ${seed.content_type} ↔ ${bestMatch.content_type} (${(similarity * 100).toFixed(0)}%) in ${seed.state_abbr || "US"}`);

      } catch (err) {
        console.error(`  Seed ${seed.id}: ${err}`);
        errors++;
      }
    }

    // Embed and upsert correlations
    let totalEmbedded = 0;
    for (let i = 0; i < correlationEntries.length; i += 20) {
      const chunk = correlationEntries.slice(i, i + 20);
      const texts = chunk.map(e => e.text);
      const embeddings = await batchEmbed(texts);
      const rows = chunk.map((e, j) => ({
        ...e.meta,
        embedding: embeddings[j],
      }));

      const { error: insertError } = await supabase
        .from("hunt_knowledge")
        .insert(rows);

      if (insertError) {
        console.error(`Insert error: ${insertError.message}`);
        errors++;
      } else {
        totalEmbedded += rows.length;
      }
    }

    const durationMs = Date.now() - startTime;
    await logCronRun({
      functionName: "hunt-correlation-engine",
      status: errors > 0 ? "partial" : "success",
      summary: { seeds_checked: shuffled.length, correlations: totalCorrelations, embedded: totalEmbedded, errors },
      durationMs,
    });

    return successResponse(req, { seeds: shuffled.length, correlations: totalCorrelations, embedded: totalEmbedded, errors, durationMs });

  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errMsg = String(err);
    console.error("Fatal:", errMsg);
    await logCronRun({
      functionName: "hunt-correlation-engine",
      status: "error",
      errorMessage: errMsg,
      durationMs,
    }).catch(() => {});
    try {
      return errorResponse(req, errMsg, 500);
    } catch {
      return new Response(JSON.stringify({ error: errMsg }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
});
