import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { logCronRun } from '../_shared/cronLog.ts';

// Anomaly Detector: scans recent brain entries for statistical outliers.
// Compares today's values against historical baselines.
// When a signal deviates 2+ sigma, embed an anomaly alert into the brain.

interface AnomalyCheck {
  name: string;
  contentType: string;
  valueField: string; // JSON path in metadata
  groupBy: string; // "state_abbr" or "species" or null
  lookbackDays: number;
  minDataPoints: number;
  sigmaThreshold: number;
}

const CHECKS: AnomalyCheck[] = [
  {
    name: "Convergence Score Spike",
    contentType: "convergence-score",
    valueField: "score",
    groupBy: "state_abbr",
    lookbackDays: 14,
    minDataPoints: 7,
    sigmaThreshold: 2.0,
  },
  {
    name: "BirdWeather Detection Surge",
    contentType: "birdweather-acoustic",
    valueField: "detection_count",
    groupBy: "species",
    lookbackDays: 14,
    minDataPoints: 5,
    sigmaThreshold: 2.0,
  },
  {
    name: "Weather Event Cluster",
    contentType: "weather-realtime",
    valueField: null as any, // count-based, not value-based
    groupBy: "state_abbr",
    lookbackDays: 7,
    minDataPoints: 3,
    sigmaThreshold: 2.0,
  },
  {
    name: "Migration Spike",
    contentType: "migration-spike",
    valueField: "spike_pct",
    groupBy: "state_abbr",
    lookbackDays: 14,
    minDataPoints: 5,
    sigmaThreshold: 1.5,
  },
];

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values: number[]): number {
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();
    const today = new Date().toISOString().split("T")[0];
    const anomalies: Array<{ text: string; meta: Record<string, any> }> = [];
    let errors = 0;

    for (const check of CHECKS) {
      try {
        console.log(`Checking: ${check.name}...`);

        // Get recent entries for this content type
        const since = new Date();
        since.setDate(since.getDate() - check.lookbackDays);
        const sinceStr = since.toISOString();

        const { data: entries, error: fetchError } = await supabase
          .from("hunt_knowledge")
          .select("metadata, state_abbr, species, effective_date, created_at")
          .eq("content_type", check.contentType)
          .gte("created_at", sinceStr)
          .order("created_at", { ascending: false })
          .limit(500);

        if (fetchError || !entries || entries.length < check.minDataPoints) {
          console.log(`  ${check.name}: insufficient data (${entries?.length || 0} entries)`);
          continue;
        }

        // Group by the grouping field
        const groups = new Map<string, number[]>();

        for (const entry of entries) {
          const groupKey = check.groupBy === "state_abbr"
            ? entry.state_abbr
            : check.groupBy === "species"
            ? entry.species
            : "all";

          if (!groupKey) continue;

          let value: number;
          if (check.valueField === null) {
            // Count-based: just count entries per group per day
            value = 1;
          } else {
            const meta = entry.metadata as Record<string, any> | null;
            value = meta?.[check.valueField] ?? 0;
            if (typeof value !== "number" || isNaN(value)) continue;
          }

          if (!groups.has(groupKey)) groups.set(groupKey, []);
          groups.get(groupKey)!.push(value);
        }

        // Check each group for anomalies
        for (const [group, values] of groups) {
          if (values.length < check.minDataPoints) continue;

          const latest = values[0]; // most recent
          const historical = values.slice(1); // everything else
          if (historical.length < 3) continue;

          const m = mean(historical);
          const sd = stddev(historical);
          if (sd === 0) continue; // no variance

          const zScore = (latest - m) / sd;

          if (Math.abs(zScore) >= check.sigmaThreshold) {
            const direction = zScore > 0 ? "above" : "below";
            const severity = Math.abs(zScore) >= 3 ? "extreme" : Math.abs(zScore) >= 2.5 ? "high" : "elevated";

            const text = [
              `anomaly-detected | ${check.name}`,
              `group:${group} | date:${today}`,
              `current:${latest.toFixed(1)} | mean:${m.toFixed(1)} | stddev:${sd.toFixed(1)}`,
              `z-score:${zScore.toFixed(2)} | direction:${direction} | severity:${severity}`,
              `${check.name} in ${group} is ${Math.abs(zScore).toFixed(1)} standard deviations ${direction} normal. This is statistically unusual and may indicate emerging activity or changing conditions.`,
            ].join(" | ");

            anomalies.push({
              text,
              meta: {
                title: `anomaly ${check.contentType} ${group} ${today}`,
                content: text,
                content_type: "anomaly-alert",
                tags: [group, "anomaly", severity, check.contentType, direction],
                species: check.groupBy === "species" ? group : null,
                state_abbr: check.groupBy === "state_abbr" ? group : null,
                effective_date: today,
                metadata: {
                  source: "anomaly-detector",
                  check_name: check.name,
                  content_type_checked: check.contentType,
                  group,
                  current_value: latest,
                  historical_mean: m,
                  historical_stddev: sd,
                  z_score: zScore,
                  direction,
                  severity,
                  data_points: values.length,
                },
              },
            });

            console.log(`  ANOMALY: ${group} — ${check.name} z=${zScore.toFixed(2)} (${severity})`);
          }
        }

      } catch (err) {
        console.error(`  ${check.name} error: ${err}`);
        errors++;
      }
    }

    // Embed and upsert anomalies
    let totalEmbedded = 0;
    for (let i = 0; i < anomalies.length; i += 20) {
      const chunk = anomalies.slice(i, i + 20);
      const texts = chunk.map(e => e.text);
      const embeddings = await batchEmbed(texts);
      const rows = chunk.map((e, j) => ({
        ...e.meta,
        embedding: JSON.stringify(embeddings[j]),
      }));

      const { error: upsertError } = await supabase
        .from("hunt_knowledge")
        .upsert(rows, { onConflict: "title" });

      if (upsertError) {
        console.error(`  Upsert error: ${upsertError.message}`);
        errors++;
      } else {
        totalEmbedded += rows.length;
      }
    }

    const durationMs = Date.now() - startTime;
    console.log(`\n${anomalies.length} anomalies detected, ${totalEmbedded} embedded`);

    await logCronRun({
      functionName: "hunt-anomaly-detector",
      status: errors > 0 ? "partial" : "success",
      summary: { anomalies_found: anomalies.length, embedded: totalEmbedded, checks: CHECKS.length, errors },
      durationMs,
    });

    return successResponse(req, { anomalies: anomalies.length, embedded: totalEmbedded, errors, durationMs });

  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error("Fatal:", err);
    await logCronRun({
      functionName: "hunt-anomaly-detector",
      status: "error",
      errorMessage: String(err),
      durationMs,
    });
    return errorResponse(req, String(err), 500);
  }
});
