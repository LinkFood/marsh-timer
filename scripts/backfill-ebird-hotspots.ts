/**
 * Backfill eBird top hotspots per state with species counts.
 * Embeds the top 100 hotspots per state ranked by numSpeciesAllTime.
 *
 * Source: https://api.ebird.org/v2/ref/hotspot/ (key required, 100 req/hr)
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... EBIRD_API_KEY=ql314ikts0me npx tsx scripts/backfill-ebird-hotspots.ts
 *
 * Resume:
 *   START_STATE=TX
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;
const EBIRD_KEY = process.env.EBIRD_API_KEY;

if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }
if (!EBIRD_KEY) { console.error("EBIRD_API_KEY required"); process.exit(1); }
const USE_EDGE_FN = !VOYAGE_KEY;
if (USE_EDGE_FN) console.log("No VOYAGE_API_KEY — using edge function (slower)");

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY!,
  "Content-Type": "application/json",
};

const STATE_ABBRS = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

async function embedViaEdgeFn(text: string, retries = 3): Promise<number[]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/hunt-generate-embedding`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text, input_type: "document" }),
      });
      if (res.ok) return (await res.json()).embedding;
      if (res.status >= 500 && attempt < retries - 1) { await new Promise(r => setTimeout(r, (attempt + 1) * 5000)); continue; }
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
  if (!res.ok) throw new Error(`Voyage: ${res.status}`);
  return (await res.json()).data.map((d: any) => d.embedding);
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

interface Hotspot {
  locId: string;
  locName: string;
  countryCode: string;
  subnational1Code: string;
  lat: number;
  lng: number;
  numSpeciesAllTime: number;
}

async function fetchHotspots(stateAbbr: string): Promise<Hotspot[]> {
  const url = `https://api.ebird.org/v2/ref/hotspot/US-${stateAbbr}?fmt=json`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "X-eBirdApiToken": EBIRD_KEY! } });
      if (res.ok) return await res.json();
      if (res.status === 429) {
        console.log(`  Rate limited, waiting 60s...`);
        await new Promise(r => setTimeout(r, 60000));
        continue;
      }
      if (res.status >= 500 && attempt < 2) { await new Promise(r => setTimeout(r, 5000)); continue; }
      return [];
    } catch (err) {
      if (attempt < 2) { await new Promise(r => setTimeout(r, 5000)); continue; }
      return [];
    }
  }
  return [];
}

function hotspotTier(numSpecies: number): string {
  if (numSpecies >= 300) return "elite";
  if (numSpecies >= 200) return "premier";
  if (numSpecies >= 100) return "strong";
  if (numSpecies >= 50) return "moderate";
  return "developing";
}

async function main() {
  const START_STATE = process.env.START_STATE || null;
  const TOP_N = 100; // top 100 hotspots per state

  console.log("=== Backfill eBird Hotspots ===");
  console.log(`States: ${STATE_ABBRS.length} | Top ${TOP_N} per state`);
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
      const all = await fetchHotspots(abbr);
      if (all.length === 0) { console.log(`  No hotspots`); continue; }

      // Sort by species count, take top N
      const top = all
        .filter(h => h.numSpeciesAllTime > 0)
        .sort((a, b) => b.numSpeciesAllTime - a.numSpeciesAllTime)
        .slice(0, TOP_N);

      console.log(`  ${all.length} total hotspots, embedding top ${top.length}`);

      let batchTexts: string[] = [];
      let batchMeta: any[] = [];
      let pendingRows: any[] = [];
      let stateCount = 0;

      for (let i = 0; i < top.length; i++) {
        const h = top[i];
        const rank = i + 1;
        const tier = hotspotTier(h.numSpeciesAllTime);

        const embedText = `ebird-hotspot | ${abbr} | rank:${rank}/${top.length} | ${h.locName} | species:${h.numSpeciesAllTime} | tier:${tier} | lat:${h.lat.toFixed(3)} lng:${h.lng.toFixed(3)}`;

        batchTexts.push(embedText);
        batchMeta.push({
          title: `${abbr} ebird hotspot ${h.locId}`,
          content: embedText,
          content_type: "ebird-hotspot",
          tags: [abbr, "ebird", "hotspot", "birding", tier],
          state_abbr: abbr,
          species: null,
          effective_date: new Date().toISOString().slice(0, 10),
          metadata: {
            source: "ebird",
            loc_id: h.locId,
            loc_name: h.locName,
            lat: h.lat,
            lng: h.lng,
            num_species: h.numSpeciesAllTime,
            rank,
            tier,
          },
        });

        if (batchTexts.length === 20 || i === top.length - 1) {
          const embeddings = await batchEmbed(batchTexts);
          for (let j = 0; j < batchMeta.length; j++) {
            pendingRows.push({ ...batchMeta[j], embedding: JSON.stringify(embeddings[j]) });
          }
          stateCount += batchMeta.length;
          globalCount += batchMeta.length;
          console.log(`  ${stateCount}/${top.length} embedded (${globalCount} total)`);
          batchTexts = [];
          batchMeta = [];

          if (pendingRows.length >= 50) {
            await insertBatch(pendingRows);
            pendingRows = [];
          }
          await new Promise(r => setTimeout(r, 300));
        }
      }

      if (pendingRows.length > 0) await insertBatch(pendingRows);
      console.log(`  ${abbr} done: ${stateCount} entries`);

      // eBird rate limit: 100 req/hr. Hotspot list is 1 req per state.
      // We have headroom but be polite.
      await new Promise(r => setTimeout(r, 2000));

    } catch (err) {
      console.error(`  ${abbr} FAILED: ${err}`);
    }
  }

  console.log(`\n=== Complete: ${globalCount} hotspot entries embedded ===`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
