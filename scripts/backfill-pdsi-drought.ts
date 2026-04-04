/**
 * Backfill Palmer Drought Severity Index (PDSI) into hunt_knowledge
 * Monthly data by state from NOAA NCEI Climate at a Glance, 1895-2025.
 * THE DUST BOWL PIPE.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-pdsi-drought.ts
 *
 * Resume support:
 *   START_STATE=OK  — skip states alphabetically before OK
 */

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;

if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}
if (!VOYAGE_KEY) {
  console.error("VOYAGE_API_KEY required");
  process.exit(1);
}

const START_STATE = process.env.START_STATE?.toUpperCase() || null;

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY!,
  "Content-Type": "application/json",
};

// ---------- State FIPS codes for NOAA CAG API ----------

interface StateInfo {
  abbr: string;
  name: string;
  fips: string;
}

const STATES: StateInfo[] = [
  { abbr: "AL", name: "Alabama", fips: "01" },
  { abbr: "AZ", name: "Arizona", fips: "02" },
  { abbr: "AR", name: "Arkansas", fips: "03" },
  { abbr: "CA", name: "California", fips: "04" },
  { abbr: "CO", name: "Colorado", fips: "05" },
  { abbr: "CT", name: "Connecticut", fips: "06" },
  { abbr: "DE", name: "Delaware", fips: "07" },
  { abbr: "FL", name: "Florida", fips: "08" },
  { abbr: "GA", name: "Georgia", fips: "09" },
  { abbr: "ID", name: "Idaho", fips: "10" },
  { abbr: "IL", name: "Illinois", fips: "11" },
  { abbr: "IN", name: "Indiana", fips: "12" },
  { abbr: "IA", name: "Iowa", fips: "13" },
  { abbr: "KS", name: "Kansas", fips: "14" },
  { abbr: "KY", name: "Kentucky", fips: "15" },
  { abbr: "LA", name: "Louisiana", fips: "16" },
  { abbr: "ME", name: "Maine", fips: "17" },
  { abbr: "MD", name: "Maryland", fips: "18" },
  { abbr: "MA", name: "Massachusetts", fips: "19" },
  { abbr: "MI", name: "Michigan", fips: "20" },
  { abbr: "MN", name: "Minnesota", fips: "21" },
  { abbr: "MS", name: "Mississippi", fips: "22" },
  { abbr: "MO", name: "Missouri", fips: "23" },
  { abbr: "MT", name: "Montana", fips: "24" },
  { abbr: "NE", name: "Nebraska", fips: "25" },
  { abbr: "NV", name: "Nevada", fips: "26" },
  { abbr: "NH", name: "New Hampshire", fips: "27" },
  { abbr: "NJ", name: "New Jersey", fips: "28" },
  { abbr: "NM", name: "New Mexico", fips: "29" },
  { abbr: "NY", name: "New York", fips: "30" },
  { abbr: "NC", name: "North Carolina", fips: "31" },
  { abbr: "ND", name: "North Dakota", fips: "32" },
  { abbr: "OH", name: "Ohio", fips: "33" },
  { abbr: "OK", name: "Oklahoma", fips: "34" },
  { abbr: "OR", name: "Oregon", fips: "35" },
  { abbr: "PA", name: "Pennsylvania", fips: "36" },
  { abbr: "RI", name: "Rhode Island", fips: "37" },
  { abbr: "SC", name: "South Carolina", fips: "38" },
  { abbr: "SD", name: "South Dakota", fips: "39" },
  { abbr: "TN", name: "Tennessee", fips: "40" },
  { abbr: "TX", name: "Texas", fips: "41" },
  { abbr: "UT", name: "Utah", fips: "42" },
  { abbr: "VT", name: "Vermont", fips: "43" },
  { abbr: "VA", name: "Virginia", fips: "44" },
  { abbr: "WA", name: "Washington", fips: "45" },
  { abbr: "WV", name: "West Virginia", fips: "46" },
  { abbr: "WI", name: "Wisconsin", fips: "47" },
  { abbr: "WY", name: "Wyoming", fips: "48" },
  { abbr: "AK", name: "Alaska", fips: "50" },
  { abbr: "HI", name: "Hawaii", fips: "51" },
];

// ---------- PDSI Classification ----------

function classifyPDSI(value: number): { severity: string; tag: string } {
  if (value <= -4) return { severity: "extreme drought", tag: "extreme-drought" };
  if (value <= -3) return { severity: "severe drought", tag: "severe-drought" };
  if (value <= -2) return { severity: "moderate drought", tag: "moderate-drought" };
  if (value <= -1) return { severity: "mild drought", tag: "mild-drought" };
  if (value <= 1) return { severity: "near normal", tag: "near-normal" };
  if (value <= 2) return { severity: "mild wet", tag: "mild-wet" };
  if (value <= 3) return { severity: "moderate wet", tag: "moderate-wet" };
  if (value <= 4) return { severity: "very wet", tag: "very-wet" };
  return { severity: "extremely wet", tag: "extremely-wet" };
}

