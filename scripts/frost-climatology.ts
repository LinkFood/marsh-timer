/**
 * Frost climatology — one-time computation for /plant (the planting page).
 *
 * Source of truth: the ghcn-daily lane in hunt_knowledge (state-day rows,
 * NOAA ACIS, 1950-2025). Each row's metadata.min_temp_f is the COLDEST
 * station reading anywhere in the state that day — so "freeze" here means
 * "somewhere in the state froze" (the honesty disclosure renders on the page).
 *
 * Per state x year:
 *   - last spring freeze  = last date with min_temp_f <= 32 BEFORE Jul 1
 *   - first fall freeze   = first date with min_temp_f <= 32 ON/AFTER Jul 1
 *   - growing season      = days between the two (both must exist)
 *
 * Per state: distributions (median / p10 / p90 / earliest+year / latest+year)
 * stored in planting_climatology (anon-read), and — THE EMBEDDING LAW — one
 * summary entry per state embedded via Voyage AI into hunt_knowledge
 * (content_type "frost-climatology").
 *
 * Fetching: one REST request per state-year, server-side filtered to
 * NEAR-freeze days (metadata->min_temp_f=lte.36 — jsonb numeric comparison),
 * well under PostgREST's 1000-row cap (max 366 rows/request). Never psql.
 * Freeze days are the <=32 subset; the 33-36 days corroborate (guard D).
 *
 * DATA-QUALITY GUARDS (verified need: MD 2004 has a station stuck at 7°F all
 * summer — min=7, avg_low=63 in July — which fabricates summer "freezes"):
 *   A. SPREAD guard: drop a freeze day when avg_low_f - min_temp_f > 38.
 *      Real state min-below-average spreads top out ~35 (CA high Sierra);
 *      beyond that it's a broken instrument, not weather.
 *   B. STUCK-VALUE guard: within a state-year, if one exact min value <= 32
 *      accounts for >= 20 freeze days, that's a stuck sensor, not 20 identical
 *      statewide minima — drop every day carrying that value.
 *   D. SINGLETON guard (added after the 3-state spot-run caught fabricated
 *      season edges the spread guard passed — MD "Aug 12 2024" first fall
 *      freeze with min=31 vs avg_low=61.1, VA summer 2025 stuck-at-32 station
 *      reading freezes on Jun 22 / Jul 16 / Aug 10 while the state averaged
 *      59-71F): real season-edge freezes come in cold spells — every real
 *      case checked (MN Jun 2010, MD Jun 1950, CA Jul 2010) has another
 *      near-freeze day (min <= 36) within +/-10 days; every fabricated case
 *      is a singleton. Drop a freeze day with no corroborating near-freeze
 *      day (<=36, post-A/B) within +/-10 calendar days.
 *   C. YEAR exclusion: if the guards dropped > 40% of a year's raw freeze
 *      days, the year's instrument record is untrustworthy — exclude the year
 *      from the distributions entirely (counted in the receipts).
 * All four print counts — every number stays traceable.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/frost-climatology.ts
 *   ONLY_STATES=MD,VA,MN  — limit states (spot-check mode, skips embedding)
 *   SKIP_EMBED=1          — skip the embedding step (recompute-only reruns;
 *                           the 50 summaries are already on file)
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;

if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}

const ONLY_STATES = process.env.ONLY_STATES
  ? process.env.ONLY_STATES.toUpperCase().split(",").map((s) => s.trim()).filter(Boolean)
  : null;
const SKIP_EMBED = !!process.env.SKIP_EMBED || !!ONLY_STATES;

if (!VOYAGE_KEY && !SKIP_EMBED) {
  console.error("VOYAGE_API_KEY required (or SKIP_EMBED=1)");
  process.exit(1);
}

const YEAR_FROM = 1950;
const YEAR_TO = 2025;

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

const headers = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY!,
  "Content-Type": "application/json",
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- DOY in a fixed non-leap reference calendar ----------
// Leap years shift real day-of-year by 1 after Feb 28; comparing calendar
// dates across 76 years wants month-day identity, so every date maps to its
// DOY in a common 365-day year. Feb 29 maps onto Feb 28's slot.

const CUM_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]; // non-leap
const MONTHS = ["January","February","March","April","May","June","July",
  "August","September","October","November","December"];

function refDoy(iso: string): number {
  const m = Number(iso.slice(5, 7));
  let d = Number(iso.slice(8, 10));
  if (m === 2 && d === 29) d = 28;
  return CUM_DAYS[m - 1] + d;
}

function doyToLabel(doy: number): string {
  let m = 0;
  while (m < 11 && CUM_DAYS[m + 1] < doy) m++;
  return `${MONTHS[m]} ${doy - CUM_DAYS[m]}`;
}

const JUL1_DOY = refDoy("2025-07-01"); // 182

// ---------- Percentiles (linear interpolation on the sorted sample) ----------

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// ---------- Fetch: near-freeze days (<=36) for one state-year ----------
// Freeze days are the <=32 subset; 33-36F days corroborate season edges
// (guard D). Max 366 rows — still nowhere near the 1000-row cap.

interface FreezeDay { date: string; min: number; avgLow: number | null }

async function fetchNearFreezeDays(state: string, year: number): Promise<FreezeDay[] | null> {
  // metadata->min_temp_f=lte.36 is jsonb comparison: numbers compare
  // numerically; JSON nulls also pass (Null < Number in jsonb ordering), so
  // re-check the type client-side.
  const url =
    `${SUPABASE_URL}/rest/v1/hunt_knowledge` +
    `?select=effective_date,min:metadata->min_temp_f,avg_low:metadata->avg_low_f` +
    `&content_type=eq.ghcn-daily` +
    `&state_abbr=eq.${state}` +
    `&effective_date=gte.${year}-01-01` +
    `&effective_date=lte.${year}-12-31` +
    `&metadata->min_temp_f=lte.36` +
    `&order=effective_date.asc&limit=400`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers });
      if (res.ok) {
        const rows = (await res.json()) as { effective_date: string; min: unknown; avg_low: unknown }[];
        return rows
          .filter((r) => typeof r.min === "number" && r.min <= 36)
          .map((r) => ({
            date: r.effective_date,
            min: r.min as number,
            avgLow: typeof r.avg_low === "number" ? r.avg_low : null,
          }));
      }
      // Never retry 4xx — only 5xx and network errors.
      if (res.status < 500) {
        console.error(`  ${state} ${year}: HTTP ${res.status} ${await res.text()}`);
        return null;
      }
    } catch { /* network — retry */ }
    await delay((attempt + 1) * 2000);
  }
  console.error(`  ${state} ${year}: exhausted retries`);
  return null;
}

