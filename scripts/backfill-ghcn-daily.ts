/**
 * Backfill NOAA GHCN-Daily historical weather observations into hunt_knowledge
 * Pulls from ACIS MultiStnData endpoint (no API key needed), aggregates
 * station readings into state-level daily narratives, embeds via Voyage AI,
 * and upserts into hunt_knowledge.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-ghcn-daily.ts
 *
 * Resume support:
 *   START_STATE=CO START_YEAR=1985  — skip to Colorado starting at 1985
 *   ONLY_STATES=SC,SD,TN            — run ONLY these states (comma list)
 *   YEAR_FROM=2005 YEAR_TO=2024     — bound the year range (default 1950-2025)
 *
 * Idempotency: before inserting a state/year, the script fetches the
 * effective_dates already present in hunt_knowledge for that state/year and
 * only inserts the missing dates. Re-running never duplicates existing data
 * (hunt_knowledge has no unique constraint, so merge-duplicates is a no-op —
 * the diff against existing dates is the real idempotency mechanism).
 *
 * Failure accounting: insert/embed failures are COUNTED and the script exits
 * non-zero if any occurred. A previous version swallowed insert 4xx errors,
 * reported failed batches as "embedded", and exited 0 — which is how the
 * SC-WY gap went unnoticed.
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
const START_YEAR = process.env.START_YEAR
  ? parseInt(process.env.START_YEAR, 10)
  : null;
const ONLY_STATES = process.env.ONLY_STATES
  ? process.env.ONLY_STATES.toUpperCase().split(",").map((s) => s.trim()).filter(Boolean)
  : null;
const YEAR_FROM = process.env.YEAR_FROM ? parseInt(process.env.YEAR_FROM, 10) : 1950;
const YEAR_TO = process.env.YEAR_TO ? parseInt(process.env.YEAR_TO, 10) : 2025;

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY!,
  "Content-Type": "application/json",
};

const ACIS_URL = "http://data.rcc-acis.org/MultiStnData";

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

const STATE_NAMES: Record<string, string> = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",
  CO:"Colorado",CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",
  HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",
  KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",
  MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",
  MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",
  NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",
  ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",
  RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",
  TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",
  WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",
};

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

// ---------- Helpers ----------

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Parse an ACIS value. Returns null for missing ("M", "", undefined),
 * 0.01 for trace ("T"), or the numeric value.
 */
function parseAcisValue(val: string | undefined | null): number | null {
  if (val === undefined || val === null) return null;
  const v = val.trim();
  if (v === "" || v === "M") return null;
  if (v === "T") return 0.01;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  const monthIdx = parseInt(m, 10) - 1;
  const day = parseInt(d, 10);
  return `${MONTH_NAMES[monthIdx]} ${day}, ${y}`;
}

// ---------- ACIS Fetch ----------

interface AcisStation {
  meta: { name: string; state: string; ll?: [number, number] };
  data: [string, ...string[]][]; // [date, maxt, mint, pcpn, snow, snwd]
}

interface AcisResponse {
  data: AcisStation[];
}

