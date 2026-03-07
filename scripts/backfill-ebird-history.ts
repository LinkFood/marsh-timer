/**
 * Backfill hunt_migration_history from eBird historical observations API
 * Rate limit: 200 req/hr. This script respects that with delays.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... EBIRD_API_KEY=... npx tsx scripts/backfill-ebird-history.ts
 *
 * Optional:
 *   START_STATE=TX  — resume from a specific state
 *   YEAR=2023       — backfill a single year
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EBIRD_KEY = process.env.EBIRD_API_KEY;
const START_STATE = process.env.START_STATE || null;
const SINGLE_YEAR = process.env.YEAR ? parseInt(process.env.YEAR, 10) : null;

if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }
if (!EBIRD_KEY) { console.error("EBIRD_API_KEY required"); process.exit(1); }

const headers = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY,
  "Content-Type": "application/json",
};

const EBIRD_BASE = "https://api.ebird.org/v2";

// Duck species codes to aggregate
const DUCK_CODES = new Set([
  "mallar3", "gnwtea", "bnwtea", "norsho", "amewid",
  "norpin", "wodduc", "redhea", "canbac", "lessca",
  "gresca", "rudduc", "buffle", "comgol", "commer",
  "rebmer", "hoomer", "rintea", "gadwal",
]);

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

// Duck season months — sample every 7 days (key migration dates are weekly patterns anyway)
function getDatesToFetch(year: number): { y: number; m: number; d: number }[] {
  const dates: { y: number; m: number; d: number }[] = [];
  // Sept-Dec of the year
  for (const m of [9, 10, 11, 12]) {
    const daysInMonth = new Date(year, m, 0).getDate();
    for (let d = 1; d <= daysInMonth; d += 7) {
      dates.push({ y: year, m, d });
    }
  }
  // Jan-Feb of next year
  for (const m of [1, 2]) {
    const daysInMonth = new Date(year + 1, m, 0).getDate();
    for (let d = 1; d <= daysInMonth; d += 7) {
      dates.push({ y: year + 1, m, d });
    }
  }
  return dates;
}

// Steady drip: 200 req/hr = 1 every 18s. We use 19s to stay safe.
const DELAY_MS = 19000;

async function rateLimitedFetch(url: string): Promise<Response> {
  await new Promise((r) => setTimeout(r, DELAY_MS));
  return fetch(url, {
    headers: { "X-eBirdApiToken": EBIRD_KEY! },
  });
}

async function fetchDayObservations(
  stateAbbr: string,
  y: number,
  m: number,
  d: number,
): Promise<{ sightingCount: number; locationCount: number; locations: string[] }> {
  const url = `${EBIRD_BASE}/data/obs/US-${stateAbbr}/historic/${y}/${m}/${d}?maxResults=200`;

  const res = await rateLimitedFetch(url);
  if (!res.ok) {
    if (res.status === 429) {
      console.log(`  429 rate limited, waiting 120s...`);
      await new Promise((r) => setTimeout(r, 120000));
      const retry = await rateLimitedFetch(url);
      if (!retry.ok) return { sightingCount: 0, locationCount: 0, locations: [] };
      const data = await retry.json();
      return aggregateObs(data);
    }
    return { sightingCount: 0, locationCount: 0, locations: [] };
  }

  const data = await res.json();
  return aggregateObs(data);
}

function aggregateObs(data: any[]): { sightingCount: number; locationCount: number; locations: string[] } {
  const duckObs = data.filter((o: any) => DUCK_CODES.has(o.speciesCode));
  const sightingCount = duckObs.reduce((sum: number, o: any) => sum + (o.howMany || 1), 0);
  const locationSet = new Set(duckObs.map((o: any) => o.locName));
  const locations = Array.from(locationSet).slice(0, 10);
  return { sightingCount, locationCount: locationSet.size, locations };
}

async function upsertMigrationRow(row: any) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/hunt_migration_history`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    console.error(`  Upsert failed: ${await res.text()}`);
  }
}

async function main() {
  console.log("=== Backfilling eBird Migration History ===");

  const years = SINGLE_YEAR ? [SINGLE_YEAR] : [2020, 2021, 2022, 2023, 2024];
  let startFound = !START_STATE;
  let total = 0;

  for (const stateAbbr of STATES) {
    if (!startFound) {
      if (stateAbbr === START_STATE) startFound = true;
      else continue;
    }

    console.log(`\n${stateAbbr}:`);

    for (const year of years) {
      const dates = getDatesToFetch(year);
      let yearCount = 0;

      for (const { y, m, d } of dates) {
        const dateStr = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

        try {
          const { sightingCount, locationCount, locations } = await fetchDayObservations(stateAbbr, y, m, d);

          if (sightingCount > 0) {
            await upsertMigrationRow({
              state_abbr: stateAbbr,
              species: "duck",
              date: dateStr,
              sighting_count: sightingCount,
              location_count: locationCount,
              notable_locations: locations.length > 0 ? locations : null,
            });
            yearCount++;
          }
        } catch (err) {
          console.error(`  Error ${stateAbbr} ${dateStr}: ${err}`);
        }
      }

      console.log(`  ${year}-${year + 1}: ${yearCount} days with sightings`);
      total += yearCount;
    }
  }

  console.log(`\nDone! Total: ${total} migration history rows`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
