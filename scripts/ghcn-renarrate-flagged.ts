/**
 * Re-narrate + re-embed the GHCN-daily rows flagged by the 2026-07-17 QA pass.
 *
 * The flag pass (scripts/ghcn-qa-scan.ts) marked 5,266 rows with
 * metadata.qa_flag — but their CONTENT still narrates the fabricated numbers
 * ("The coldest reading was 7°F...") and their embeddings still carry those
 * sentences into vector search, /date, /ask. This is the named follow-up in
 * docs/GHCN-QA-2026-07-17.md §7.1: the content supersede pass.
 *
 * For each flagged row (grouped by state-year to reuse one ACIS fetch):
 *   REFETCH  — re-pull the year from ACIS via the fixed backfill's own data
 *              path, run the station-level plausibility screen
 *              (scripts/backfill-ghcn-daily.ts three-pass aggregation), and
 *              rebuild the day's narrative + aggregate metadata from the
 *              surviving instruments. A receipt sentence names the recompute.
 *   WITHHOLD — when the day is absent from the screened re-aggregation, the
 *              ACIS fetch fails, or the recomputed extreme still equals the
 *              flagged value (screen didn't catch it at station level): keep
 *              the usable station means and narrate the flagged extreme as
 *              withheld — "flagged instrument artifact (GHCN QA 2026-07-17)"
 *              — and null the withheld side in metadata.
 *
 * Every rewritten row is RE-EMBEDDED (Voyage voyage-3-lite, ≤20/batch — the
 * embedding law) and PATCHed with content + merged metadata + embedding.
 * qa_flag / qa_note / qa_run are preserved; qa_renarrated: true,
 * qa_renarrate_mode, qa_renarrate_run are added. No row is deleted.
 *
 * Idempotent + checkpointed: rows already carrying qa_renarrated are skipped
 * (fresh metadata check per group), and fully-completed state-year groups are
 * recorded in CHECKPOINT so a rerun skips their ACIS fetches entirely.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... \
 *     npx tsx scripts/ghcn-renarrate-flagged.ts
 *   ARTIFACTS=/tmp/ghcn-qa-full.json   — flag-pass dump (regenerate with the
 *                                        scan if missing; it is the id list
 *                                        of record)
 *   CHECKPOINT=/tmp/ghcn-renarrate-checkpoint.json
 *   ONLY_STATES=MD,VA                  — limit states (testing)
 *
 * Write path: sequential per-row PATCH (one write pipe, gentle IO), reads
 * batched 100 ids at a time. ~5,266 rows total.
 */

import * as fs from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;
if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }
if (!VOYAGE_KEY) { console.error("VOYAGE_API_KEY required"); process.exit(1); }

const ARTIFACTS = process.env.ARTIFACTS || "/tmp/ghcn-qa-full.json";
const CHECKPOINT = process.env.CHECKPOINT || "/tmp/ghcn-renarrate-checkpoint.json";
const RENARRATE_RUN = "ghcn-renarrate-2026-07-17";
const QA_RECEIPT = "GHCN QA 2026-07-17";
const ONLY_STATES = process.env.ONLY_STATES
  ? process.env.ONLY_STATES.toUpperCase().split(",").map((s) => s.trim()).filter(Boolean)
  : null;

