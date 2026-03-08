/**
 * Ingest DU Migration Map reports into hunt_du_map_reports + hunt_knowledge
 * Iterates season by season (Sep 1 - Apr 30), day by day, to stay under 200 cap.
 * Embeds via hunt-generate-embedding edge function.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/ingest-du-map.ts
 *   START_SEASON=2022-2023 SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/ingest-du-map.ts
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const START_SEASON = process.env.START_SEASON || "2019-2020";

if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY,
  "Content-Type": "application/json",
};

const DU_API_BASE = "https://webapi.ducks.org/migrationmap";
const DU_HEADERS = {
  Origin: "https://www.ducks.org",
  Referer: "https://www.ducks.org/migrationmap",
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0 (compatible; DuckCountdown/1.0)",
};

const RATE_LIMIT_MS = 500;
const EMBED_DELAY_MS = 200;

const STATE_ABBRS: Record<string, string> = {
  "Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA",
  "Colorado":"CO","Connecticut":"CT","Delaware":"DE","Florida":"FL","Georgia":"GA",
  "Hawaii":"HI","Idaho":"ID","Illinois":"IL","Indiana":"IN","Iowa":"IA",
  "Kansas":"KS","Kentucky":"KY","Louisiana":"LA","Maine":"ME","Maryland":"MD",
  "Massachusetts":"MA","Michigan":"MI","Minnesota":"MN","Mississippi":"MS","Missouri":"MO",
  "Montana":"MT","Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ",
  "New Mexico":"NM","New York":"NY","North Carolina":"NC","North Dakota":"ND","Ohio":"OH",
  "Oklahoma":"OK","Oregon":"OR","Pennsylvania":"PA","Rhode Island":"RI","South Carolina":"SC",
  "South Dakota":"SD","Tennessee":"TN","Texas":"TX","Utah":"UT","Vermont":"VT",
  "Virginia":"VA","Washington":"WA","West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY",
};

// Also handle Canadian provinces that might appear
const CA_ABBRS: Record<string, string> = {
  "Alberta":"AB","British Columbia":"BC","Manitoba":"MB","New Brunswick":"NB",
  "Newfoundland and Labrador":"NL","Nova Scotia":"NS","Ontario":"ON",
  "Prince Edward Island":"PE","Quebec":"QC","Saskatchewan":"SK",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url: string, headers: Record<string, string>, retries = 3): Promise<Response> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, { headers });
      if (res.ok) return res;
      if (res.status >= 500 && attempt < retries - 1) {
        const wait = (attempt + 1) * 5000;
        console.log(`  Retry ${attempt + 1}/${retries} after ${wait / 1000}s (${res.status})...`);
        await sleep(wait);
        continue;
      }
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    } catch (err) {
      if (attempt < retries - 1) {
        const wait = (attempt + 1) * 5000;
        console.log(`  Network error, retrying in ${wait / 1000}s: ${err}`);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

interface DUReport {
  reportID: number;
  firstName?: string;
  lastName?: string;
  country: string;
  city?: string;
  state: string;
  zip?: string;
  latitude: number;
  longitude: number;
  activityLevelID: number;
  activityLevel: string;
  timeOfDay?: string;
  weather?: string;
  temp?: string;
  windSpeed?: string;
  windDirection?: string;
  comments?: string;
  submitDate: string;
  isFieldEditor: boolean;
  itemType?: string;
  flywayId?: number;
  totalVoteUp: number;
  totalVoteDown: number;
  classification?: string;
}

function formatDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getStateAbbr(stateName: string): string | null {
  return STATE_ABBRS[stateName] || CA_ABBRS[stateName] || null;
}

function toDbRow(report: DUReport) {
  return {
    report_id: report.reportID,
    submit_date: report.submitDate,
    country: report.country || "US",
    state: report.state,
    state_abbr: getStateAbbr(report.state),
    city: report.city || null,
    zip: report.zip || null,
    latitude: report.latitude,
    longitude: report.longitude,
    activity_level: report.activityLevel,
    activity_level_id: report.activityLevelID,
    classification: report.classification || null,
    time_of_day: report.timeOfDay || null,
    weather: report.weather || null,
    temp: report.temp || null,
    wind_speed: report.windSpeed || null,
    wind_direction: report.windDirection || null,
    comments: report.comments || null,
    is_field_editor: report.isFieldEditor || false,
    flyway_id: report.flywayId || null,
    vote_up: report.totalVoteUp || 0,
    vote_down: report.totalVoteDown || 0,
  };
}

function toEmbedText(report: DUReport): string {
  const abbr = getStateAbbr(report.state) || report.state;
  const date = report.submitDate.split("T")[0];
  const parts = [
    `du_report | ${abbr} | ${date}`,
    `activity:${report.activityLevel || "unknown"}`,
    `weather:${report.weather || "unknown"} wind:${report.windSpeed || "unknown"} ${report.windDirection || ""} temp:${report.temp || "unknown"}`,
  ];
  if (report.comments) {
    parts.push(report.comments.substring(0, 500));
  }
  return parts.join(" | ");
}

// ---------------------------------------------------------------------------
// API fetch
// ---------------------------------------------------------------------------

async function fetchReportsForDay(dateStr: string): Promise<DUReport[]> {
  const url = `${DU_API_BASE}/reports?start=${dateStr}&end=${dateStr}`;
  try {
    const res = await fetchWithRetry(url, DU_HEADERS);
    const data = await res.json();
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.reports)) return data.reports;
    return [];
  } catch (err) {
    console.warn(`  Failed to fetch ${dateStr}: ${err}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Upsert to hunt_du_map_reports
// ---------------------------------------------------------------------------

async function upsertReports(rows: ReturnType<typeof toDbRow>[]): Promise<number> {
  if (rows.length === 0) return 0;

  // Batch in groups of 50
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/hunt_du_map_reports`, {
      method: "POST",
      headers: { ...supaHeaders, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(batch),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`  Upsert failed: ${errText}`);
    } else {
      inserted += batch.length;
    }
  }
  return inserted;
}

// ---------------------------------------------------------------------------
// Embed via edge function
// ---------------------------------------------------------------------------

async function embedViaEdgeFunction(text: string, retries = 3): Promise<number[]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/hunt-generate-embedding`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SERVICE_KEY}`,
          apikey: SERVICE_KEY!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text, input_type: "document" }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.embedding;
      }
      if (res.status >= 500 && attempt < retries - 1) {
        const wait = (attempt + 1) * 5000;
        console.log(`    Embed retry ${attempt + 1}/${retries} (${res.status})...`);
        await sleep(wait);
        continue;
      }
      throw new Error(`Embed error: ${res.status} ${await res.text()}`);
    } catch (err) {
      if (attempt < retries - 1) {
        const wait = (attempt + 1) * 10000;
        console.log(`    Embed error, retrying in ${wait / 1000}s: ${err}`);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Exhausted embed retries");
}

async function insertKnowledgeRow(report: DUReport, embedding: number[]): Promise<boolean> {
  const abbr = getStateAbbr(report.state) || report.state;
  const date = report.submitDate.split("T")[0];
  const content = toEmbedText(report);

  const row = {
    title: `DU report ${abbr} ${date} - ${report.activityLevel}`,
    content: content.substring(0, 2000),
    content_type: "du_report",
    tags: [abbr, "du_map", "migration"],
    embedding: JSON.stringify(embedding),
    state_abbr: abbr.length === 2 ? abbr : null,
    metadata: JSON.stringify({
      source: "du_migration_map",
      report_id: report.reportID,
      submit_date: report.submitDate,
      activity_level_id: report.activityLevelID,
    }),
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge`, {
    method: "POST",
    headers: { ...supaHeaders, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`  Knowledge insert failed for ${report.reportID}: ${errText}`);
    return false;
  }
  return true;
}

async function markEmbedded(reportIds: number[]): Promise<void> {
  if (reportIds.length === 0) return;
  const filter = reportIds.map((id) => `report_id.eq.${id}`).join(",");
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/hunt_du_map_reports?or=(${filter})`,
    {
      method: "PATCH",
      headers: { ...supaHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ embedded_at: new Date().toISOString() }),
    },
  );
  if (!res.ok) {
    console.warn(`  Failed to mark embedded for ${reportIds.length} reports`);
  }
}

// ---------------------------------------------------------------------------
// Season iteration
// ---------------------------------------------------------------------------

function parseStartSeason(s: string): number {
  const parts = s.split("-");
  return parseInt(parts[0], 10);
}

function* seasonDays(startYear: number): Generator<string> {
  // Sep 1 of startYear through Apr 30 of startYear+1
  const start = new Date(startYear, 8, 1); // Sep 1
  const end = new Date(startYear + 1, 3, 30); // Apr 30

  const current = new Date(start);
  while (current <= end) {
    yield formatDate(current);
    current.setDate(current.getDate() + 1);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== DU Migration Map Reports Ingestion ===");

  const firstYear = parseStartSeason(START_SEASON);
  const currentYear = new Date().getFullYear();
  // End season is current year (e.g., 2025-2026 if we're in 2026)
  const lastYear = currentYear;

  let totalReports = 0;
  let totalEmbedded = 0;
  let totalDays = 0;

  for (let year = firstYear; year < lastYear; year++) {
    const seasonLabel = `${year}-${year + 1}`;
    console.log(`\n=== Season ${seasonLabel} ===`);

    let seasonReports = 0;
    let seasonEmbedded = 0;

    for (const dateStr of seasonDays(year)) {
      const reports = await fetchReportsForDay(dateStr);
      totalDays++;

      if (reports.length === 0) {
        // Skip silently for empty days — just log every 30 days
        if (totalDays % 30 === 0) {
          console.log(`  ${dateStr}: 0 reports (${totalDays} days processed)`);
        }
        await sleep(RATE_LIMIT_MS);
        continue;
      }

      console.log(`  ${dateStr}: ${reports.length} reports`);

      // Strip personal data, convert to DB rows
      const dbRows = reports.map(toDbRow);
      const inserted = await upsertReports(dbRows);
      seasonReports += inserted;
      totalReports += inserted;

      // Embed in batches of 20
      for (let i = 0; i < reports.length; i += 20) {
        const batch = reports.slice(i, i + 20);
        const embeddedIds: number[] = [];

        for (const report of batch) {
          try {
            const embedText = toEmbedText(report);
            const embedding = await embedViaEdgeFunction(embedText);
            const ok = await insertKnowledgeRow(report, embedding);
            if (ok) {
              embeddedIds.push(report.reportID);
              seasonEmbedded++;
              totalEmbedded++;
            }
          } catch (err) {
            console.error(`    Embed failed for report ${report.reportID}: ${err}`);
          }
          await sleep(EMBED_DELAY_MS);
        }

        await markEmbedded(embeddedIds);
      }

      await sleep(RATE_LIMIT_MS);
    }

    console.log(`  Season ${seasonLabel}: ${seasonReports} reports, ${seasonEmbedded} embedded`);
  }

  console.log(`\n=== Done ===`);
  console.log(`Total days: ${totalDays}`);
  console.log(`Total reports: ${totalReports}`);
  console.log(`Total embedded: ${totalEmbedded}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