// ---------- Data-quality guards (see header) ----------

interface GuardStats { spreadDropped: number; stuckDropped: number; singletonDropped: number; raw: number }

/** Epoch day of an ISO date — for guard D's calendar-day windows (real dates,
 *  not the reference calendar, so Feb 29 costs nothing). */
function epochDay(iso: string): number {
  return Math.round(Date.parse(iso + "T00:00:00Z") / 86_400_000);
}

/** @param nearFreezes every day <= 36F in the state-year (superset of `freezes`) */
function applyGuards(
  freezes: FreezeDay[],
  nearFreezes: FreezeDay[],
): { clean: FreezeDay[]; stats: GuardStats } {
  const stats: GuardStats = { spreadDropped: 0, stuckDropped: 0, singletonDropped: 0, raw: freezes.length };

  // Guard A — spread: a state minimum more than 38F below the state-average
  // low is a broken instrument (verified ceiling for real terrain ~35, CA).
  let clean = freezes.filter((f) => {
    if (f.avgLow !== null && f.avgLow - f.min > 38) { stats.spreadDropped++; return false; }
    return true;
  });

  // Guard B — stuck value: one exact minimum recurring >= 20 freeze days in a
  // single state-year, sitting far below the state-average low across its
  // occurrences (median spread > 30), is a stuck sensor, not weather. The
  // median-spread corroboration keeps real recurring shoulder values (a 30F
  // Minnesota hollow reads ~10-20F below the state average, not 45F).
  const byValue = new Map<number, number[]>(); // min value -> spreads
  for (const f of clean) {
    if (!byValue.has(f.min)) byValue.set(f.min, []);
    if (f.avgLow !== null) byValue.get(f.min)!.push(f.avgLow - f.min);
  }
  const stuck = new Set<number>();
  for (const [v, spreads] of byValue) {
    const occurrences = clean.filter((f) => f.min === v).length;
    if (occurrences < 20 || spreads.length === 0) continue;
    spreads.sort((a, b) => a - b);
    const medianSpread = spreads[Math.floor(spreads.length / 2)];
    if (medianSpread > 30) stuck.add(v);
  }
  if (stuck.size > 0) {
    clean = clean.filter((f) => {
      if (stuck.has(f.min)) { stats.stuckDropped++; return false; }
      return true;
    });
  }

  // Guard D — singleton: a freeze day with NO other near-freeze day (<= 36)
  // within +/-10 calendar days is an uncorroborated instrument outlier, not a
  // cold spell. Corroboration set = surviving freeze days + the 33-36F days
  // (a day dropped by A/B can't vouch for its neighbor).
  const cleanDates = new Set(clean.map((f) => f.date));
  const corroborators = [
    ...clean,
    ...nearFreezes.filter((d) => d.min > 32 && !cleanDates.has(d.date)),
  ].map((d) => ({ date: d.date, ed: epochDay(d.date) }));
  clean = clean.filter((f) => {
    const ed = epochDay(f.date);
    const ok = corroborators.some((c) => c.date !== f.date && Math.abs(c.ed - ed) <= 10);
    if (!ok) stats.singletonDropped++;
    return ok;
  });

  return { clean, stats };
}

