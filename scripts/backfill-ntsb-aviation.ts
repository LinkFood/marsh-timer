/**
 * Backfill NTSB Aviation Accident Database into hunt_knowledge
 * Every civil aviation accident/incident since 1962.
 *
 * Data source: NTSB CAROL API (paginated JSON)
 * Fallback: Download CSV from https://data.ntsb.gov/avdata/FileDirectory/DownloadFile?fileID=C%3A%5Cavdata%5Cavall.csv
 *           and place at scripts/data/ntsb-aviation.csv
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-ntsb-aviation.ts
 *
 * Resume support:
 *   START_PAGE=50   — skip pages before 50 (API mode)
 *   START_YEAR=1998 — skip years before 1998 (CSV mode)
 *   MODE=csv        — force CSV mode (reads scripts/data/ntsb-aviation.csv)
 *   MODE=api        — force API mode (default, uses NTSB CAROL API)
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

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

const START_PAGE = process.env.START_PAGE
  ? parseInt(process.env.START_PAGE, 10)
  : 1;
const START_YEAR = process.env.START_YEAR
  ? parseInt(process.env.START_YEAR, 10)
  : null;
const MODE = process.env.MODE?.toLowerCase() || "api";

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY!,
  "Content-Type": "application/json",
};

// ---------- State abbreviations ----------

const VALID_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
]);

// ---------- Helpers ----------

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- CSV Parsing ----------

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

// ---------- Severity classification ----------

function classifySeverity(
  fatal: number,
  serious: number,
  eventType: string,
): { severity: string; tag: string } {
  if (fatal > 10) return { severity: "major fatal", tag: "major-fatal" };
  if (fatal > 0) return { severity: "fatal", tag: "fatal" };
  if (serious > 0) return { severity: "serious injury", tag: "serious-injury" };
  if (eventType?.toLowerCase() === "incident") return { severity: "incident", tag: "incident" };
  return { severity: "accident", tag: "accident" };
}

// ---------- Narrative generation ----------

interface AviationRecord {
  eventDate: string;
  city: string;
  state: string;
  country: string;
  airportCode: string;
  eventType: string;
  fatalCount: number;
  seriousCount: number;
  aircraftCategory: string;
  make: string;
  model: string;
  amateurBuilt: boolean;
  numberOfEngines: number;
  weatherCondition: string;
  broadPhaseOfFlight: string;
  reportStatus: string;
  probableCause: string;
}

function buildNarrative(rec: AviationRecord): string {
  const dateObj = new Date(rec.eventDate);
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const month = monthNames[dateObj.getUTCMonth()] || "";
  const day = dateObj.getUTCDate();
  const year = dateObj.getUTCFullYear();
  const dateStr = `${month} ${day}, ${year}`;

  const aircraft = [rec.make, rec.model].filter(Boolean).join(" ") || "an aircraft";
  const location = [rec.city, rec.state].filter(Boolean).join(", ") || "an unknown location";
  const airport = rec.airportCode ? ` near ${rec.airportCode}` : "";

  const weatherDesc = rec.weatherCondition === "IMC"
    ? " under instrument meteorological conditions"
    : rec.weatherCondition === "VMC"
      ? " under visual meteorological conditions"
      : "";

  const phase = rec.broadPhaseOfFlight
    ? ` during ${rec.broadPhaseOfFlight.toLowerCase()}`
    : "";

  const injuries: string[] = [];
  if (rec.fatalCount > 0) injuries.push(`${rec.fatalCount} fatal ${rec.fatalCount === 1 ? "injury" : "injuries"}`);
  if (rec.seriousCount > 0) injuries.push(`${rec.seriousCount} serious ${rec.seriousCount === 1 ? "injury" : "injuries"}`);
  const injuryStr = injuries.length > 0
    ? ` resulting in ${injuries.join(" and ")}`
    : " with no reported fatalities";

  const cause = rec.probableCause
    ? ` The probable cause was determined to be ${rec.probableCause.charAt(0).toLowerCase()}${rec.probableCause.slice(1).replace(/\.$/, "")}.`
    : "";

  // Truncate cause to keep narrative reasonable
  const narrative = `On ${dateStr}, a ${aircraft} was involved in an ${rec.eventType.toLowerCase()}${airport} in ${location}${weatherDesc}${phase}${injuryStr}.${cause}`;

  return narrative.length > 800 ? narrative.slice(0, 797) + "..." : narrative;
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

function buildEntry(rec: AviationRecord): PreparedEntry | null {
  if (!rec.eventDate || !rec.state || !VALID_STATES.has(rec.state.toUpperCase())) return null;

  const stateAbbr = rec.state.toUpperCase();
  const { severity, tag: severityTag } = classifySeverity(rec.fatalCount, rec.seriousCount, rec.eventType);
  const narrative = buildNarrative(rec);

  const aircraft = [rec.make, rec.model].filter(Boolean).join(" ") || "Unknown aircraft";
  const location = [rec.city, stateAbbr].filter(Boolean).join(", ");

  const title = `Aviation ${rec.eventType} ${location} ${rec.eventDate} — ${aircraft}`;

  const parts = [
    "aviation-accident",
    stateAbbr,
    rec.eventDate,
    `type:${rec.eventType}`,
    `aircraft:${aircraft}`,
  ];
  if (rec.fatalCount > 0) parts.push(`fatal:${rec.fatalCount}`);
  if (rec.seriousCount > 0) parts.push(`serious_injuries:${rec.seriousCount}`);
  if (rec.weatherCondition) parts.push(`weather:${rec.weatherCondition}`);
  if (rec.broadPhaseOfFlight) parts.push(`phase:${rec.broadPhaseOfFlight}`);
  parts.push(`narrative:${narrative}`);

  const content = parts.join(" | ");

  const tags: string[] = [
    stateAbbr,
    "aviation",
    "accident",
    severityTag,
  ];
  if (rec.aircraftCategory) tags.push(rec.aircraftCategory.toLowerCase().replace(/\s+/g, "-"));

  return {
    title,
    content,
    content_type: "aviation-accident",
    tags,
    state_abbr: stateAbbr,
    species: null,
    effective_date: rec.eventDate,
    metadata: {
      source: "ntsb",
      event_type: rec.eventType,
      city: rec.city,
      airport_code: rec.airportCode,
      fatal_count: rec.fatalCount,
      serious_count: rec.seriousCount,
      aircraft_category: rec.aircraftCategory,
      make: rec.make,
      model: rec.model,
      amateur_built: rec.amateurBuilt,
      number_of_engines: rec.numberOfEngines,
      weather_condition: rec.weatherCondition,
      phase_of_flight: rec.broadPhaseOfFlight,
      report_status: rec.reportStatus,
    },
    embedText: content,
  };
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

// ---------- API Mode: NTSB CAROL ----------

const CAROL_URL = "https://data.ntsb.gov/carol-repgen/api/Aviation/ReportMain/GetAviationReportPage";

interface CAROLRecord {
  EventDate?: string;
  City?: string;
  State?: string;
  Country?: string;
  AirportCode?: string;
  EventType?: string;
  FatalInjuryCount?: number;
  SeriousInjuryCount?: number;
  AircraftCategory?: string;
  Make?: string;
  Model?: string;
  AmateurBuilt?: string;
  NumberOfEngines?: number;
  WeatherCondition?: string;
  BroadPhaseOfFlight?: string;
  ReportStatus?: string;
  ProbableCause?: string;
}

function carolToRecord(c: CAROLRecord): AviationRecord {
  const eventDate = c.EventDate
    ? new Date(c.EventDate).toISOString().split("T")[0]
    : "";

  return {
    eventDate,
    city: c.City || "",
    state: c.State || "",
    country: c.Country || "",
    airportCode: c.AirportCode || "",
    eventType: c.EventType || "Accident",
    fatalCount: c.FatalInjuryCount || 0,
    seriousCount: c.SeriousInjuryCount || 0,
    aircraftCategory: c.AircraftCategory || "",
    make: c.Make || "",
    model: c.Model || "",
    amateurBuilt: c.AmateurBuilt === "Yes",
    numberOfEngines: c.NumberOfEngines || 0,
    weatherCondition: c.WeatherCondition || "",
    broadPhaseOfFlight: c.BroadPhaseOfFlight || "",
    reportStatus: c.ReportStatus || "",
    probableCause: c.ProbableCause || "",
  };
}

async function runAPIMode() {
  console.log("Mode: NTSB CAROL API (paginated)");
  console.log(`Starting from page: ${START_PAGE}`);

  const PAGE_SIZE = 100;
  let page = START_PAGE;
  let totalInserted = 0;
  let emptyPages = 0;

  while (emptyPages < 3) {
    console.log(`\n--- Page ${page} ---`);

    const url = `${CAROL_URL}?pageNumber=${page}&pageSize=${PAGE_SIZE}&sort=EventDate+asc`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    let records: CAROLRecord[];
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timeout);

      if (!res.ok) {
        if (res.status >= 400 && res.status < 500) {
          console.error(`  API returned ${res.status}, stopping.`);
          break;
        }
        console.error(`  API returned ${res.status}, retrying...`);
        await delay(10000);
        continue;
      }

      const data = await res.json();
      records = Array.isArray(data) ? data : (data.items || data.results || data.data || []);
      if (!Array.isArray(records)) {
        console.error("  Unexpected response format, stopping.");
        break;
      }
    } catch (err) {
      clearTimeout(timeout);
      console.error(`  Fetch error: ${err}`);
      await delay(10000);
      continue;
    }

    if (records.length === 0) {
      emptyPages++;
      console.log("  Empty page, incrementing empty counter...");
      page++;
      continue;
    }
    emptyPages = 0;

    const aviationRecords = records.map(carolToRecord);
    const entries = aviationRecords
      .map(buildEntry)
      .filter((e): e is PreparedEntry => e !== null);

    console.log(`  ${records.length} records fetched, ${entries.length} US entries to embed`);

    if (entries.length > 0) {
      try {
        const inserted = await processEntries(entries);
        totalInserted += inserted;
        console.log(`  Page ${page}: ${inserted} entries embedded and inserted`);
      } catch (err) {
        console.error(`  Page ${page}: embed/insert failed (continuing): ${err}`);
      }
    }

    page++;
    await delay(1000);
  }

  return totalInserted;
}

// ---------- CSV Mode ----------

async function runCSVMode() {
  const csvPath = resolve(process.cwd(), "scripts/data/ntsb-aviation.csv");
  console.log(`Mode: CSV file`);
  console.log(`Path: ${csvPath}`);

  if (!existsSync(csvPath)) {
    console.error(`CSV file not found at: ${csvPath}`);
    console.error("Download from: https://data.ntsb.gov/avdata/FileDirectory/DownloadFile?fileID=C%3A%5Cavdata%5Cavall.csv");
    console.error("Place at: scripts/data/ntsb-aviation.csv");
    process.exit(1);
  }

  const csvText = readFileSync(csvPath, "utf-8");
  const lines = csvText.split("\n");
  console.log(`  ${lines.length - 1} lines in CSV`);

  if (lines.length < 2) {
    console.error("CSV has no data rows");
    process.exit(1);
  }

  const headers = parseCSVLine(lines[0]).map((h) => h.trim());
  const idx = (name: string) => {
    const i = headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
    return i;
  };

  const iEventDate = idx("EventDate") !== -1 ? idx("EventDate") : idx("Event.Date");
  const iCity = idx("City");
  const iState = idx("State");
  const iCountry = idx("Country");
  const iAirportCode = idx("AirportCode") !== -1 ? idx("AirportCode") : idx("Airport.Code");
  const iEventType = idx("EventType") !== -1 ? idx("EventType") : idx("Event.Type");
  const iFatal = idx("FatalInjuryCount") !== -1 ? idx("FatalInjuryCount") : idx("Total.Fatal.Injuries");
  const iSerious = idx("SeriousInjuryCount") !== -1 ? idx("SeriousInjuryCount") : idx("Total.Serious.Injuries");
  const iCategory = idx("AircraftCategory") !== -1 ? idx("AircraftCategory") : idx("Aircraft.Category");
  const iMake = idx("Make");
  const iModel = idx("Model");
  const iAmateur = idx("AmateurBuilt") !== -1 ? idx("AmateurBuilt") : idx("Amateur.Built");
  const iEngines = idx("NumberOfEngines") !== -1 ? idx("NumberOfEngines") : idx("Number.of.Engines");
  const iWeather = idx("WeatherCondition") !== -1 ? idx("WeatherCondition") : idx("Weather.Condition");
  const iPhase = idx("BroadPhaseOfFlight") !== -1 ? idx("BroadPhaseOfFlight") : idx("Broad.Phase.of.Flight");
  const iReport = idx("ReportStatus") !== -1 ? idx("ReportStatus") : idx("Report.Status");
  const iCause = idx("ProbableCause") !== -1 ? idx("ProbableCause") : idx("Probable.Cause");

  if (iEventDate === -1) {
    console.error("Cannot find EventDate column in CSV. Headers found:", headers.slice(0, 20));
    process.exit(1);
  }

  let totalInserted = 0;
  let batch: PreparedEntry[] = [];
  let lineCount = 0;
  let skippedYear = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = parseCSVLine(line);
    const rawDate = fields[iEventDate]?.trim() || "";
    if (!rawDate) continue;

    const d = new Date(rawDate);
    if (isNaN(d.getTime())) continue;
    const eventDate = d.toISOString().split("T")[0];
    const year = d.getFullYear();

    if (START_YEAR && year < START_YEAR) {
      skippedYear++;
      continue;
    }

    const rec: AviationRecord = {
      eventDate,
      city: fields[iCity]?.trim() || "",
      state: fields[iState]?.trim() || "",
      country: fields[iCountry]?.trim() || "",
      airportCode: iAirportCode !== -1 ? (fields[iAirportCode]?.trim() || "") : "",
      eventType: iEventType !== -1 ? (fields[iEventType]?.trim() || "Accident") : "Accident",
      fatalCount: iFatal !== -1 ? (parseInt(fields[iFatal] || "0", 10) || 0) : 0,
      seriousCount: iSerious !== -1 ? (parseInt(fields[iSerious] || "0", 10) || 0) : 0,
      aircraftCategory: iCategory !== -1 ? (fields[iCategory]?.trim() || "") : "",
      make: iMake !== -1 ? (fields[iMake]?.trim() || "") : "",
      model: iModel !== -1 ? (fields[iModel]?.trim() || "") : "",
      amateurBuilt: iAmateur !== -1 ? (fields[iAmateur]?.trim() || "").toLowerCase() === "yes" : false,
      numberOfEngines: iEngines !== -1 ? (parseInt(fields[iEngines] || "0", 10) || 0) : 0,
      weatherCondition: iWeather !== -1 ? (fields[iWeather]?.trim() || "") : "",
      broadPhaseOfFlight: iPhase !== -1 ? (fields[iPhase]?.trim() || "") : "",
      reportStatus: iReport !== -1 ? (fields[iReport]?.trim() || "") : "",
      probableCause: iCause !== -1 ? (fields[iCause]?.trim() || "") : "",
    };

    const entry = buildEntry(rec);
    if (!entry) continue;

    batch.push(entry);
    lineCount++;

    // Process in batches of 200 entries
    if (batch.length >= 200) {
      console.log(`  Processing batch at line ${i} (${lineCount} valid entries so far)...`);
      try {
        const inserted = await processEntries(batch);
        totalInserted += inserted;
        console.log(`    ${inserted} entries embedded and inserted (total: ${totalInserted})`);
      } catch (err) {
        console.error(`    Batch failed (continuing): ${err}`);
      }
      batch = [];
    }
  }

  // Process remaining
  if (batch.length > 0) {
    console.log(`  Processing final batch (${batch.length} entries)...`);
    try {
      const inserted = await processEntries(batch);
      totalInserted += inserted;
    } catch (err) {
      console.error(`    Final batch failed: ${err}`);
    }
  }

  if (skippedYear > 0) console.log(`  Skipped ${skippedYear} records before START_YEAR=${START_YEAR}`);

  return totalInserted;
}

// ---------- Main ----------

async function main() {
  console.log("=== NTSB Aviation Accident Backfill ===");
  console.log("Source: NTSB Aviation Accident Database");

  let totalInserted: number;

  if (MODE === "csv") {
    totalInserted = await runCSVMode();
  } else {
    totalInserted = await runAPIMode();
  }

  console.log(`\n=== Done! Total: ${totalInserted} entries inserted ===`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