// ---------- Month names ----------

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function lastDayOfMonth(year: number, month: number): string {
  const d = new Date(year, month, 0);
  return `${year}-${String(month).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------- Helpers ----------

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- Narrative generation ----------

function buildNarrative(
  stateName: string,
  monthName: string,
  year: number,
  pdsiValue: number,
  severity: string,
): string {
  const valueStr = pdsiValue.toFixed(2);

  if (pdsiValue <= -4) {
    return `In ${monthName} ${year}, ${stateName}'s Palmer Drought Severity Index reached ${valueStr}, indicating ${severity} conditions. Severe moisture deficits were devastating agriculture and water supplies across the state, with prolonged below-normal precipitation depleting soil moisture and reservoir levels.`;
  }
  if (pdsiValue <= -3) {
    return `In ${monthName} ${year}, ${stateName}'s Palmer Drought Severity Index was ${valueStr}, indicating ${severity}. Extended dry conditions were stressing crops and rangeland, with rainfall significantly below the long-term average for the region.`;
  }
  if (pdsiValue <= -2) {
    return `In ${monthName} ${year}, ${stateName}'s Palmer Drought Severity Index was ${valueStr}, indicating ${severity}. Below-normal precipitation was beginning to impact agricultural operations and soil moisture levels across the state.`;
  }
  if (pdsiValue <= -1) {
    return `In ${monthName} ${year}, ${stateName}'s Palmer Drought Severity Index was ${valueStr}, indicating ${severity}. Slightly below-normal moisture conditions were present but not yet causing significant agricultural or hydrological impacts.`;
  }
  if (pdsiValue <= 1) {
    return `In ${monthName} ${year}, ${stateName}'s Palmer Drought Severity Index was ${valueStr}, indicating ${severity} moisture conditions with precipitation roughly in line with the long-term average for the season.`;
  }
  if (pdsiValue <= 2) {
    return `In ${monthName} ${year}, ${stateName}'s Palmer Drought Severity Index was ${valueStr}, indicating ${severity} conditions with slightly above-average precipitation for the season.`;
  }
  if (pdsiValue <= 3) {
    return `In ${monthName} ${year}, ${stateName}'s Palmer Drought Severity Index was ${valueStr}, indicating ${severity} conditions. Above-normal precipitation was keeping soil moisture elevated and supporting healthy vegetation growth.`;
  }
  if (pdsiValue <= 4) {
    return `In ${monthName} ${year}, ${stateName}'s Palmer Drought Severity Index was ${valueStr}, indicating ${severity} conditions. Persistent above-normal precipitation was saturating soils and elevating streamflows well above seasonal norms.`;
  }
  return `In ${monthName} ${year}, ${stateName}'s Palmer Drought Severity Index reached ${valueStr}, indicating ${severity} conditions. Exceptional precipitation surplus was causing widespread soil saturation, elevated flood risk, and potential agricultural disruption from waterlogged fields.`;
}

// ---------- Embedding ----------

async function batchEmbed(texts: string[], retries = 3): Promise<number[][]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${VOYAGE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "voyage-3-lite",
          input: texts,
          input_type: "document",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.data.map((d: { embedding: number[] }) => d.embedding);
      }
      if (res.status === 429 && attempt < retries - 1) {
        await delay((attempt + 1) * 30000);
        continue;
      }
      if (res.status >= 500 && attempt < retries - 1) {
        await delay((attempt + 1) * 5000);
        continue;
      }
      throw new Error(`Voyage error: ${res.status} ${await res.text()}`);
    } catch (err) {
      if (attempt < retries - 1) {
        await delay((attempt + 1) * 10000);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

// ---------- Supabase upsert ----------

async function insertBatch(rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += 20) {
    const chunk = rows.slice(i, i + 20);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
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
        console.error(`  Insert failed after retries: ${text}`);
      } catch (err) {
        if (attempt < 2) {
          await delay(5000);
          continue;
        }
        console.error(`  Insert fetch failed after retries: ${err}`);
      }
    }
  }
}

// ---------- Fetch PDSI data for a state ----------

interface PDSIRecord {
  date: string; // "189501" format (YYYYMM)
  value: string;
  anomaly?: string;
}

async function fetchPDSIForState(state: StateInfo): Promise<PDSIRecord[]> {
  // NOAA CAG returns JSON with a "data" object keyed by YYYYMM
  const url = `https://www.ncei.noaa.gov/cag/statewide/time-series/${state.fips}/pdsi/all/1/1895-2025?base_prd=true&begbaseyear=1901&endbaseyear=2000`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  const res = await fetch(url, { signal: controller.signal });
  clearTimeout(timeout);

  if (!res.ok) {
    throw new Error(`NOAA CAG error for ${state.abbr}: ${res.status}`);
  }

  const text = await res.text();

  // The response may be JSON or may have a JSON body after some header
  // Try to parse as JSON first
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    // Try to find JSON object in the response
    const jsonStart = text.indexOf("{");
    if (jsonStart === -1) throw new Error(`No JSON found for ${state.abbr}`);
    json = JSON.parse(text.slice(jsonStart));
  }

  // The data is in json.data as an object keyed by YYYYMM
  const dataObj = json.data;
  if (!dataObj || typeof dataObj !== "object") {
    throw new Error(`No data object in response for ${state.abbr}`);
  }

  const records: PDSIRecord[] = [];
  for (const [dateKey, entry] of Object.entries(dataObj)) {
    const rec = entry as any;
    if (rec.value !== undefined && rec.value !== null && rec.value !== "-99.99" && rec.value !== "-99.9") {
      records.push({
        date: dateKey,
        value: String(rec.value),
        anomaly: rec.anomaly ? String(rec.anomaly) : undefined,
      });
    }
  }

  return records;
}