// Was the year covered at all? (a year with zero freeze days is real data in
// the South — distinguish it from a year with zero ROWS)
async function yearHasCoverage(state: string, year: number): Promise<boolean> {
  const url =
    `${SUPABASE_URL}/rest/v1/hunt_knowledge` +
    `?select=effective_date&content_type=eq.ghcn-daily&state_abbr=eq.${state}` +
    `&effective_date=gte.${year}-01-01&effective_date=lte.${year}-12-31&limit=1`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers });
      if (res.ok) return ((await res.json()) as unknown[]).length > 0;
      if (res.status < 500) return false;
    } catch { /* retry */ }
    await delay((attempt + 1) * 2000);
  }
  return false;
}

// ---------- Distribution builder ----------

interface YearPoint { year: number; doy: number; date: string }

function buildDist(points: YearPoint[], noFreezeYears: number[]) {
  const sorted = [...points].sort((a, b) => a.doy - b.doy || a.year - b.year);
  const doys = sorted.map((p) => p.doy);
  const medianDoy = Math.round(quantile(doys, 0.5));
  const p10Doy = Math.round(quantile(doys, 0.1));
  const p90Doy = Math.round(quantile(doys, 0.9));
  const earliest = sorted[0];
  const latest = sorted[sorted.length - 1];
  return {
    n_freeze_years: points.length,
    no_freeze_years: noFreezeYears.length,
    median_doy: medianDoy, median_date: doyToLabel(medianDoy),
    p10_doy: p10Doy, p10_date: doyToLabel(p10Doy),
    p90_doy: p90Doy, p90_date: doyToLabel(p90Doy),
    earliest_doy: earliest.doy, earliest_date: doyToLabel(earliest.doy), earliest_year: earliest.year,
    latest_doy: latest.doy, latest_date: doyToLabel(latest.doy), latest_year: latest.year,
    // hero receipt: in how many recorded freeze-years had the event happened by p90?
    pct_passed_by_p90: points.filter((p) => p.doy <= p90Doy).length,
  };
}

// ---------- Per-state computation ----------

interface StateResult {
  state_abbr: string;
  n_years: number;
  spring: ReturnType<typeof buildDist>;
  fall: ReturnType<typeof buildDist>;
  season: {
    n_years: number;
    median_days: number; p10_days: number; p90_days: number;
    shortest_days: number; shortest_year: number;
    longest_days: number; longest_year: number;
  };
  guard_receipts: {
    spread_dropped_days: number;
    stuck_dropped_days: number;
    singleton_dropped_days: number;
    excluded_years: number[];
  };
}

