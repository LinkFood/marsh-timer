/**
 * Backfill NIFC wildfire/prescribed burn data from ArcGIS REST API.
 * Fires create or destroy habitat — prescribed burns attract dove/turkey within days.
 *
 * Source: https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters/FeatureServer/0
 * No auth required. Returns fire perimeters with state, cause, acres, dates.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/backfill-nifc-fires.ts
 *
 * Resume:
 *   START_STATE=TX  — skip states before TX alphabetically
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;

if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }
const USE_EDGE_FN = !VOYAGE_KEY;
if (USE_EDGE_FN) console.log("No VOYAGE_API_KEY — using edge function (slower)");

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY!,
  "Content-Type": "application/json",
};

const NIFC_BASE = "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters/FeatureServer/0/query";

const STATE_CODES: Record<string, string> = {
  AL: "US-AL", AK: "US-AK", AZ: "US-AZ", AR: "US-AR", CA: "US-CA",
  CO: "US-CO", CT: "US-CT", DE: "US-DE", FL: "US-FL", GA: "US-GA",
  HI: "US-HI", ID: "US-ID", IL: "US-IL", IN: "US-IN", IA: "US-IA",
  KS: "US-KS", KY: "US-KY", LA: "US-LA", ME: "US-ME", MD: "US-MD",
  MA: "US-MA", MI: "US-MI", MN: "US-MN", MS: "US-MS", MO: "US-MO",
  MT: "US-MT", NE: "US-NE", NV: "US-NV", NH: "US-NH", NJ: "US-NJ",
  NM: "US-NM", NY: "US-NY", NC: "US-NC", ND: "US-ND", OH: "US-OH",
  OK: "US-OK", OR: "US-OR", PA: "US-PA", RI: "US-RI", SC: "US-SC",
  SD: "US-SD", TN: "US-TN", TX: "US-TX", UT: "US-UT", VT: "US-VT",
  VA: "US-VA", WA: "US-WA", WV: "US-WV", WI: "US-WI", WY: "US-WY",
};

const STATE_ABBRS = Object.keys(STATE_CODES).sort();

// --- Embedding helpers ---

async function embedViaEdgeFn(text: string, retries = 3): Promise<number[]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/hunt-generate-embedding`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text, input_type: "document" }),
      });
      if (res.ok) return (await res.json()).embedding;
      if (res.status >= 500 && attempt < retries - 1) {
        await new Promise(r => setTimeout(r, (attempt + 1) * 5000));
        continue;
      }
      throw new Error(`Edge fn: ${res.status}`);
    } catch (err) {
      if (attempt < retries - 1) { await new Promise(r => setTimeout(r, (attempt + 1) * 10000)); continue; }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

async function batchEmbed(texts: string[]): Promise<number[][]> {
  if (USE_EDGE_FN) {
    const results: number[][] = [];
    for (const t of texts) { results.push(await embedViaEdgeFn(t)); await new Promise(r => setTimeout(r, 100)); }
    return results;
  }
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${VOYAGE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "voyage-3-lite", input: texts, input_type: "document" }),
  });
  if (!res.ok) throw new Error(`Voyage: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.data.map((d: { embedding: number[] }) => d.embedding);
}

async function insertBatch(rows: any[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 20) {
    const chunk = rows.slice(i, i + 20);
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge`, {
        method: "POST",
        headers: { ...supaHeaders, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(chunk),
      });
      if (res.ok) break;
      if (attempt < 2) { await new Promise(r => setTimeout(r, 5000)); continue; }
      console.error(`  Insert failed: ${await res.text()}`);
    }
  }
}

// --- Fire data ---

interface FireRecord {
  poly_IncidentName: string;
  poly_GISAcres: number;
  attr_POOState: string;
  attr_POOCounty: string | null;
  attr_FireCauseGeneral: string | null;
  attr_FireDiscoveryDateTime: number | null;
  attr_FireOutDateTime: number | null;
}

async function fetchFires(stateCode: string): Promise<FireRecord[]> {
  const fields = "poly_IncidentName,poly_GISAcres,attr_POOState,attr_POOCounty,attr_FireCauseGeneral,attr_FireDiscoveryDateTime,attr_FireOutDateTime";
  const where = encodeURIComponent(`attr_POOState='${stateCode}'`);
  const url = `${NIFC_BASE}?where=${where}&outFields=${fields}&f=json&resultRecordCount=2000&returnGeometry=false&orderByFields=attr_FireDiscoveryDateTime+DESC`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.error) { console.warn(`  ArcGIS error: ${data.error.message}`); return []; }
        return (data.features || []).map((f: any) => f.attributes as FireRecord);
      }
      if (attempt < 2) { await new Promise(r => setTimeout(r, 5000)); continue; }
      return [];
    } catch (err) {
      if (attempt < 2) { await new Promise(r => setTimeout(r, 5000)); continue; }
      console.warn(`  Fetch error: ${err}`);
      return [];
    }
  }
  return [];
}

function formatDate(ms: number | null): string {
  if (!ms) return "unknown";
  return new Date(ms).toISOString().slice(0, 10);
}

function fireImpact(acres: number, cause: string | null): string {
  const isPrescribed = cause?.toLowerCase().includes("prescribed") || cause?.toLowerCase().includes("debris");
  if (isPrescribed) {
    if (acres > 1000) return "large prescribed burn — creates prime dove/turkey feeding habitat within days, draws game from miles around";
    return "prescribed burn — clears understory, promotes new growth, attracts insects and ground-feeding birds";
  }
  if (acres > 10000) return "major wildfire — displaces game long-term, alters migration patterns, creates new browse in recovery";
  if (acres > 1000) return "significant wildfire — temporary game displacement, adjacent areas see increased activity";
  return "small fire — localized habitat disturbance, may concentrate game at edges";
}

// --- Main ---

async function main() {
  const START_STATE = process.env.START_STATE || null;

  console.log("=== Backfill NIFC Fire Activity ===");
  console.log(`States: ${STATE_ABBRS.length}`);
  if (START_STATE) console.log(`Resuming from: ${START_STATE}`);

  let globalCount = 0;
  let skippingState = !!START_STATE;

  for (const abbr of STATE_ABBRS) {
    if (skippingState) {
      if (abbr === START_STATE) skippingState = false;
      else { console.log(`Skipping ${abbr}`); continue; }
    }

    console.log(`\n${abbr}:`);

    try {
      const fires = await fetchFires(STATE_CODES[abbr]);
      if (fires.length === 0) { console.log(`  No fires found`); continue; }

      // Filter to fires > 10 acres to keep signal high
      const significant = fires.filter(f => f.poly_GISAcres >= 10);
      console.log(`  ${fires.length} fires total, ${significant.length} significant (>10 acres)`);

      let batchTexts: string[] = [];
      let batchMeta: any[] = [];
      let pendingRows: any[] = [];
      let stateCount = 0;

      for (const fire of significant) {
        const dateStr = formatDate(fire.attr_FireDiscoveryDateTime);
        const acres = Math.round(fire.poly_GISAcres);
        const cause = fire.attr_FireCauseGeneral || "unknown";
        const impact = fireImpact(fire.poly_GISAcres, fire.attr_FireCauseGeneral);
        const name = fire.poly_IncidentName || "Unnamed";
        const county = fire.attr_POOCounty || "unknown";

        const embedText = `fire-activity | ${abbr} | ${dateStr} | ${name} | ${acres}ac | cause:${cause} | county:${county} | impact: ${impact}`;

        batchTexts.push(embedText);
        batchMeta.push({
          title: `${abbr} fire ${name} ${dateStr}`,
          content: embedText,
          content_type: "fire-activity",
          tags: [abbr, "fire", "habitat", "prescribed-burn", "wildlife-movement"],
          state_abbr: abbr,
          species: null,
          effective_date: dateStr === "unknown" ? null : dateStr,
          metadata: {
            source: "nifc",
            fire_name: name,
            acres,
            cause,
            county,
            discovery_date: dateStr,
            out_date: formatDate(fire.attr_FireOutDateTime),
          },
        });

        if (batchTexts.length === 20) {
          const embeddings = await batchEmbed(batchTexts);
          for (let j = 0; j < batchMeta.length; j++) {
            pendingRows.push({ ...batchMeta[j], embedding: JSON.stringify(embeddings[j]) });
          }
          stateCount += batchMeta.length;
          globalCount += batchMeta.length;
          console.log(`  ${stateCount} fires embedded (${globalCount} total)`);
          batchTexts = [];
          batchMeta = [];

          if (pendingRows.length >= 50) {
            await insertBatch(pendingRows);
            pendingRows = [];
          }
          await new Promise(r => setTimeout(r, 300));
        }
      }

      // Flush
      if (batchTexts.length > 0) {
        const embeddings = await batchEmbed(batchTexts);
        for (let j = 0; j < batchMeta.length; j++) {
          pendingRows.push({ ...batchMeta[j], embedding: JSON.stringify(embeddings[j]) });
        }
        stateCount += batchMeta.length;
        globalCount += batchMeta.length;
      }
      if (pendingRows.length > 0) await insertBatch(pendingRows);

      console.log(`  ${abbr} done: ${stateCount} entries`);
      await new Promise(r => setTimeout(r, 500));

    } catch (err) {
      console.error(`  ${abbr} FAILED: ${err}`);
    }
  }

  console.log(`\n=== Complete: ${globalCount} fire entries embedded ===`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