// ---------- Build entry ----------

interface PreparedEntry {
  title: string;
  content: string;
  content_type: string;
  tags: string[];
  state_abbr: string;
  species: null;
  effective_date: string;
  metadata: Record<string, unknown>;
  embedText: string;
}

function buildEntry(
  state: StateInfo,
  record: PDSIRecord,
): PreparedEntry | null {
  const dateStr = record.date;
  if (dateStr.length < 6) return null;

  const year = parseInt(dateStr.slice(0, 4), 10);
  const month = parseInt(dateStr.slice(4, 6), 10);
  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) return null;

  const pdsiValue = parseFloat(record.value);
  if (isNaN(pdsiValue)) return null;

  const { severity, tag: severityTag } = classifyPDSI(pdsiValue);
  const monthName = MONTH_NAMES[month];
  const effectiveDate = lastDayOfMonth(year, month);

  const narrative = buildNarrative(state.name, monthName, year, pdsiValue, severity);
  const title = `PDSI ${state.name} ${monthName} ${year}: ${pdsiValue.toFixed(2)} (${severity})`;

  const content = `drought-index | ${state.abbr} | ${effectiveDate} | pdsi:${pdsiValue.toFixed(2)} | ${severity} | ${narrative}`;

  const tags = [state.abbr, "drought", "pdsi", "climate", severityTag];

  return {
    title,
    content,
    content_type: "drought-index",
    tags,
    state_abbr: state.abbr,
    species: null,
    effective_date: effectiveDate,
    metadata: {
      source: "noaa-ncei-cag",
      pdsi_value: pdsiValue,
      severity,
      month,
      year,
      anomaly: record.anomaly ? parseFloat(record.anomaly) : null,
    },
    embedText: content,
  };
}

// ---------- Process entries (embed + insert) ----------

async function processEntries(entries: PreparedEntry[]): Promise<number> {
  let inserted = 0;

  for (let i = 0; i < entries.length; i += 20) {
    const batch = entries.slice(i, i + 20);
    const texts = batch.map((e) => e.embedText);

    let embeddings: number[][];
    try {
      embeddings = await batchEmbed(texts);
    } catch (err) {
      console.error(`    Embed batch failed, skipping ${batch.length} entries: ${err}`);
      continue;
    }

    const rows = batch.map((e, idx) => ({
      title: e.title,
      content: e.content,
      content_type: e.content_type,
      tags: e.tags,
      state_abbr: e.state_abbr,
      species: e.species,
      effective_date: e.effective_date,
      metadata: e.metadata,
      embedding: JSON.stringify(embeddings[idx]),
    }));

    await insertBatch(rows);
    inserted += rows.length;

    await delay(500);
  }

  return inserted;
}

// ---------- Main ----------

async function main() {
  console.log("=== PDSI Drought Index Backfill ===");
  console.log("Source: NOAA NCEI Climate at a Glance");
  console.log("Period: 1895-2025, monthly by state");
  if (START_STATE) console.log(`Resuming from state: ${START_STATE}`);

  let totalInserted = 0;
  let skipping = !!START_STATE;

  for (const state of STATES) {
    if (skipping) {
      if (state.abbr === START_STATE) {
        skipping = false;
      } else {
        console.log(`  Skipping ${state.abbr} (before START_STATE=${START_STATE})`);
        continue;
      }
    }

    console.log(`\n--- ${state.name} (${state.abbr}, FIPS ${state.fips}) ---`);

    let records: PDSIRecord[];
    try {
      records = await fetchPDSIForState(state);
    } catch (err) {
      console.error(`  Fetch failed for ${state.abbr}: ${err}`);
      continue;
    }

    console.log(`  ${records.length} monthly PDSI records fetched`);
    if (records.length === 0) continue;

    const entries: PreparedEntry[] = [];
    for (const record of records) {
      const entry = buildEntry(state, record);
      if (entry) entries.push(entry);
    }

    console.log(`  ${entries.length} entries to embed`);
    if (entries.length === 0) continue;

    try {
      const inserted = await processEntries(entries);
      totalInserted += inserted;
      console.log(`  ${state.abbr}: ${inserted}/${entries.length} entries embedded and inserted`);
    } catch (err) {
      console.error(`  ${state.abbr}: embed/insert failed (continuing): ${err}`);
    }

    // Rate limit between states — NOAA is polite but let's not hammer
    await delay(2000);
  }

  console.log(`\n=== Done! Total: ${totalInserted} entries inserted ===`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