async function computeState(state: string): Promise<StateResult | null> {
  const springPts: YearPoint[] = [];
  const fallPts: YearPoint[] = [];
  const springNone: number[] = [];
  const fallNone: number[] = [];
  const seasonLens: { year: number; days: number }[] = [];
  let nYears = 0;
  let spreadDropped = 0;
  let stuckDropped = 0;
  let singletonDropped = 0;
  const excludedYears: number[] = [];

  // modest concurrency inside a state: 4 years in flight
  const years: number[] = [];
  for (let y = YEAR_FROM; y <= YEAR_TO; y++) years.push(y);

  for (let i = 0; i < years.length; i += 4) {
    const chunk = years.slice(i, i + 4);
    const results = await Promise.all(chunk.map(async (year) => {
      const near = await fetchNearFreezeDays(state, year);
      if (near === null) return { year, ok: false as const, excluded: false };
      const raw = near.filter((d) => d.min <= 32);
      if (raw.length === 0) {
        // zero freeze days is real data in the South when the year has rows
        const covered = near.length > 0 || (await yearHasCoverage(state, year));
        return { year, ok: covered, excluded: false, spring: null, fall: null, stats: null };
      }
      const { clean, stats } = applyGuards(raw, near);
      // Guard C — if the guards ate >40% of the year's freeze days, the
      // year's instrument record is untrustworthy; exclude the whole year.
      const droppedShare = (stats.raw - clean.length) / stats.raw;
      if (droppedShare > 0.4) {
        return { year, ok: false as const, excluded: true, stats };
      }
      const springDays = clean.filter((f) => refDoy(f.date) < JUL1_DOY);
      const fallDays = clean.filter((f) => refDoy(f.date) >= JUL1_DOY);
      return {
        year,
        ok: true as const,
        excluded: false,
        spring: springDays.length ? springDays[springDays.length - 1].date : null,
        fall: fallDays.length ? fallDays[0].date : null,
        stats,
      };
    }));
    for (const r of results) {
      if (r.stats) {
        spreadDropped += r.stats.spreadDropped;
        stuckDropped += r.stats.stuckDropped;
        singletonDropped += r.stats.singletonDropped;
      }
      if (r.excluded) { excludedYears.push(r.year); continue; }
      if (!r.ok) continue;
      nYears++;
      const rr = r as { year: number; spring: string | null; fall: string | null };
      let sDoy: number | null = null;
      let fDoy: number | null = null;
      if (rr.spring) { sDoy = refDoy(rr.spring); springPts.push({ year: r.year, doy: sDoy, date: rr.spring }); }
      else springNone.push(r.year);
      if (rr.fall) { fDoy = refDoy(rr.fall); fallPts.push({ year: r.year, doy: fDoy, date: rr.fall }); }
      else fallNone.push(r.year);
      if (sDoy !== null && fDoy !== null) seasonLens.push({ year: r.year, days: fDoy - sDoy });
    }
  }

  if (springPts.length < 10 || fallPts.length < 10) {
    console.error(`  ${state}: too thin (${springPts.length} spring / ${fallPts.length} fall freeze-years of ${nYears}) — skipping`);
    return null;
  }

  const lens = seasonLens.map((s) => s.days).sort((a, b) => a - b);
  const byLen = [...seasonLens].sort((a, b) => a.days - b.days || a.year - b.year);
  const shortest = byLen[0];
  const longest = byLen[byLen.length - 1];

  return {
    state_abbr: state,
    n_years: nYears,
    spring: buildDist(springPts, springNone),
    fall: buildDist(fallPts, fallNone),
    season: {
      n_years: seasonLens.length,
      median_days: Math.round(quantile(lens, 0.5)),
      p10_days: Math.round(quantile(lens, 0.1)),
      p90_days: Math.round(quantile(lens, 0.9)),
      shortest_days: shortest.days, shortest_year: shortest.year,
      longest_days: longest.days, longest_year: longest.year,
    },
    guard_receipts: {
      spread_dropped_days: spreadDropped,
      stuck_dropped_days: stuckDropped,
      singleton_dropped_days: singletonDropped,
      excluded_years: excludedYears.sort((a, b) => a - b),
    },
  };
}

// ---------- Upsert ----------

async function upsertRows(results: StateResult[]): Promise<void> {
  const rows = results.map((r) => ({
    state_abbr: r.state_abbr,
    n_years: r.n_years,
    spring: r.spring,
    fall: r.fall,
    season: r.season,
    receipts: r.guard_receipts,
    computed_at: new Date().toISOString(),
  }));
  const res = await fetch(`${SUPABASE_URL}/rest/v1/planting_climatology`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`upsert failed: ${res.status} ${await res.text()}`);
}

// ---------- THE EMBEDDING LAW: one summary entry per state ----------

async function batchEmbed(texts: string[]): Promise<number[][]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${VOYAGE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "voyage-3-lite", input: texts, input_type: "document" }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.data.map((d: { embedding: number[] }) => d.embedding);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await delay((attempt + 1) * 20000);
      continue;
    }
    throw new Error(`Voyage error: ${res.status} ${await res.text()}`);
  }
  throw new Error("Exhausted Voyage retries");
}

