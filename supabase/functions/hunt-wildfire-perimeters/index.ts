import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { logCronRun } from '../_shared/cronLog.ts';
import { cronResponse, cronErrorResponse } from '../_shared/response.ts';

const FUNCTION_NAME = "hunt-wildfire-perimeters";
const CONTENT_TYPE = "wildfire-perimeter";

const API_URL = "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters/FeatureServer/0/query";

interface FireProperties {
  poly_IncidentName: string | null;
  poly_Acres_AutoCalc: number | null;
  poly_PercentContained: number | null;
  attr_IrwinID: string | null;
  attr_POOState: string | null;
  attr_FireDiscoveryDateTime: number | null;
  attr_ContainmentDateTime: number | null;
  attr_FireCause: string | null;
}

function classifySeverity(acres: number | null): string {
  if (acres == null) return "unknown size";
  if (acres >= 100000) return "mega fire";
  if (acres >= 10000) return "large fire";
  return "fire";
}

function formatDate(epoch: number | null): string {
  if (!epoch) return "unknown date";
  return new Date(epoch).toISOString().slice(0, 10);
}

serve(async (req) => {
  const corsResponse_ = handleCors(req);
  if (corsResponse_) return corsResponse_;

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();

    const params = new URLSearchParams({
      where: "1=1",
      outFields: "poly_IncidentName,poly_Acres_AutoCalc,poly_PercentContained,attr_IrwinID,attr_POOState,attr_FireDiscoveryDateTime,attr_ContainmentDateTime,attr_FireCause",
      resultRecordCount: "100",
      orderByFields: "poly_Acres_AutoCalc DESC",
      f: "geojson",
    });

    console.log(`[${FUNCTION_NAME}] Fetching active fire perimeters...`);

    const res = await fetch(`${API_URL}?${params}`);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`WFIGS API error: ${res.status} ${errText}`);
    }

    const geojson = await res.json();
    const features = geojson.features || [];

    console.log(`[${FUNCTION_NAME}] ${features.length} active fires returned`);

    const entries: Array<{ text: string; meta: Record<string, unknown> }> = [];
    let skipped = 0;

    for (const feature of features) {
      const p: FireProperties = feature.properties;
      const name = p.poly_IncidentName || "Unknown";
      const acres = p.poly_Acres_AutoCalc;
      const pct = p.poly_PercentContained ?? 0;
      const state = p.attr_POOState || "US";
      const irwinId = p.attr_IrwinID;
      const startDate = formatDate(p.attr_FireDiscoveryDateTime);
      const cause = p.attr_FireCause || "unknown";
      const severity = classifySeverity(acres);

      if (!irwinId && !name) {
        skipped++;
        continue;
      }

      const acresStr = acres != null ? `${Math.round(acres)} acres` : "unknown acres";
      const text = `Wildfire ${name} in ${state}: ${acresStr}, ${pct}% contained, started ${startDate}, cause: ${cause}. ${severity}`;

      const title = irwinId ? `fire-${irwinId}` : `fire-${name}-${state}-${startDate}`;

      entries.push({
        text,
        meta: {
          title,
          content: text,
          content_type: CONTENT_TYPE,
          tags: [state.toLowerCase(), "wildfire", "fire", severity.replace(" ", "-"), CONTENT_TYPE],
          state_abbr: state,
          effective_date: startDate !== "unknown date" ? startDate : new Date().toISOString().slice(0, 10),
          metadata: {
            source: FUNCTION_NAME,
            incident_name: name,
            irwin_id: irwinId,
            acres,
            percent_contained: pct,
            fire_cause: cause,
            discovery_date: startDate,
            containment_date: formatDate(p.attr_ContainmentDateTime),
            severity,
          },
        },
      });
    }

    console.log(`[${FUNCTION_NAME}] ${entries.length} entries to embed, ${skipped} skipped`);

    if (entries.length === 0) {
      const durationMs = Date.now() - startTime;
      await logCronRun({
        functionName: FUNCTION_NAME,
        status: "success",
        summary: { fires: 0, embedded: 0, skipped },
        durationMs,
      });
      return cronResponse({ fires: 0, embedded: 0, skipped, durationMs });
    }

    // Embed and insert in batches of 20 (Voyage limit)
    let totalEmbedded = 0;
    let errors = 0;

    for (let i = 0; i < entries.length; i += 20) {
      const chunk = entries.slice(i, i + 20);
      const texts = chunk.map(e => e.text);

      try {
        const embeddings = await batchEmbed(texts);

        const rows = chunk.map((e, j) => ({
          ...e.meta,
          embedding: embeddings[j],
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
      } catch (err) {
        console.error(`  Embed/insert batch error: ${err}`);
        errors++;
      }
    }

    const durationMs = Date.now() - startTime;
    const status = errors > 0 ? (totalEmbedded > 0 ? "partial" : "error") : "success";

    await logCronRun({
      functionName: FUNCTION_NAME,
      status,
      summary: { fires: features.length, embedded: totalEmbedded, skipped, errors },
      durationMs,
    });

    return cronResponse({ fires: features.length, embedded: totalEmbedded, skipped, errors, durationMs });

  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error("Fatal:", err);
    await logCronRun({
      functionName: FUNCTION_NAME,
      status: "error",
      errorMessage: String(err),
      durationMs,
    });
    return cronErrorResponse(String(err), 500);
  }
});