async function fetchAcisYear(
  state: string,
  year: number,
): Promise<AcisResponse> {
  const body = {
    state,
    sdate: `${year}-01-01`,
    edate: `${year}-12-31`,
    elems: ["maxt", "mint", "pcpn", "snow", "snwd"],
    meta: "name,state,ll",
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000);

      const res = await fetch(ACIS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        return (await res.json()) as AcisResponse;
      }
      // Never retry 4xx
      if (res.status >= 400 && res.status < 500) {
        throw new Error(`ACIS 4xx: ${res.status} ${await res.text()}`);
      }
      // 5xx — retry
      if (attempt < 2) {
        console.log(`    ACIS ${res.status}, retry ${attempt + 1}/3...`);
        await delay((attempt + 1) * 5000);
        continue;
      }
      throw new Error(`ACIS error after retries: ${res.status}`);
    } catch (err: any) {
      if (err.message?.startsWith("ACIS 4xx")) throw err;
      if (attempt < 2) {
        console.log(`    ACIS network error, retry ${attempt + 1}/3...`);
        await delay((attempt + 1) * 10000);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

// ---------- Aggregation ----------

interface DaySummary {
  date: string;
  avgHigh: number | null;
  avgLow: number | null;
  avgPrecip: number;
  maxPrecip: number;
  maxPrecipStation: string;
  stationCount: number;
  maxTemp: number | null;
  maxTempStation: string;
  minTemp: number | null;
  minTempStation: string;
  snowfall: number | null;
  snowDepth: number | null;
}

function generateDates(year: number): string[] {
  const dates: string[] = [];
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  const cur = new Date(start);
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const d = String(cur.getDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// ---------- Plausibility screen (THE TOMATO QUESTION fix, 2026-07-17) ----------
// MD's rollups carried min_temp_f = 7.0 stuck for weeks of summer 2002-2004
// (a broken station rode ingest unscreened and fabricated a "June 30, 2004
// freeze"); HI carried a 0C=32F sentinel pinned for 237 straight days; AK/CO
// carried -40C=-40F sentinels in August. The screen below rejects individual
// STATION readings before aggregation, so the state extreme recomputes from
// the surviving instruments. Rules mirror scripts/ghcn-qa-scan.ts (the
// archive-wide flag pass) so faucet and archive agree on what "broken" means:
//   STUCK RUN  — a station reporting the identical mint (or maxt) on >= 5
//                consecutive days is confirmed broken when the run sits far
//                from the state average (median spread > 30F), pins 10+ days
//                at > 15F from average, or contains a seasonal impossibility.
//                A value once confirmed broken rejects that station's other
//                runs of the same value that year (stuck sensors stay stuck).
//   SEASONAL   — mint <= 15F in May-Sep outside AK with the state average
//                more than 38F warmer (the verified broken-instrument
//                ceiling; real cold sinks top out ~35F below average), or
//                maxt >= 115F in Dec-Feb (US winter record high is ~100F).
//   INVERSION  — mint > maxt on the same station-day rejects both readings.

export interface ScreenCounts {
  stuckMin: number;
  stuckMax: number;
  seasonalMin: number;
  seasonalMax: number;
  inversion: number;
}

interface Reading {
  dayIdx: number;
  maxt: number | null;
  mint: number | null;
  pcpn: number | null;
  snow: number | null;
  snwd: number | null;
}

function medianOf(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function screenStation(
  readings: Reading[],
  field: "mint" | "maxt",
  state: string,
  dates: string[],
  prelimAvg: (dayIdx: number) => number | null, // avg low for mint, avg high for maxt
  counts: ScreenCounts,
): Set<number> {
  const monthOf = (i: number) => Number(dates[i].slice(5, 7));
  const seasonallyImpossible = (v: number, dayIdx: number, spread: number | null) =>
    field === "mint"
      ? state !== "AK" && v <= 15 && monthOf(dayIdx) >= 5 && monthOf(dayIdx) <= 9 &&
        spread !== null && spread > 38
      : v >= 115 && [12, 1, 2].includes(monthOf(dayIdx));
  const spreadOf = (v: number, dayIdx: number): number | null => {
    const a = prelimAvg(dayIdx);
    if (a === null) return null;
    return field === "mint" ? a - v : v - a;
  };

  const rejected = new Set<number>(); // dayIdx set

  // Collect runs of identical values on consecutive dayIdx.
  const runs: { value: number; days: number[] }[] = [];
  let cur: number[] = [];
  let prevVal: number | null = null;
  let prevIdx = NaN;
  const flush = () => {
    if (cur.length >= 5 && prevVal !== null) runs.push({ value: prevVal, days: cur });
    cur = [];
  };
  for (const r of readings) {
    const v = r[field];
    if (v !== null && v === prevVal && r.dayIdx === prevIdx + 1) {
      cur.push(r.dayIdx);
    } else {
      flush();
      cur = v !== null ? [r.dayIdx] : [];
      prevVal = v;
    }
    prevIdx = r.dayIdx;
  }
  flush();

  // Confirm runs (same evidence rules as the archive scan), then propagate
  // known-bad values to this station's other runs.
  const knownBad = new Set<number>();
  for (const run of runs) {
    const spreads = run.days
      .map((d) => spreadOf(run.value, d))
      .filter((s): s is number => s !== null);
    const med = medianOf(spreads);
    const seasonal = run.days.some((d) => seasonallyImpossible(run.value, d, spreadOf(run.value, d) ?? Infinity));
    if ((med !== null && med > 30) || (run.days.length >= 10 && med !== null && med > 15) || seasonal) {
      knownBad.add(run.value);
    }
  }
  for (const run of runs) {
    if (!knownBad.has(run.value)) continue;
    for (const d of run.days) rejected.add(d);
    if (field === "mint") counts.stuckMin += run.days.length;
    else counts.stuckMax += run.days.length;
  }

  // Per-reading seasonal impossibility outside rejected runs.
  for (const r of readings) {
    const v = r[field];
    if (v === null || rejected.has(r.dayIdx)) continue;
    if (seasonallyImpossible(v, r.dayIdx, spreadOf(v, r.dayIdx))) {
      rejected.add(r.dayIdx);
      if (field === "mint") counts.seasonalMin++;
      else counts.seasonalMax++;
    }
  }

  return rejected;
}

function aggregateStations(
  acisData: AcisStation[],
  year: number,
  state: string,
): { summaries: Map<string, DaySummary>; screenCounts: ScreenCounts } {
  // ACIS MultiStnData does NOT include dates in data rows —
  // rows are positional from sdate. Compute dates from year.
  const dates = generateDates(year);

  // Pass 1 — parse every station's readings and compute preliminary per-day
  // state averages (the spread baseline; one broken station among many barely
  // moves it).
  const stations: { name: string; readings: Reading[] }[] = [];
  const lowSums = new Array<number>(dates.length).fill(0);
  const lowNs = new Array<number>(dates.length).fill(0);
  const highSums = new Array<number>(dates.length).fill(0);
  const highNs = new Array<number>(dates.length).fill(0);

  for (const station of acisData) {
    if (!station.data) continue;
    const readings: Reading[] = [];
    for (let i = 0; i < station.data.length && i < dates.length; i++) {
      const row = station.data[i];
      // ACIS rows are [maxt, mint, pcpn, snow, snwd] — NO date column
      const maxt = parseAcisValue(row[0] as string);
      const mint = parseAcisValue(row[1] as string);
      const pcpn = parseAcisValue(row[2] as string);
      const snow = parseAcisValue(row[3] as string);
      const snwd = parseAcisValue(row[4] as string);
      if (maxt === null && mint === null && pcpn === null && snow === null && snwd === null) continue;
      readings.push({ dayIdx: i, maxt, mint, pcpn, snow, snwd });
      if (mint !== null) { lowSums[i] += mint; lowNs[i]++; }
      if (maxt !== null) { highSums[i] += maxt; highNs[i]++; }
    }
    if (readings.length > 0) stations.push({ name: station.meta?.name || "Unknown", readings });
  }

  const prelimAvgLow = (i: number) => (lowNs[i] > 0 ? lowSums[i] / lowNs[i] : null);
  const prelimAvgHigh = (i: number) => (highNs[i] > 0 ? highSums[i] / highNs[i] : null);

  // Pass 2 — screen each station's mint/maxt readings.
  const counts: ScreenCounts = { stuckMin: 0, stuckMax: 0, seasonalMin: 0, seasonalMax: 0, inversion: 0 };
  for (const station of stations) {
    const badMin = screenStation(station.readings, "mint", state, dates, prelimAvgLow, counts);
    const badMax = screenStation(station.readings, "maxt", state, dates, prelimAvgHigh, counts);
    for (const r of station.readings) {
      if (badMin.has(r.dayIdx)) r.mint = null;
      if (badMax.has(r.dayIdx)) r.maxt = null;
      // Inversion — a station whose min exceeds its own max that day is not
      // reporting weather; drop both readings.
      if (r.mint !== null && r.maxt !== null && r.mint > r.maxt) {
        r.mint = null;
        r.maxt = null;
        counts.inversion++;
      }
    }
  }

  // Pass 3 — aggregate the surviving readings.
  const dayMap = new Map<
    string,
    {
      highs: number[];
      lows: number[];
      precips: number[];
      maxPrecip: number;
      maxPrecipStation: string;
      maxTemp: number;
      maxTempStation: string;
      minTemp: number;
      minTempStation: string;
      snowfalls: number[];
      snowDepths: number[];
      stationCount: number;
    }
  >();

  for (const station of stations) {
    for (const r of station.readings) {
      const { maxt, mint, pcpn, snow, snwd } = r;
      const date = dates[r.dayIdx];

      // Need at least one temp reading to count as a reporting station
      if (maxt === null && mint === null) continue;

      let day = dayMap.get(date);
      if (!day) {
        day = {
          highs: [],
          lows: [],
          precips: [],
          maxPrecip: 0,
          maxPrecipStation: "",
          maxTemp: -Infinity,
          maxTempStation: "",
          minTemp: Infinity,
          minTempStation: "",
          snowfalls: [],
          snowDepths: [],
          stationCount: 0,
        };
        dayMap.set(date, day);
      }

      day.stationCount++;
      if (maxt !== null) {
        day.highs.push(maxt);
        if (maxt > day.maxTemp) {
          day.maxTemp = maxt;
          day.maxTempStation = station.name;
        }
      }
      if (mint !== null) {
        day.lows.push(mint);
        if (mint < day.minTemp) {
          day.minTemp = mint;
          day.minTempStation = station.name;
        }
      }
      if (pcpn !== null) {
        day.precips.push(pcpn);
        if (pcpn > day.maxPrecip) {
          day.maxPrecip = pcpn;
          day.maxPrecipStation = station.name;
        }
      }
      if (snow !== null) day.snowfalls.push(snow);
      if (snwd !== null) day.snowDepths.push(snwd);
    }
  }

  // Build summaries
  const result = new Map<string, DaySummary>();

  for (const [date, day] of dayMap) {
    if (day.highs.length === 0 && day.lows.length === 0) continue;

    const avg = (arr: number[]) =>
      arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const max = (arr: number[]) =>
      arr.length > 0 ? Math.max(...arr) : null;

    const avgSnowfall = day.snowfalls.length > 0 ? avg(day.snowfalls) : null;
    const maxSnowDepth = day.snowDepths.length > 0 ? max(day.snowDepths) : null;

    result.set(date, {
      date,
      // null (NOT 0) when no station reported that side — same sentinel
      // family as min/max: avg(empty) used to fabricate "low of 0°F".
      avgHigh: day.highs.length > 0 ? Math.round(avg(day.highs) * 10) / 10 : null,
      avgLow: day.lows.length > 0 ? Math.round(avg(day.lows) * 10) / 10 : null,
      avgPrecip: Math.round(avg(day.precips) * 100) / 100,
      maxPrecip: Math.round(day.maxPrecip * 100) / 100,
      maxPrecipStation: day.maxPrecipStation,
      stationCount: day.stationCount,
      // null (NOT 0) when no station reported that side — the old 0-sentinel
      // fabricated "0°F" readings and min>max inversions.
      maxTemp: day.maxTemp === -Infinity ? null : Math.round(day.maxTemp * 10) / 10,
      maxTempStation: day.maxTempStation,
      minTemp: day.minTemp === Infinity ? null : Math.round(day.minTemp * 10) / 10,
      minTempStation: day.minTempStation,
      snowfall: avgSnowfall !== null ? Math.round(avgSnowfall * 10) / 10 : null,
      snowDepth: maxSnowDepth,
    });
  }

  return { summaries: result, screenCounts: counts };
}

// ---------- Narrative Builder ----------

function buildNarrative(state: string, summary: DaySummary): string {
  const stateName = STATE_NAMES[state];
  const dateStr = formatDate(summary.date);

  let text: string;
  if (summary.avgHigh !== null && summary.avgLow !== null) {
    text = `On ${dateStr}, ${stateName} recorded an average high of ${summary.avgHigh}\u00B0F and low of ${summary.avgLow}\u00B0F across ${summary.stationCount} reporting stations.`;
  } else if (summary.avgHigh !== null) {
    text = `On ${dateStr}, ${stateName} recorded an average high of ${summary.avgHigh}\u00B0F across ${summary.stationCount} reporting stations.`;
  } else {
    text = `On ${dateStr}, ${stateName} recorded an average low of ${summary.avgLow}\u00B0F across ${summary.stationCount} reporting stations.`;
  }

  if (summary.avgPrecip > 0) {
    text += ` The state received an average of ${summary.avgPrecip} inches of precipitation`;
    if (summary.maxPrecip > summary.avgPrecip && summary.maxPrecipStation) {
      text += `, with the heaviest rainfall of ${summary.maxPrecip} inches near ${summary.maxPrecipStation}`;
    }
    text += ".";
  } else {
    text += " No measurable precipitation was recorded.";
  }

  // Only narrate extremes that exist \u2014 the old 0-sentinel wrote "coldest
  // reading was 0\u00B0F" on days where no station reported a low.
  if (summary.minTemp !== null && summary.maxTemp !== null) {
    text += ` The coldest reading was ${summary.minTemp}\u00B0F and the warmest was ${summary.maxTemp}\u00B0F.`;
  } else if (summary.minTemp !== null) {
    text += ` The coldest reading was ${summary.minTemp}\u00B0F.`;
  } else if (summary.maxTemp !== null) {
    text += ` The warmest reading was ${summary.maxTemp}\u00B0F.`;
  }

  if (summary.snowfall !== null && summary.snowfall > 0) {
    text += ` The state averaged ${summary.snowfall} inches of new snowfall`;
    if (summary.snowDepth !== null && summary.snowDepth > 0) {
      text += ` with up to ${summary.snowDepth} inches of snow on the ground`;
    }
    text += ".";
  }

  return text;
}

// ---------- Entry Builder ----------

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

function buildEntry(state: string, summary: DaySummary): PreparedEntry | null {
  // Final date validation — reject anything that's not a real date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(summary.date)) return null;
  const narrative = buildNarrative(state, summary);

  const tags = [state, "weather", "temperature", "daily-observation", "historical"];
  if (summary.snowfall !== null && summary.snowfall > 0) tags.push("snow");
  if (summary.maxPrecip > 1.0) tags.push("heavy-precip");

  return {
    title: `Daily Weather ${state} ${summary.date}`,
    content: narrative,
    content_type: "ghcn-daily",
    tags,
    state_abbr: state,
    species: null,
    effective_date: summary.date,
    metadata: {
      source: "noaa-acis-ghcn-daily",
      state,
      date: summary.date,
      avg_high_f: summary.avgHigh,
      avg_low_f: summary.avgLow,
      avg_precip_in: summary.avgPrecip,
      max_precip_in: summary.maxPrecip,
      station_count: summary.stationCount,
      max_temp_f: summary.maxTemp,
      min_temp_f: summary.minTemp,
      snowfall_in: summary.snowfall,
      snow_depth_in: summary.snowDepth,
    },
    embedText: narrative,
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
      // Never retry 4xx (except 429)
      throw new Error(`Voyage error: ${res.status} ${await res.text()}`);
    } catch (err: any) {
      if (err.message?.startsWith("Voyage error:")) throw err;
      if (attempt < retries - 1) {
        await delay((attempt + 1) * 10000);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

// ---------- Failure accounting ----------

let insertFailures = 0;
let embedFailures = 0;

// ---------- Idempotency: fetch dates already present for a state/year ----------

async function fetchExistingDates(state: string, year: number): Promise<Set<string>> {
  const url =
    `${SUPABASE_URL}/rest/v1/hunt_knowledge` +
    `?select=effective_date` +
    `&content_type=eq.ghcn-daily` +
    `&state_abbr=eq.${state}` +
    `&effective_date=gte.${year}-01-01` +
    `&effective_date=lte.${year}-12-31` +
    `&limit=400`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: supaHeaders });
      if (res.ok) {
        const rows = (await res.json()) as { effective_date: string }[];
        return new Set(rows.map((r) => r.effective_date));
      }
      if (res.status >= 400 && res.status < 500) {
        throw new Error(`Existing-dates check 4xx: ${res.status} ${await res.text()}`);
      }
      if (attempt < 2) {
        await delay((attempt + 1) * 5000);
        continue;
      }
      throw new Error(`Existing-dates check failed: ${res.status}`);
    } catch (err: any) {
      if (err.message?.startsWith("Existing-dates check 4xx")) throw err;
      if (attempt < 2) {
        await delay((attempt + 1) * 5000);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

// ---------- Supabase insert ----------

/** Returns the number of rows that actually landed. Failures are counted. */
async function insertBatch(rows: Record<string, unknown>[]): Promise<number> {
  let landed = 0;
  for (let i = 0; i < rows.length; i += 20) {
    const chunk = rows.slice(i, i + 20);
    let chunkOk = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge`, {
          method: "POST",
          headers: supaHeaders,
          body: JSON.stringify(chunk),
        });
        if (res.ok) {
          chunkOk = true;
          break;
        }
        if (res.status >= 400 && res.status < 500) {
          const text = await res.text();
          console.error(`    Insert 4xx (not retrying): ${res.status} ${text}`);
          break;
        }
        if (attempt < 2) {
          console.log(`    Insert retry ${attempt + 1}/3...`);
          await delay(5000);
          continue;
        }
        const text = await res.text();
        console.error(`    Insert failed after retries: ${text}`);
      } catch (err) {
        if (attempt < 2) {
          await delay(5000);
          continue;
        }
        console.error(`    Insert fetch failed after retries: ${err}`);
      }
    }
    if (chunkOk) landed += chunk.length;
    else insertFailures += chunk.length;
  }
  return landed;
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
      console.error(
        `    Embed batch failed, skipping ${batch.length} entries: ${err}`,
      );
      embedFailures += batch.length;
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

    inserted += await insertBatch(rows);

    // Pause between embed batches
    await delay(500);
  }

  return inserted;
}

// ---------- Main ----------

async function main() {
  const states = ONLY_STATES
    ? STATES.filter((s) => ONLY_STATES.includes(s))
    : STATES;

  console.log("=== NOAA GHCN-Daily Historical Weather Backfill ===");
  console.log(`States: ${states.length} | Years: ${YEAR_FROM}-${YEAR_TO}`);
  if (ONLY_STATES) console.log(`Only states: ${states.join(",")}`);
  if (START_STATE) console.log(`Resuming from state: ${START_STATE}`);
  if (START_YEAR) console.log(`Resuming from year: ${START_YEAR}`);

  let totalInserted = 0;
  let totalSkipped = 0;
  let pastStartState = !START_STATE;

  for (const state of states) {
    // Resume support: skip states before START_STATE
    if (!pastStartState) {
      if (state === START_STATE) {
        pastStartState = true;
      } else {
        continue;
      }
    }

    console.log(`\n--- ${state} ---`);
    let stateTotal = 0;

    for (let year = YEAR_FROM; year <= YEAR_TO; year++) {
      // Resume support: skip years before START_YEAR (only for START_STATE)
      if (state === START_STATE && START_YEAR && year < START_YEAR) {
        continue;
      }

      // Idempotency: fetch dates already in hunt_knowledge for this state/year
      let existingDates: Set<string>;
      try {
        existingDates = await fetchExistingDates(state, year);
      } catch (err) {
        console.error(`  ${year}: existing-dates check failed, skipping year to avoid duplicates — ${err}`);
        insertFailures += 1; // count so the run exits non-zero and the gap is visible
        continue;
      }

      // Fetch from ACIS
      let acisData: AcisResponse;
      try {
        acisData = await fetchAcisYear(state, year);
      } catch (err) {
        console.error(`  ${year}: ACIS fetch failed — ${err}`);
        insertFailures += 1;
        continue;
      }

      // Rate limit ACIS: 500ms minimum between requests
      await delay(500);

      if (!acisData.data || acisData.data.length === 0) {
        console.log(`  ${year}: no stations reported`);
        continue;
      }

      // Aggregate stations into daily summaries (plausibility-screened)
      const { summaries, screenCounts } = aggregateStations(acisData.data, year, state);
      const screenTotal =
        screenCounts.stuckMin + screenCounts.stuckMax +
        screenCounts.seasonalMin + screenCounts.seasonalMax + screenCounts.inversion;
      if (screenTotal > 0) {
        console.log(
          `  ${year}: plausibility screen rejected ${screenTotal} station readings ` +
          `(stuck min ${screenCounts.stuckMin}, stuck max ${screenCounts.stuckMax}, ` +
          `seasonal min ${screenCounts.seasonalMin}, seasonal max ${screenCounts.seasonalMax}, ` +
          `inversions ${screenCounts.inversion})`,
        );
      }

      if (summaries.size === 0) {
        console.log(`  ${year}: no valid daily data`);
        continue;
      }

      // Build entries (filter nulls from invalid dates + already-present dates)
      const entries: PreparedEntry[] = [];
      let skippedExisting = 0;
      for (const [, summary] of summaries) {
        if (existingDates.has(summary.date)) {
          skippedExisting++;
          continue;
        }
        const entry = buildEntry(state, summary);
        if (entry) entries.push(entry);
      }
      totalSkipped += skippedExisting;

      if (entries.length === 0) {
        console.log(`  ${year}: all ${summaries.size} days already present, skipped`);
        continue;
      }

      // Sort by date for consistent output
      entries.sort((a, b) => a.effective_date.localeCompare(b.effective_date));

      // Embed + insert
      try {
        const inserted = await processEntries(entries);
        stateTotal += inserted;
        totalInserted += inserted;
        const skipNote = skippedExisting > 0 ? ` (${skippedExisting} already present)` : "";
        console.log(`  ${year}: ${summaries.size} days -> ${inserted} embedded${skipNote}`);
      } catch (err) {
        console.error(`  ${year}: embed/insert failed (continuing): ${err}`);
      }
    }

    console.log(`  ${state} total: ${stateTotal} entries`);
  }

  console.log(`\n=== Done! Total: ${totalInserted} inserted, ${totalSkipped} skipped (already present) ===`);
  if (insertFailures > 0 || embedFailures > 0) {
    console.error(
      `=== FAILURES: ${insertFailures} insert failures/skipped years, ${embedFailures} embed failures — DATA IS INCOMPLETE, re-run to fill gaps ===`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