function summaryText(r: StateResult): string {
  const name = STATE_NAMES[r.state_abbr] ?? r.state_abbr;
  return (
    `Frost climatology ${name}: over ${r.n_years} recorded years (1950-2025, state-level station minima), ` +
    `the last spring freeze fell on ${r.spring.median_date} in the median year; in 9 years of 10 it had passed by ${r.spring.p90_date}. ` +
    `Earliest last-freeze ${r.spring.earliest_date} (${r.spring.earliest_year}), latest ${r.spring.latest_date} (${r.spring.latest_year}). ` +
    `First fall freeze median ${r.fall.median_date}; earliest ${r.fall.earliest_date} (${r.fall.earliest_year}), latest ${r.fall.latest_date} (${r.fall.latest_year}). ` +
    `Freeze-free growing season median ${r.season.median_days} days (shortest ${r.season.shortest_days} in ${r.season.shortest_year}, longest ${r.season.longest_days} in ${r.season.longest_year}).`
  );
}

async function embedSummaries(results: StateResult[]): Promise<void> {
  // Replace any prior run's summaries so reruns don't duplicate.
  const del = await fetch(
    `${SUPABASE_URL}/rest/v1/hunt_knowledge?content_type=eq.frost-climatology`,
    { method: "DELETE", headers },
  );
  if (!del.ok) console.error(`  prior-summary delete: ${del.status} (continuing)`);

  for (let i = 0; i < results.length; i += 20) { // NEVER batch embed more than 20
    const chunk = results.slice(i, i + 20);
    const texts = chunk.map(summaryText);
    const embeddings = await batchEmbed(texts);
    const rows = chunk.map((r, j) => ({
      title: `Frost climatology ${r.state_abbr} 1950-2025`,
      content: texts[j],
      content_type: "frost-climatology",
      tags: [r.state_abbr, "frost", "freeze", "planting", "climatology", "growing-season"],
      state_abbr: r.state_abbr,
      species: null,
      effective_date: "2025-12-31",
      metadata: {
        source: "ghcn-daily state-day minima (NOAA ACIS), 1950-2025",
        n_years: r.n_years,
        spring: r.spring,
        fall: r.fall,
        season: r.season,
      },
      embedding: JSON.stringify(embeddings[j]),
    }));
    const res = await fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge`, {
      method: "POST",
      headers,
      body: JSON.stringify(rows),
    });
    if (!res.ok) throw new Error(`knowledge insert failed: ${res.status} ${await res.text()}`);
    console.log(`  embedded ${i + chunk.length}/${results.length} state summaries`);
    await delay(500);
  }
}

// ---------- Main ----------

async function main() {
  const states = ONLY_STATES ? STATES.filter((s) => ONLY_STATES.includes(s)) : STATES;
  console.log(`=== Frost climatology: ${states.length} states, ${YEAR_FROM}-${YEAR_TO} ===`);

  const results: StateResult[] = [];
  for (const state of states) {
    const t0 = Date.now();
    const r = await computeState(state);
    if (!r) continue;
    results.push(r);
    // Computation receipt — spot-checkable against raw ghcn-daily rows.
    console.log(
      `${state}: n=${r.n_years}y | last spring freeze median ${r.spring.median_date} ` +
      `(p10 ${r.spring.p10_date} / p90 ${r.spring.p90_date}; ` +
      `earliest ${r.spring.earliest_date} ${r.spring.earliest_year}, latest ${r.spring.latest_date} ${r.spring.latest_year}; ` +
      `${r.spring.no_freeze_years} no-freeze yrs) | first fall freeze median ${r.fall.median_date} ` +
      `(earliest ${r.fall.earliest_date} ${r.fall.earliest_year}, latest ${r.fall.latest_date} ${r.fall.latest_year}) | ` +
      `season median ${r.season.median_days}d (${r.season.shortest_days}d ${r.season.shortest_year} – ${r.season.longest_days}d ${r.season.longest_year}) | ` +
      `guards: ${r.guard_receipts.spread_dropped_days} spread-dropped, ${r.guard_receipts.stuck_dropped_days} stuck-dropped, ` +
      `${r.guard_receipts.singleton_dropped_days} singleton-dropped, ` +
      `excluded yrs [${r.guard_receipts.excluded_years.join(",")}] | ${Math.round((Date.now() - t0) / 1000)}s`,
    );
  }

  if (results.length === 0) {
    console.error("No states computed — nothing written.");
    process.exit(1);
  }

  await upsertRows(results);
  console.log(`\nUpserted ${results.length} rows into planting_climatology.`);

  if (!SKIP_EMBED) {
    await embedSummaries(results);
    console.log(`Embedded ${results.length} frost-climatology summaries into hunt_knowledge.`);
  } else {
    console.log("SKIP_EMBED — no knowledge entries written this run.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
