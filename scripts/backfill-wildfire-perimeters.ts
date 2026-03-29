/**
 * Backfill wildfire perimeters into hunt_knowledge
 * Fetches historical fire perimeters (2021-2025) from WFIGS ArcGIS API,
 * embeds via Voyage AI, stores in hunt_knowledge.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-wildfire-perimeters.ts
 *
 * Optional env:
 *   START_YEAR=2023   — resume from this year
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;

if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}

const USE_EDGE_FN = !VOYAGE_KEY;
if (USE_EDGE_FN) console.log("No VOYAGE_API_KEY — using hunt-generate-embedding edge function (slower)");

const START_YEAR = parseInt(process.env.START_YEAR || "2021", 10);

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY!,
  "Content-Type": "application/json",
};

const YEARS = [2021, 2022, 2023, 2024, 2025];
const PAGE_SIZE = 200;
const API_URL = "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters/FeatureServer/0/query";

// ---------- Helpers ----------

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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

// ---------- Embedding ----------

async function embedViaEdgeFn(text: string, retries = 3): Promise<number[]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/hunt-generate-embedding`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text, input_type: "document" }),
      });
      if (res.ok) { const data = await res.json(); return data.embedding; }
      if (res.status >= 500 && attempt < retries - 1) { await delay((attempt + 1) * 5000); continue; }
      throw new Error(`Edge fn error: ${res.status} ${await res.text()}`);
    } catch (err) {
      if (attempt < retries - 1) { await delay((attempt + 1) * 10000); continue; }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

async function batchEmbed(texts: string[], retries = 3): Promise<number[][]> {
  if (USE_EDGE_FN) {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await embedViaEdgeFn(text, retries));
      await delay(100);
    }
    return results;
  }
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${VOYAGE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "voyage-3-lite", input: texts, input_type: "document" }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.data.map((d: { embedding: number[] }) => d.embedding);
      }
      if (res.status === 429 && attempt < retries - 1) { await delay((attempt + 1) * 30000); continue; }
      if (res.status >= 500 && attempt < retries - 1) { await delay((attempt + 1) * 5000); continue; }
      throw new Error(`Voyage error: ${res.status} ${await res.text()}`);
    } catch (err) {
      if (attempt < retries - 1) { await delay((attempt + 1) * 10000); continue; }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

// ---------- Supabase insert ----------

async function insertBatch(rows: Record<string, any>[]) {
  for (let i = 0; i < rows.length; i += 20) {
    const chunk = rows.slice(i, i + 20);
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge`, {
        method: "POST",
        headers: { ...supaHeaders, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(chunk),
      });
      if (res.ok) break;
      if (res.status >= 400 && res.status < 500) {
        const text = await res.text();
        console.error(`  Insert 4xx (not retrying): ${res.status} ${text}`);
        break;
      }
      if (attempt < 2) {
        console.log(`  Insert retry ${attempt + 1}/3...`);
        await delay(5000);
        continue;
      }
      const text = await res.text();
      console.error(`  Insert batch failed after retries: ${text}`);
    }
  }
}

// ---------- Fetch one page ----------

async function fetchPage(year: number, offset: number): Promise<any[]> {
  // ArcGIS requires TIMESTAMP keyword for date comparisons
  const where = `attr_FireDiscoveryDateTime >= TIMESTAMP '${year}-01-01 00:00:00' AND attr_FireDiscoveryDateTime < TIMESTAMP '${year + 1}-01-01 00:00:00'`;
  const params = new URLSearchParams({
    where,
    outFields: "*",
    resultRecordCount: String(PAGE_SIZE),
    resultOffset: String(offset),
    returnGeometry: "false",
    f: "json",
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${API_URL}?${params}`);
      if (res.ok) {
        const data = await res.json();
        return (data.features || []).map((f: any) => ({ properties: f.attributes }));
      }
      if (res.status === 429 && attempt < 2) {
        console.log(`    Rate limited, waiting ${(attempt + 1) * 30}s...`);
        await delay((attempt + 1) * 30000);
        continue;
      }
      if (res.status >= 500 && attempt < 2) {
        console.log(`    Server error ${res.status}, retry ${attempt + 1}/3...`);
        await delay((attempt + 1) * 5000);
        continue;
      }
      throw new Error(`WFIGS API error: ${res.status} ${await res.text()}`);
    } catch (err) {
      if (attempt < 2) {
        console.log(`    Fetch failed (${(err as Error).message}), retry ${attempt + 1}/3...`);
        await delay((attempt + 1) * 10000);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

// ---------- Process one year ----------

async function backfillYear(year: number): Promise<number> {
  console.log(`\n--- ${year} ---`);
  let offset = 0;
  let totalInserted = 0;

  while (true) {
    const features = await fetchPage(year, offset);
    if (features.length === 0) break;

    console.log(`  Page offset=${offset}: ${features.length} fires`);

    const rows: Array<{ text: string; meta: Record<string, any> }> = [];

    for (const feature of features) {
      const p = feature.properties || {};
      const name = p.poly_IncidentName || "Unknown";
      const acres = p.poly_Acres_AutoCalc ?? null;
      const pct = p.poly_PercentContained ?? 0;
      const rawState = p.attr_POOState || "";
      const state = rawState.replace("US-", "") || null; // "US-TX" → "TX"
      const irwinId = p.attr_IrwinID;
      const startDate = formatDate(p.attr_FireDiscoveryDateTime);
      const cause = p.attr_FireCause || "unknown";
      const severity = classifySeverity(acres);

      const acresStr = acres != null ? `${Math.round(acres)} acres` : "unknown acres";
      const text = `Wildfire ${name} in ${state}: ${acresStr}, ${pct}% contained, started ${startDate}, cause: ${cause}. ${severity}`;

      const title = irwinId ? `fire-${irwinId}` : `fire-${name}-${state}-${startDate}`;

      rows.push({
        text,
        meta: {
          title,
          content: text,
          content_type: "wildfire-perimeter",
          tags: [state.toLowerCase(), "wildfire", "fire", severity.replace(" ", "-"), "wildfire-perimeter"],
          embedding: null, // filled after embed
          metadata: {
            source: "wfigs-historical",
            incident_name: name,
            irwin_id: irwinId,
            acres,
            percent_contained: pct,
            fire_cause: cause,
            discovery_date: startDate,
            containment_date: formatDate(p.attr_ContainmentDateTime),
            severity,
            year,
          },
          state_abbr: state,
          effective_date: startDate !== "unknown date" ? startDate : `${year}-01-01`,
        },
      });
    }

    // Embed in batches of 20, then insert
    for (let i = 0; i < rows.length; i += 20) {
      const chunk = rows.slice(i, i + 20);
      const texts = chunk.map(r => r.text);

      try {
        const embeddings = await batchEmbed(texts);

        const insertRows = chunk.map((r, j) => ({
          ...r.meta,
          embedding: JSON.stringify(embeddings[j]),
        }));

        await insertBatch(insertRows);
        totalInserted += insertRows.length;
      } catch (err) {
        console.error(`    Embed/insert batch failed: ${err}`);
      }

      if (i + 20 < rows.length) await delay(500);
    }

    offset += features.length;

    // If we got fewer than PAGE_SIZE, we're done with this year
    if (features.length < PAGE_SIZE) break;

    await delay(1000);
  }

  console.log(`  ${year}: ${totalInserted} fires inserted`);
  return totalInserted;
}

// ---------- Main ----------

async function main() {
  console.log("=== Backfilling Wildfire Perimeters ===");
  console.log(`Years: ${START_YEAR}-2025`);

  let total = 0;

  for (const year of YEARS) {
    if (year < START_YEAR) continue;
    try {
      const count = await backfillYear(year);
      total += count;
    } catch (err) {
      console.error(`  FAILED ${year}: ${err}`);
    }
    await delay(2000);
  }

  console.log(`\nDone! Total: ${total} wildfire-perimeter entries`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