const headers = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY!,
  "Content-Type": "application/json",
};
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${parseInt(d, 10)}, ${y}`;
}

// ---------- ACIS fetch + screened aggregation ----------
// Mirrors scripts/backfill-ghcn-daily.ts (the fixed faucet) exactly — same
// endpoint, same three-pass station-level plausibility screen, so the
// re-narrated aggregates are what the fixed backfill would have written.

const ACIS_URL = "http://data.rcc-acis.org/MultiStnData";

interface AcisStation {
  meta: { name: string; state: string };
  data: [string, ...string[]][];
}

function parseAcisValue(val: string | undefined | null): number | null {
  if (val === undefined || val === null) return null;
  const v = val.trim();
  if (v === "" || v === "M") return null;
  if (v === "T") return 0.01;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

async function fetchAcisYear(state: string, year: number): Promise<AcisStation[]> {
  const body = {
    state,
    sdate: `${year}-01-01`,
    edate: `${year}-12-31`,
    elems: ["maxt", "mint", "pcpn", "snow", "snwd"],
    meta: "name,state",
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
      if (res.ok) return ((await res.json()) as { data: AcisStation[] }).data ?? [];
      // Never retry 4xx
      if (res.status < 500) throw new Error(`ACIS 4xx: ${res.status} ${await res.text()}`);
    } catch (err: any) {
      if (err.message?.startsWith("ACIS 4xx")) throw err;
      /* network / 5xx — retry */
    }
    await delay((attempt + 1) * 5000);
  }
  throw new Error("ACIS: exhausted retries");
}

function generateDates(year: number): string[] {
  const dates: string[] = [];
  const cur = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  while (cur <= end) {
    dates.push(
      `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`,
    );
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
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
  prelimAvg: (dayIdx: number) => number | null,
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

  const rejected = new Set<number>();
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

  const knownBad = new Set<number>();
  for (const run of runs) {
    const spreads = run.days.map((d) => spreadOf(run.value, d)).filter((s): s is number => s !== null);
    const med = medianOf(spreads);
    const seasonal = run.days.some((d) => seasonallyImpossible(run.value, d, spreadOf(run.value, d) ?? Infinity));
    if ((med !== null && med > 30) || (run.days.length >= 10 && med !== null && med > 15) || seasonal) {
      knownBad.add(run.value);
    }
  }
  for (const run of runs) {
    if (knownBad.has(run.value)) for (const d of run.days) rejected.add(d);
  }
  for (const r of readings) {
    const v = r[field];
    if (v === null || rejected.has(r.dayIdx)) continue;
    if (seasonallyImpossible(v, r.dayIdx, spreadOf(v, r.dayIdx))) rejected.add(r.dayIdx);
  }
  return rejected;
}

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

function aggregateStations(acisData: AcisStation[], year: number, state: string): Map<string, DaySummary> {
  const dates = generateDates(year);

  // Pass 1 — parse + preliminary per-day averages (the spread baseline).
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

  // Pass 2 — screen each station's readings.
  for (const station of stations) {
    const badMin = screenStation(station.readings, "mint", state, dates, prelimAvgLow);
    const badMax = screenStation(station.readings, "maxt", state, dates, prelimAvgHigh);
    for (const r of station.readings) {
      if (badMin.has(r.dayIdx)) r.mint = null;
      if (badMax.has(r.dayIdx)) r.maxt = null;
      if (r.mint !== null && r.maxt !== null && r.mint > r.maxt) { r.mint = null; r.maxt = null; }
    }
  }

  // Pass 3 — aggregate survivors.
  const dayMap = new Map<string, {
    highs: number[]; lows: number[]; precips: number[];
    maxPrecip: number; maxPrecipStation: string;
    maxTemp: number; maxTempStation: string;
    minTemp: number; minTempStation: string;
    snowfalls: number[]; snowDepths: number[]; stationCount: number;
  }>();
  for (const station of stations) {
    for (const r of station.readings) {
      if (r.maxt === null && r.mint === null) continue;
      const date = dates[r.dayIdx];
      let day = dayMap.get(date);
      if (!day) {
        day = {
          highs: [], lows: [], precips: [], maxPrecip: 0, maxPrecipStation: "",
          maxTemp: -Infinity, maxTempStation: "", minTemp: Infinity, minTempStation: "",
          snowfalls: [], snowDepths: [], stationCount: 0,
        };
        dayMap.set(date, day);
      }
      day.stationCount++;
      if (r.maxt !== null) {
        day.highs.push(r.maxt);
        if (r.maxt > day.maxTemp) { day.maxTemp = r.maxt; day.maxTempStation = station.name; }
      }
      if (r.mint !== null) {
        day.lows.push(r.mint);
        if (r.mint < day.minTemp) { day.minTemp = r.mint; day.minTempStation = station.name; }
      }
      if (r.pcpn !== null) {
        day.precips.push(r.pcpn);
        if (r.pcpn > day.maxPrecip) { day.maxPrecip = r.pcpn; day.maxPrecipStation = station.name; }
      }
      if (r.snow !== null) day.snowfalls.push(r.snow);
      if (r.snwd !== null) day.snowDepths.push(r.snwd);
    }
  }

  const result = new Map<string, DaySummary>();
  for (const [date, day] of dayMap) {
    if (day.highs.length === 0 && day.lows.length === 0) continue;
    const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const avgSnowfall = day.snowfalls.length > 0 ? avg(day.snowfalls) : null;
    const maxSnowDepth = day.snowDepths.length > 0 ? Math.max(...day.snowDepths) : null;
    result.set(date, {
      date,
      avgHigh: day.highs.length > 0 ? Math.round(avg(day.highs) * 10) / 10 : null,
      avgLow: day.lows.length > 0 ? Math.round(avg(day.lows) * 10) / 10 : null,
      avgPrecip: Math.round(avg(day.precips) * 100) / 100,
      maxPrecip: Math.round(day.maxPrecip * 100) / 100,
      maxPrecipStation: day.maxPrecipStation,
      stationCount: day.stationCount,
      maxTemp: day.maxTemp === -Infinity ? null : Math.round(day.maxTemp * 10) / 10,
      maxTempStation: day.maxTempStation,
      minTemp: day.minTemp === Infinity ? null : Math.round(day.minTemp * 10) / 10,
      minTempStation: day.minTempStation,
      snowfall: avgSnowfall !== null ? Math.round(avgSnowfall * 10) / 10 : null,
      snowDepth: maxSnowDepth,
    });
  }
  return result;
}

// ---------- Narratives ----------

/** Same voice as the fixed backfill, plus a recompute receipt. */
function refetchNarrative(state: string, summary: DaySummary): string {
  const stateName = STATE_NAMES[state];
  const dateStr = formatDate(summary.date);
  let text: string;
  if (summary.avgHigh !== null && summary.avgLow !== null) {
    text = `On ${dateStr}, ${stateName} recorded an average high of ${summary.avgHigh}°F and low of ${summary.avgLow}°F across ${summary.stationCount} reporting stations.`;
  } else if (summary.avgHigh !== null) {
    text = `On ${dateStr}, ${stateName} recorded an average high of ${summary.avgHigh}°F across ${summary.stationCount} reporting stations.`;
  } else {
    text = `On ${dateStr}, ${stateName} recorded an average low of ${summary.avgLow}°F across ${summary.stationCount} reporting stations.`;
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
  if (summary.minTemp !== null && summary.maxTemp !== null) {
    text += ` The coldest reading was ${summary.minTemp}°F and the warmest was ${summary.maxTemp}°F.`;
  } else if (summary.minTemp !== null) {
    text += ` The coldest reading was ${summary.minTemp}°F.`;
  } else if (summary.maxTemp !== null) {
    text += ` The warmest reading was ${summary.maxTemp}°F.`;
  }
  if (summary.snowfall !== null && summary.snowfall > 0) {
    text += ` The state averaged ${summary.snowfall} inches of new snowfall`;
    if (summary.snowDepth !== null && summary.snowDepth > 0) {
      text += ` with up to ${summary.snowDepth} inches of snow on the ground`;
    }
    text += ".";
  }
  text += ` Extremes recomputed from plausibility-screened station data (${QA_RECEIPT}).`;
  return text;
}

const num = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null);

/** Honest rebuild from the row's own stored station means, flagged extreme withheld. */
function withholdNarrative(state: string, dateISO: string, meta: Record<string, unknown>, flag: string): string {
  const stateName = STATE_NAMES[state];
  const dateStr = formatDate(dateISO);
  const avgHigh = num(meta.avg_high_f);
  const avgLow = num(meta.avg_low_f);
  const stations = num(meta.station_count) ?? 0;

  let text: string;
  if (avgHigh !== null && avgLow !== null) {
    text = `On ${dateStr}, ${stateName} recorded an average high of ${avgHigh}°F and low of ${avgLow}°F across ${stations} reporting stations.`;
  } else if (avgHigh !== null) {
    text = `On ${dateStr}, ${stateName} recorded an average high of ${avgHigh}°F across ${stations} reporting stations.`;
  } else if (avgLow !== null) {
    text = `On ${dateStr}, ${stateName} recorded an average low of ${avgLow}°F across ${stations} reporting stations.`;
  } else {
    text = `On ${dateStr}, ${stateName} reported daily observations across ${stations} reporting stations.`;
  }

  const avgPrecip = num(meta.avg_precip_in) ?? 0;
  const maxPrecip = num(meta.max_precip_in) ?? 0;
  if (avgPrecip > 0) {
    text += ` The state received an average of ${avgPrecip} inches of precipitation`;
    if (maxPrecip > avgPrecip) text += `, with the heaviest report of ${maxPrecip} inches`;
    text += ".";
  } else {
    text += " No measurable precipitation was recorded.";
  }

  const withholdMin = flag.includes("min") || flag === "min-max-inversion";
  const withholdMax = flag.includes("max") || flag === "min-max-inversion";
  const keptMax = !withholdMax ? num(meta.max_temp_f) : null;
  const keptMin = !withholdMin ? num(meta.min_temp_f) : null;
  if (keptMin !== null) text += ` The coldest reading was ${keptMin}°F.`;
  if (keptMax !== null) text += ` The warmest reading was ${keptMax}°F.`;
  if (withholdMin && withholdMax) {
    text += ` Recorded temperature extremes are withheld — flagged instrument artifact (${QA_RECEIPT}).`;
  } else if (withholdMin) {
    text += ` The recorded coldest reading is withheld — flagged instrument artifact (${QA_RECEIPT}).`;
  } else {
    text += ` The recorded warmest reading is withheld — flagged instrument artifact (${QA_RECEIPT}).`;
  }

  const snowfall = num(meta.snowfall_in);
  const snowDepth = num(meta.snow_depth_in);
  if (snowfall !== null && snowfall > 0) {
    text += ` The state averaged ${snowfall} inches of new snowfall`;
    if (snowDepth !== null && snowDepth > 0) text += ` with up to ${snowDepth} inches of snow on the ground`;
    text += ".";
  }
  return text;
}

// ---------- Voyage embedding (≤20/batch — the law) ----------

async function batchEmbed(texts: string[], retries = 3): Promise<number[][]> {
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
    } catch (err: any) {
      if (err.message?.startsWith("Voyage error:")) throw err;
      if (attempt < retries - 1) { await delay((attempt + 1) * 10000); continue; }
      throw err;
    }
  }
  throw new Error("Voyage: exhausted retries");
}

// ---------- Supabase reads/writes ----------

interface LiveRow { id: string; content: string; metadata: Record<string, unknown> }

async function fetchRowsByIds(ids: string[]): Promise<LiveRow[]> {
  const out: LiveRow[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const url = `${SUPABASE_URL}/rest/v1/hunt_knowledge?select=id,content,metadata&id=in.(${chunk.join(",")})`;
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { headers }).catch(() => null);
      if (res?.ok) {
        const rows = (await res.json()) as { id: string; content: string; metadata: Record<string, unknown> | null }[];
        out.push(...rows.map((r) => ({ id: r.id, content: r.content, metadata: r.metadata ?? {} })));
        break;
      }
      if (res && res.status < 500) throw new Error(`fetch rows 4xx: ${res.status} ${await res.text()}`);
      if (attempt >= 3) throw new Error("fetch rows: exhausted retries");
      await delay((attempt + 1) * 2000);
    }
    await delay(50);
  }
  return out;
}

async function patchRow(id: string, body: Record<string, unknown>): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge?id=eq.${id}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify(body),
      });
      if (res.ok) return true;
      if (res.status < 500) { console.error(`  PATCH 4xx ${id}: ${res.status} ${await res.text()}`); return false; }
    } catch { /* network — retry */ }
    await delay((attempt + 1) * 2000);
  }
  return false;
}

// ---------- Checkpoint ----------

function loadCheckpoint(): Set<string> {
  try {
    return new Set(JSON.parse(fs.readFileSync(CHECKPOINT, "utf8")).doneGroups as string[]);
  } catch { return new Set(); }
}
function saveCheckpoint(done: Set<string>) {
  fs.writeFileSync(CHECKPOINT, JSON.stringify({ run: RENARRATE_RUN, doneGroups: [...done].sort() }, null, 1));
}

// ---------- Main ----------

interface Artifact { id: string; state: string; date: string; flag: string; note: string }

async function main() {
  if (!fs.existsSync(ARTIFACTS)) {
    console.error(`Artifact dump not found at ${ARTIFACTS} — regenerate with scripts/ghcn-qa-scan.ts (survey is read-only).`);
    process.exit(1);
  }
  const dump = JSON.parse(fs.readFileSync(ARTIFACTS, "utf8")) as { qa_run: string; artifacts: Artifact[] };
  let artifacts = dump.artifacts;
  if (ONLY_STATES) artifacts = artifacts.filter((a) => ONLY_STATES.includes(a.state));
  console.log(`=== GHCN re-narrate pass: ${artifacts.length} flagged rows (dump ${dump.qa_run}) ===`);

  // Group by state-year — one ACIS fetch per group.
  const groups = new Map<string, Artifact[]>();
  for (const a of artifacts) {
    const key = `${a.state}-${a.date.slice(0, 4)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(a);
  }
  const groupKeys = [...groups.keys()].sort();
  console.log(`${groupKeys.length} state-year groups`);

  const doneGroups = loadCheckpoint();
  let refetched = 0, withheld = 0, skipped = 0, failed = 0, checkpointSkipped = 0;

  for (const key of groupKeys) {
    const group = groups.get(key)!;
    if (doneGroups.has(key)) { checkpointSkipped += group.length; continue; }
    const state = key.slice(0, 2);
    const year = Number(key.slice(3));

    // Fresh metadata — skip rows already re-narrated (idempotent rerun).
    const live = await fetchRowsByIds(group.map((a) => a.id));
    const liveById = new Map(live.map((r) => [r.id, r]));
    const pending = group.filter((a) => liveById.get(a.id) && liveById.get(a.id)!.metadata.qa_renarrated !== true);
    skipped += group.length - pending.length;
    if (pending.length === 0) {
      doneGroups.add(key); saveCheckpoint(doneGroups);
      console.log(`${key}: all ${group.length} already re-narrated, skipped`);
      continue;
    }

    // ACIS refetch via the fixed backfill's data path. Failure → withhold mode.
    let summaries: Map<string, DaySummary> | null = null;
    try {
      const acis = await fetchAcisYear(state, year);
      await delay(500); // ACIS rate limit
      if (acis.length > 0) summaries = aggregateStations(acis, year, state);
    } catch (err) {
      console.error(`${key}: ACIS refetch failed (${err}) — withholding flagged extremes for this group`);
    }

    // Build new content + metadata per pending row.
    const prepared: { id: string; content: string; metadata: Record<string, unknown>; mode: "refetch" | "withhold" }[] = [];
    for (const a of pending) {
      const row = liveById.get(a.id)!;
      const meta = row.metadata;
      const flag = typeof meta.qa_flag === "string" ? (meta.qa_flag as string) : a.flag;
      const summary = summaries?.get(a.date) ?? null;

      // Refetch is only trusted when the screened recompute actually moved the
      // flagged side off the fabricated value.
      let useRefetch = summary !== null;
      if (useRefetch && summary) {
        const flagsMin = flag.includes("min") || flag === "min-max-inversion";
        const flagsMax = (flag.includes("max") && !flag.startsWith("min-max")) || flag === "min-max-inversion";
        const oldMin = num(meta.min_temp_f);
        const oldMax = num(meta.max_temp_f);
        if (flagsMin && oldMin !== null && summary.minTemp !== null && summary.minTemp === oldMin) useRefetch = false;
        if (flagsMax && oldMax !== null && summary.maxTemp !== null && summary.maxTemp === oldMax) useRefetch = false;
      }

      if (useRefetch && summary) {
        prepared.push({
          id: a.id,
          content: refetchNarrative(state, summary),
          metadata: {
            ...meta,
            avg_high_f: summary.avgHigh,
            avg_low_f: summary.avgLow,
            avg_precip_in: summary.avgPrecip,
            max_precip_in: summary.maxPrecip,
            station_count: summary.stationCount,
            max_temp_f: summary.maxTemp,
            min_temp_f: summary.minTemp,
            snowfall_in: summary.snowfall,
            snow_depth_in: summary.snowDepth,
            qa_renarrated: true,
            qa_renarrate_mode: "refetch",
            qa_renarrate_run: RENARRATE_RUN,
          },
          mode: "refetch",
        });
      } else {
        const withholdMin = flag.includes("min") || flag === "min-max-inversion";
        const withholdMax = flag.includes("max") || flag === "min-max-inversion";
        prepared.push({
          id: a.id,
          content: withholdNarrative(state, a.date, meta, flag),
          metadata: {
            ...meta,
            ...(withholdMin ? { min_temp_f: null } : {}),
            ...(withholdMax ? { max_temp_f: null } : {}),
            qa_renarrated: true,
            qa_renarrate_mode: "withhold",
            qa_renarrate_run: RENARRATE_RUN,
          },
          mode: "withhold",
        });
      }
    }

    // Re-embed (≤20/batch) + sequential PATCH — one write pipe, gentle IO.
    let groupFailed = 0;
    for (let i = 0; i < prepared.length; i += 20) {
      const batch = prepared.slice(i, i + 20);
      let embeddings: number[][];
      try {
        embeddings = await batchEmbed(batch.map((p) => p.content));
      } catch (err) {
        console.error(`${key}: embed batch failed (${err}) — ${batch.length} rows left for rerun`);
        groupFailed += batch.length;
        continue;
      }
      for (let j = 0; j < batch.length; j++) {
        const p = batch[j];
        const ok = await patchRow(p.id, {
          content: p.content,
          metadata: p.metadata,
          embedding: JSON.stringify(embeddings[j]),
        });
        if (ok) { if (p.mode === "refetch") refetched++; else withheld++; }
        else groupFailed++;
        await delay(30);
      }
      await delay(300);
    }
    failed += groupFailed;
    if (groupFailed === 0) { doneGroups.add(key); saveCheckpoint(doneGroups); }
    const modes = prepared.reduce((m, p) => ((m[p.mode] = (m[p.mode] ?? 0) + 1), m), {} as Record<string, number>);
    console.log(
      `${key}: ${prepared.length} re-narrated (refetch ${modes.refetch ?? 0}, withhold ${modes.withhold ?? 0})` +
      (group.length - pending.length > 0 ? ` | ${group.length - pending.length} already done` : "") +
      (groupFailed > 0 ? ` | ${groupFailed} FAILED` : ""),
    );
  }

  console.log(`\n=== Done: ${refetched} refetched, ${withheld} withheld, ${skipped + checkpointSkipped} skipped (already done/checkpointed), ${failed} failed ===`);
  if (failed > 0) {
    console.error("Failures remain — rerun to complete (checkpoint keeps finished groups out of the way).");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
