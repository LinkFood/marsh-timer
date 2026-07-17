// compute-a2-thresholds.ts — derive the A2 (antecedent precip → flood) firing
// thresholds on the LIVE field: hunt_weather_history.precipitation_total_mm.
//
// Registry law (docs/VALIDATED-LEADS-2026-07-17.md): archive thresholds don't
// transfer across fields — recompute per state-month p90 of the 3-day rolling
// precip sum from THIS table's full history (2020-09-01+), floor 0.25 in.
//
// Deterministic method (receipts):
//   - rows: state_abbr, date, precipitation_total_mm; null precip = missing day
//   - rolling sum r3(D) = mm(D) + mm(D-1) + mm(D-2), computed ONLY when all
//     three consecutive calendar days are present
//   - bucket r3 values by (state, month of D); p90 = nearest-rank
//     (sorted ascending, index ceil(0.9*n) - 1)
//   - threshold_in = max(round2(p90 / 25.4), 0.25)
//   - if a state-month bucket has n < 60 samples, fall back to the state's
//     all-months p90 (same formula), then floor
//
// Usage: SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/compute-a2-thresholds.ts
// Output: the TS constant table for hunt-formation-watch + derivation receipts
//         + today's live fire-check per state.

const URL = 'https://rvhyotvklfowklzjahdd.supabase.co/rest/v1';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY required'); process.exit(1); }

interface Row { state_abbr: string; date: string; precipitation_total_mm: number | null }

async function fetchAll(): Promise<Row[]> {
  const out: Row[] = [];
  let offset = 0;
  for (;;) {
    const res = await fetch(
      `${URL}/hunt_weather_history?select=state_abbr,date,precipitation_total_mm&order=state_abbr.asc,date.asc&limit=1000&offset=${offset}`,
      { headers: { Authorization: `Bearer ${KEY}`, apikey: KEY! } },
    );
    if (!res.ok) throw new Error(`fetch failed ${res.status}: ${await res.text()}`);
    const page = (await res.json()) as Row[];
    out.push(...page);
    if (page.length < 1000) break;
    offset += 1000;
    if (offset % 20000 === 0) console.error(`  ...${offset} rows`);
  }
  return out;
}

function addDays(d: string, n: number): string {
  return new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
}

function p90NearestRank(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(0.9 * sorted.length) - 1];
}

const r2 = (x: number) => Math.round(x * 100) / 100;

async function main() {
  const rows = await fetchAll();
  console.error(`fetched ${rows.length} rows`);
  const dates = rows.map((r) => r.date);
  const minDate = dates.reduce((a, b) => (a < b ? a : b));
  const maxDate = dates.reduce((a, b) => (a > b ? a : b));

  // state -> date -> mm
  const byState = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const mm = Number(r.precipitation_total_mm);
    if (!Number.isFinite(mm)) continue; // null = missing day
    if (!byState.has(r.state_abbr)) byState.set(r.state_abbr, new Map());
    byState.get(r.state_abbr)!.set(r.date, mm);
  }

  // buckets of 3-day rolling sums (mm) per state-month
  const buckets = new Map<string, number[][]>(); // state -> [12][] of r3 mm
  const allByState = new Map<string, number[]>();
  for (const [state, days] of byState) {
    const months: number[][] = Array.from({ length: 12 }, () => []);
    const all: number[] = [];
    for (const [d, mm] of days) {
      const d1 = addDays(d, -1), d2 = addDays(d, -2);
      if (!days.has(d1) || !days.has(d2)) continue;
      const r3 = mm + days.get(d1)! + days.get(d2)!;
      const month = Number(d.slice(5, 7)) - 1;
      months[month].push(r3);
      all.push(r3);
    }
    buckets.set(state, months);
    allByState.set(state, all);
  }

  const table: Record<string, number[]> = {};
  const fallbackMonths = new Set<number>();
  const monthN: number[][] = Array.from({ length: 12 }, () => []);
  for (const [state, months] of [...buckets.entries()].sort()) {
    const stateP90in = r2(p90NearestRank(allByState.get(state)!) / 25.4);
    table[state] = months.map((vals, mi) => {
      monthN[mi].push(vals.length);
      if (vals.length < 60) {
        fallbackMonths.add(mi + 1);
        return Math.max(stateP90in, 0.25);
      }
      return Math.max(r2(p90NearestRank(vals) / 25.4), 0.25);
    });
  }
  const nRange = monthN.map((ns, i) => `m${i + 1}:${Math.min(...ns)}-${Math.max(...ns)}`).join(' ');

  // ---- emit the constant table ----
  console.log(`// A2 thresholds: per state-month p90 of the 3-day rolling sum of`);
  console.log(`// hunt_weather_history.precipitation_total_mm, in INCHES, floor 0.25.`);
  console.log(`// Derived ${new Date().toISOString().slice(0, 10)} from ${rows.length} rows, ${minDate}..${maxDate},`);
  console.log(`// by scripts/compute-a2-thresholds.ts (deterministic: nearest-rank p90;`);
  console.log(`// rolling sum needs 3 consecutive calendar days present; mm/25.4).`);
  console.log(`// COVERAGE GAP ON RECORD: the table holds 5 hunting seasons (Sep-Feb,`);
  console.log(`// n~150/state-month) + the live era 2026-03+ only. Per-state-month n:`);
  console.log(`// ${nRange}.`);
  console.log(`// Months with any state under 60 samples (${[...fallbackMonths].sort((a, b) => a - b).join(',')}) fall back to the`);
  console.log(`// state's ALL-months p90 (same formula), then the 0.25in floor.`);
  console.log(`// Index 0 = January ... 11 = December.`);
  console.log(`const A2_P90_3DAY_IN: Record<string, number[]> = {`);
  for (const [state, t] of Object.entries(table)) {
    console.log(`  ${state}: [${t.map((v) => v.toFixed(2)).join(', ')}],`);
  }
  console.log(`};`);

  // ---- today's live fire-check ----
  console.error(`\n--- live fire-check (latest 3 days per state, mm->in, vs month threshold; point arm = any day >= 2.0in) ---`);
  for (const [state, days] of [...byState.entries()].sort()) {
    const ds = [...days.keys()].sort();
    const latest = ds[ds.length - 1];
    const d1 = addDays(latest, -1), d2 = addDays(latest, -2);
    if (!days.has(d1) || !days.has(d2)) { console.error(`${state} ${latest}: window incomplete`); continue; }
    const inches = [days.get(d2)!, days.get(d1)!, days.get(latest)!].map((m) => m / 25.4);
    const sum = inches.reduce((a, b) => a + b, 0);
    const thr = table[state][Number(latest.slice(5, 7)) - 1];
    const p90Arm = sum >= thr;
    const pointArm = inches.some((v) => v >= 2.0);
    if (p90Arm || pointArm) {
      console.error(`${state} FIRE ${latest}: 3d=${r2(sum)}in thr=${thr}in point=${pointArm} days=[${inches.map(r2).join(', ')}]`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
