import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { logCronRun } from '../_shared/cronLog.ts';

// Disaster Watch: compares current climate index values against
// historical pre-disaster signatures discovered on 2026-03-20.
//
// The brain proved that 11/13 major US disasters showed predictive
// signals in AO/NAO/PDO/ENSO/PNA 2-6 months before the event.
// This function checks if current values match those signatures.

interface IndexValue {
  id: string;
  month: string;
  year: number;
  value: number;
}

interface SignatureMatch {
  signature: string;
  description: string;
  confidence: number; // 0-100
  matchedConditions: string[];
  historicalPrecedents: string[];
  leadTime: string;
}

const SIGNATURES = [
  {
    name: "Cold Outbreak / Polar Event",
    description: "AO crash + NAO negative + La Nina = extreme cold/storm event",
    check: (recent: Map<string, number[]>) => {
      const ao = recent.get("AO") || [];
      const nao = recent.get("NAO") || [];
      const enso = recent.get("ENSO") || [];

      const conditions: string[] = [];
      let score = 0;

      // AO crash
      const aoMin = Math.min(...ao.filter(v => v > -9));
      if (aoMin < -2.0) { score += 40; conditions.push(`AO extreme: ${aoMin.toFixed(2)}`); }
      else if (aoMin < -1.5) { score += 25; conditions.push(`AO crash: ${aoMin.toFixed(2)}`); }
      else if (aoMin < -1.0) { score += 10; conditions.push(`AO negative: ${aoMin.toFixed(2)}`); }

      // AO sustained negative (2+ months)
      const aoNegMonths = ao.filter(v => v < -1.0).length;
      if (aoNegMonths >= 2) { score += 20; conditions.push(`AO negative ${aoNegMonths} months`); }

      // NAO negative
      const naoMin = Math.min(...nao.filter(v => v > -9));
      if (naoMin < -1.5) { score += 15; conditions.push(`NAO crash: ${naoMin.toFixed(2)}`); }
      else if (naoMin < -1.0) { score += 5; conditions.push(`NAO negative: ${naoMin.toFixed(2)}`); }

      // La Nina
      const ensoMin = Math.min(...enso.filter(v => v > -9));
      if (ensoMin < -1.0) { score += 15; conditions.push(`La Nina: ${ensoMin.toFixed(2)}`); }
      else if (ensoMin < -0.5) { score += 5; conditions.push(`ENSO trending negative: ${ensoMin.toFixed(2)}`); }

      return {
        signature: "Cold Outbreak / Polar Event",
        description: "Extreme cold, ice storms, polar vortex disruption",
        confidence: Math.min(100, score),
        matchedConditions: conditions,
        historicalPrecedents: ["Texas Freeze 2021", "Snowmageddon 2010", "Super Outbreak 2011", "Polar Vortex 2014"],
        leadTime: "1-4 months",
      };
    },
  },
  {
    name: "Major Hurricane Season",
    description: "PDO extreme + La Nina/transitioning ENSO + NAO negative = active hurricane season",
    check: (recent: Map<string, number[]>) => {
      const pdo = recent.get("PDO") || [];
      const enso = recent.get("ENSO") || [];
      const nao = recent.get("NAO") || [];

      const conditions: string[] = [];
      let score = 0;

      // PDO extreme (either direction)
      const pdoExtremes = pdo.filter(v => Math.abs(v) > 1.5 && v > -9);
      if (pdoExtremes.length >= 3) { score += 35; conditions.push(`PDO extreme ${pdoExtremes.length} months`); }
      else if (pdoExtremes.length >= 1) { score += 15; conditions.push(`PDO extreme ${pdoExtremes.length} month(s)`); }

      const pdoMax = Math.max(...pdo.map(Math.abs).filter(v => v < 9));
      if (pdoMax > 2.5) { score += 15; conditions.push(`PDO peak: ${pdoMax.toFixed(2)}`); }

      // ENSO state
      const ensoAvg = enso.filter(v => v > -9).reduce((a, b) => a + b, 0) / Math.max(1, enso.filter(v => v > -9).length);
      if (ensoAvg < -0.5) { score += 15; conditions.push(`La Nina background: ${ensoAvg.toFixed(2)}`); }
      else if (Math.abs(ensoAvg) < 0.3) { score += 5; conditions.push(`ENSO neutral/transitioning`); }

      // NAO trending negative
      const naoNeg = nao.filter(v => v < -0.5 && v > -9).length;
      if (naoNeg >= 3) { score += 15; conditions.push(`NAO negative trend: ${naoNeg} months`); }

      return {
        signature: "Major Hurricane Season",
        description: "Enhanced Atlantic hurricane activity, potential major landfalls",
        confidence: Math.min(100, score),
        matchedConditions: conditions,
        historicalPrecedents: ["Hurricane Katrina 2005", "Hurricane Sandy 2012", "Hurricane Ian 2022", "Hurricane Ike 2008"],
        leadTime: "3-6 months",
      };
    },
  },
  {
    name: "Major Flooding",
    description: "El Nino + warm PDO + NAO crash = flooding risk",
    check: (recent: Map<string, number[]>) => {
      const enso = recent.get("ENSO") || [];
      const pdo = recent.get("PDO") || [];
      const nao = recent.get("NAO") || [];

      const conditions: string[] = [];
      let score = 0;

      const ensoMax = Math.max(...enso.filter(v => v > -9));
      if (ensoMax > 1.5) { score += 30; conditions.push(`Strong El Nino: ${ensoMax.toFixed(2)}`); }
      else if (ensoMax > 1.0) { score += 15; conditions.push(`El Nino: ${ensoMax.toFixed(2)}`); }
      else if (ensoMax > 0.5) { score += 5; conditions.push(`Weak El Nino: ${ensoMax.toFixed(2)}`); }

      const pdoPos = pdo.filter(v => v > 1.5 && v < 9).length;
      if (pdoPos >= 2) { score += 25; conditions.push(`Warm PDO ${pdoPos} months`); }

      const naoMin = Math.min(...nao.filter(v => v > -9));
      if (naoMin < -1.5) { score += 20; conditions.push(`NAO crash: ${naoMin.toFixed(2)}`); }

      return {
        signature: "Major Flooding",
        description: "Excessive moisture, river flooding, flash floods",
        confidence: Math.min(100, score),
        matchedConditions: conditions,
        historicalPrecedents: ["Louisiana Flood 2016", "Midwest Floods 2019"],
        leadTime: "3-6 months",
      };
    },
  },
  {
    name: "Severe Drought",
    description: "La Nina sustained + negative PDO + AO volatility = drought",
    check: (recent: Map<string, number[]>) => {
      const enso = recent.get("ENSO") || [];
      const pdo = recent.get("PDO") || [];
      const ao = recent.get("AO") || [];

      const conditions: string[] = [];
      let score = 0;

      const ensoNeg = enso.filter(v => v < -0.5 && v > -9).length;
      if (ensoNeg >= 4) { score += 30; conditions.push(`Sustained La Nina: ${ensoNeg} months`); }
      else if (ensoNeg >= 2) { score += 15; conditions.push(`La Nina developing: ${ensoNeg} months`); }

      const pdoNeg = pdo.filter(v => v < -1.0 && v > -9).length;
      if (pdoNeg >= 3) { score += 25; conditions.push(`Negative PDO: ${pdoNeg} months`); }

      // AO volatility (big swings)
      if (ao.length >= 3) {
        const aoFiltered = ao.filter(v => v > -9);
        const aoRange = Math.max(...aoFiltered) - Math.min(...aoFiltered);
        if (aoRange > 3.0) { score += 20; conditions.push(`AO volatile: range ${aoRange.toFixed(1)}`); }
      }

      return {
        signature: "Severe Drought",
        description: "Multi-month drought, agricultural impact, wildfire risk",
        confidence: Math.min(100, score),
        matchedConditions: conditions,
        historicalPrecedents: ["2011 Texas Drought", "2012 US Drought"],
        leadTime: "3-6 months",
      };
    },
  },
];

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();

    // Fetch the most recent 8 months of each index from the brain
    const { data: entries, error: fetchError } = await supabase
      .from("hunt_knowledge")
      .select("title, content, metadata")
      .eq("content_type", "climate-index")
      .order("effective_date", { ascending: false })
      .limit(100);

    if (fetchError || !entries) {
      await logCronRun({
        functionName: "hunt-disaster-watch",
        status: "error",
        errorMessage: fetchError?.message || "No data",
        durationMs: Date.now() - startTime,
      });
      return errorResponse(req, fetchError?.message || "No data", 500);
    }

    // Parse into index → recent values
    const recentValues = new Map<string, number[]>();
    const latestDates = new Map<string, string>();

    for (const entry of entries) {
      const meta = entry.metadata as Record<string, any> | null;
      const indexId = meta?.index_id as string;
      const value = (meta?.value ?? meta?.latest_value) as number;
      const year = meta?.year as number;
      const month = meta?.month as number;
      const period = meta?.latest_period as string || (year && month ? `${year}-${String(month).padStart(2, '0')}` : '');

      if (!indexId || value === undefined || value <= -9) continue;

      const key = indexId.toUpperCase();
      if (!recentValues.has(key)) recentValues.set(key, []);
      const vals = recentValues.get(key)!;
      if (vals.length < 8) vals.push(value);

      if (!latestDates.has(key) || (period && period > (latestDates.get(key) || ""))) {
        latestDates.set(key, period || "");
      }
    }

    console.log("Recent index values loaded:");
    for (const [idx, vals] of recentValues) {
      console.log(`  ${idx}: ${vals.map(v => v.toFixed(2)).join(", ")} (latest: ${latestDates.get(idx)})`);
    }

    // Run all signature checks
    const alerts: SignatureMatch[] = [];
    for (const sig of SIGNATURES) {
      const match = sig.check(recentValues);
      if (match.confidence >= 20) {
        alerts.push(match);
        console.log(`\n  ALERT: ${match.signature} — ${match.confidence}% confidence`);
        for (const c of match.matchedConditions) console.log(`    • ${c}`);
      }
    }

    // Sort by confidence
    alerts.sort((a, b) => b.confidence - a.confidence);

    // Embed alerts into the brain
    let totalEmbedded = 0;
    let errors = 0;
    const today = new Date().toISOString().split("T")[0];

    if (alerts.length > 0) {
      const entries = alerts.map(a => {
        const text = [
          `disaster-watch | ${a.signature} | confidence:${a.confidence}%`,
          `date:${today} | lead_time:${a.leadTime}`,
          `conditions: ${a.matchedConditions.join("; ")}`,
          `description: ${a.description}`,
          `historical precedents: ${a.historicalPrecedents.join(", ")}`,
        ].join(" | ");

        return {
          text,
          meta: {
            title: `disaster-watch ${a.signature.toLowerCase().replace(/\s+/g, "-")} ${today}`,
            content: text,
            content_type: "disaster-watch",
            signal_weight: 2.0,
            tags: ["disaster-watch", "early-warning", "climate-signature", a.signature.toLowerCase().split(" ")[0]],
            species: null,
            state_abbr: null,
            effective_date: today,
            metadata: {
              source: "disaster-watch",
              signature: a.signature,
              confidence: a.confidence,
              conditions: a.matchedConditions,
              precedents: a.historicalPrecedents,
              lead_time: a.leadTime,
              index_snapshot: Object.fromEntries(
                [...recentValues.entries()].map(([k, v]) => [k, v.slice(0, 3)])
              ),
            },
          },
        };
      });

      const texts = entries.map(e => e.text);
      try {
        const embeddings = await batchEmbed(texts);
        const rows = entries.map((e, i) => ({
          ...e.meta,
          embedding: JSON.stringify(embeddings[i]),
        }));

        const { error: upsertError } = await supabase
          .from("hunt_knowledge")
          .upsert(rows, { onConflict: "title" });

        if (upsertError) {
          console.error(`Upsert error: ${upsertError.message}`);
          errors++;
        } else {
          totalEmbedded = rows.length;

          // Track outcomes for grading
          for (const a of alerts) {
            const outcomeDeadline = new Date();
            outcomeDeadline.setUTCHours(outcomeDeadline.getUTCHours() + 168);

            await supabase.from('hunt_alert_outcomes').insert({
              alert_source: 'disaster-watch',
              state_abbr: null,
              alert_date: today,
              predicted_outcome: {
                claim: a.signature,
                expected_signals: ['nws-alert', 'weather-event', 'anomaly-alert'],
                confidence: a.confidence,
                signature_type: a.signature,
                conditions: a.matchedConditions,
              },
              outcome_window_hours: 168,
              outcome_deadline: outcomeDeadline.toISOString(),
            }).catch(err => console.error('[hunt-disaster-watch] Outcome insert failed:', err));
          }
        }
      } catch (err) {
        console.error(`Embed error: ${err}`);
        errors++;
      }
    }

    const durationMs = Date.now() - startTime;
    await logCronRun({
      functionName: "hunt-disaster-watch",
      status: errors > 0 ? "partial" : "success",
      summary: {
        alerts: alerts.map(a => ({ signature: a.signature, confidence: a.confidence })),
        embedded: totalEmbedded,
        indices_checked: recentValues.size,
      },
      durationMs,
    });

    return successResponse(req, {
      alerts: alerts.map(a => ({
        signature: a.signature,
        confidence: a.confidence,
        conditions: a.matchedConditions,
        precedents: a.historicalPrecedents,
        leadTime: a.leadTime,
      })),
      embedded: totalEmbedded,
      errors,
      durationMs,
    });

  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error("Fatal:", err);
    await logCronRun({
      functionName: "hunt-disaster-watch",
      status: "error",
      errorMessage: String(err),
      durationMs,
    });
    return errorResponse(req, String(err), 500);
  }
});
