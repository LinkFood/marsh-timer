/**
 * GHCN-Daily QA scan — archive-wide artifact survey + flag pass.
 *
 * Born from THE TOMATO QUESTION (2026-07-17): MD ghcn-daily state rollups
 * carried min_temp_f = 7.0 stuck for 9+ consecutive summer days — a stuck
 * sensor that rode ingest with no plausibility screen and fabricated a
 * "June 30, 2004 freeze". This scans ALL 50 states' ghcn-daily rows in
 * hunt_knowledge for the artifact signatures, and (optionally) flags them.
 *
 * SIGNATURES (survey reports all; only CONFIRMED rows get flagged):
 *   1. STUCK RUN — identical min_temp_f (or max_temp_f) repeated on >= 5
 *      consecutive calendar days. Confirmed when the run is corroborated as
 *      instrument failure: median |value - state-average| spread > 30F across
 *      the run, run length >= 10 (no real statewide extreme pins identical for
 *      10+ consecutive days), the value is seasonally impossible (below), or
 *      the same state+field+value was confirmed broken in another run (a stuck
 *      sensor stays stuck across seasons — MD's min=7 sensor ran Nov-Apr too).
 *      Uncorroborated short runs (e.g. a real weather plateau pinning the same
 *      integer max for 5 days) are reported as SUSPECT, not flagged.
 *   2. SEASONAL IMPOSSIBILITY — min_temp_f <= 15 in May-Sep outside AK
 *      (confirmed when avg_low_f - min_temp_f > 38, the verified guard-A
 *      broken-instrument ceiling; real high-mountain spreads top out ~35),
 *      or max_temp_f >= 115 in Dec-Feb (always confirmed — the US winter
 *      record high is ~100F).
 *   3. INVERSION — min_temp_f > max_temp_f (always confirmed; includes the
 *      aggregation sentinel where no station reported a high/low and the
 *      old backfill wrote 0 instead of null).
 *
 * FLAGS (supersede-don't-delete doctrine — rows are never deleted; readers
 * that care filter on metadata.qa_flag being absent):
 *   metadata.qa_flag  in: min-max-inversion | implausible-min-stuck |
 *                         implausible-max-stuck | implausible-min-seasonal |
 *                         implausible-max-seasonal
 *   metadata.qa_note  human-readable receipt ("min_temp_f=7 stuck 11d, spread 55.7F")
 *   metadata.qa_run   "ghcn-qa-2026-07-17"
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/ghcn-qa-scan.ts          # survey only
 *   FLAG=1     — apply flags after the survey (hard-stops if confirmed > 20k)
 *   ONLY_STATES=MD,VA  — limit states
 *   OUT=/tmp/ghcn-qa-artifacts.json  — artifact dump path (default that)
 *
 * Read path: keyset-paginated REST per state (order effective_date,id) —
 * never OFFSET, never psql, ~28 pages per state, ~1.4k requests total.
 * Write path: per-row PATCH merging qa fields into fetched metadata (PostgREST
 * PATCH replaces the whole jsonb column, so we read-merge-write). Gentle IO:
 * sequential PATCHes with a small delay.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}
const DO_FLAG = !!process.env.FLAG;
const OUT = process.env.OUT || "/tmp/ghcn-qa-artifacts.json";
const QA_RUN = "ghcn-qa-2026-07-17";
const FLAG_CEILING = 20_000; // above this, stop and report — no flag pass

const ONLY_STATES = process.env.ONLY_STATES
  ? process.env.ONLY_STATES.toUpperCase().split(",").map((s) => s.trim()).filter(Boolean)
  : null;

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

const headers = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY!,
  "Content-Type": "application/json",
};
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- Fetch: all ghcn-daily rows for one state (keyset pagination) ----------

interface Row {
  id: string;
  date: string; // effective_date ISO
  min: number | null;
  max: number | null;
  avgLo: number | null;
  avgHi: number | null;
  qa: string | null;
}

async function fetchPage(state: string, afterDate: string | null, afterId: string | null): Promise<Row[]> {
  let url =
    `${SUPABASE_URL}/rest/v1/hunt_knowledge` +
    `?select=id,effective_date,min:metadata->min_temp_f,max:metadata->max_temp_f,` +
    `avglo:metadata->avg_low_f,avghi:metadata->avg_high_f,qa:metadata->qa_flag` +
    `&content_type=eq.ghcn-daily&state_abbr=eq.${state}` +
    `&order=effective_date.asc,id.asc&limit=1000`;
  if (afterDate && afterId) {
    url += `&or=(effective_date.gt.${afterDate},and(effective_date.eq.${afterDate},id.gt.${afterId}))`;
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers });
      if (res.ok) {
        const rows = (await res.json()) as {
          id: string; effective_date: string; min: unknown; max: unknown;
          avglo: unknown; avghi: unknown; qa: unknown;
        }[];
        return rows.map((r) => ({
          id: r.id,
          date: r.effective_date,
          min: typeof r.min === "number" ? r.min : null,
          max: typeof r.max === "number" ? r.max : null,
          avgLo: typeof r.avglo === "number" ? r.avglo : null,
          avgHi: typeof r.avghi === "number" ? r.avghi : null,
          qa: typeof r.qa === "string" ? r.qa : null,
        }));
      }
      // Never retry 4xx — only 5xx and network errors.
      if (res.status < 500) throw new Error(`${state} page 4xx: ${res.status} ${await res.text()}`);
    } catch (err: any) {
      if (err.message?.includes("4xx")) throw err;
      /* network / 5xx — retry */
    }
    await delay((attempt + 1) * 2000);
  }
  throw new Error(`${state}: exhausted page retries`);
}

async function fetchState(state: string): Promise<Row[]> {
  const all: Row[] = [];
  let afterDate: string | null = null;
  let afterId: string | null = null;
  for (;;) {
    const page = await fetchPage(state, afterDate, afterId);
    all.push(...page);
    if (page.length < 1000) break;
    afterDate = page[page.length - 1].date;
    afterId = page[page.length - 1].id;
    await delay(100);
  }
  return all;
}

// ---------- Detection ----------

const epochDay = (iso: string) => Math.round(Date.parse(iso + "T00:00:00Z") / 86_400_000);
const monthOf = (iso: string) => Number(iso.slice(5, 7));
const yearOf = (iso: string) => Number(iso.slice(0, 4));

type FlagType =
  | "min-max-inversion"
  | "implausible-min-stuck"
  | "implausible-max-stuck"
  | "implausible-min-seasonal"
  | "implausible-max-seasonal";

interface Artifact {
  id: string;
  state: string;
  date: string;
  flag: FlagType;
  note: string;
}

interface SuspectRun {
  state: string; field: "min" | "max"; value: number;
  start: string; end: string; len: number; medianSpread: number | null;
}

interface SuspectSeasonal {
  state: string; date: string; min: number; avgLo: number | null; spread: number | null;
}

/** Find runs of identical values on consecutive calendar days, length >= 5. */
function findRuns(rows: Row[], field: "min" | "max"): { rows: Row[]; value: number }[] {
  const runs: { rows: Row[]; value: number }[] = [];
  let cur: Row[] = [];
  let prevEd = NaN;
  let prevVal: number | null = null;
  const flush = () => {
    if (cur.length >= 5 && prevVal !== null) runs.push({ rows: cur, value: prevVal });
    cur = [];
  };
  for (const r of rows) {
    const v = r[field];
    const ed = epochDay(r.date);
    if (v !== null && v === prevVal && ed === prevEd + 1) {
      cur.push(r);
    } else {
      flush();
      cur = v !== null ? [r] : [];
      prevVal = v;
    }
    prevEd = ed;
    if (v === null) prevVal = null;
  }
  flush();
  return runs;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** min <= 15F in May-Sep outside AK is beyond any real lower-48 reading at
 *  state-rollup altitude unless corroborated; the guard-A spread ceiling (38)
 *  separates broken instruments from real high-mountain cold pockets. */
const minSeasonallyImpossible = (state: string, r: Row) =>
  state !== "AK" && r.min !== null && r.min <= 15 && monthOf(r.date) >= 5 && monthOf(r.date) <= 9;

/** max >= 115F in Dec-Feb: the US winter record high is ~100F. Always an artifact. */
const maxSeasonallyImpossible = (r: Row) =>
  r.max !== null && r.max >= 115 && [12, 1, 2].includes(monthOf(r.date));

function scanState(state: string, rows: Row[]) {
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const flagged = new Map<string, Artifact>(); // id -> artifact (first flag wins by priority order below)
  const suspects: SuspectRun[] = [];
  const add = (r: Row, flag: FlagType, note: string) => {
    if (!flagged.has(r.id)) flagged.set(r.id, { id: r.id, state, date: r.date, flag, note });
  };

  // 1. Inversions — always confirmed.
  for (const r of rows) {
    if (r.min !== null && r.max !== null && r.min > r.max) {
      add(r, "min-max-inversion",
        `min_temp_f=${r.min} > max_temp_f=${r.max}` + (r.max === 0 || r.min === 0 ? " (0 = no-reading sentinel from old backfill)" : ""));
    }
  }

  // 2. Stuck runs — min and max. Two passes: first confirm runs on their own
  // evidence (spread / length / seasonal impossibility), collecting the
  // known-bad (field, value) set; then re-judge the leftovers — a value
  // already proven broken in this state confirms its other runs (the same
  // stuck sensor rides through seasons where the spread test can't see it).
  for (const field of ["min", "max"] as const) {
    const runs = findRuns(rows, field).map((run) => {
      const spreads = run.rows
        .map((r) => (field === "min"
          ? (r.avgLo !== null && r.min !== null ? r.avgLo - r.min : null)
          : (r.avgHi !== null && r.max !== null ? r.max - r.avgHi : null)))
        .filter((s): s is number => s !== null);
      const med = median(spreads);
      const seasonal = run.rows.some((r) =>
        field === "min" ? minSeasonallyImpossible(state, r) : maxSeasonallyImpossible(r));
      return { ...run, med, seasonal };
    });
    const knownBad = new Set<number>();
    for (const run of runs) {
      // Confirmation: spread > 30 (guard-A altitude), OR a 10+ day identical
      // pin sitting > 15F from the state average (real plateaus pin NEAR the
      // average — HI max=89 for 10 days is weather; MD min=7 in December is
      // not), OR seasonal impossibility anywhere in the run.
      if ((run.med !== null && run.med > 30) ||
          (run.rows.length >= 10 && run.med !== null && run.med > 15) ||
          run.seasonal) {
        knownBad.add(run.value);
      }
    }
    for (const run of runs) {
      if (knownBad.has(run.value)) {
        const flag = field === "min" ? "implausible-min-stuck" : "implausible-max-stuck";
        const note =
          `${field}_temp_f=${run.value} stuck ${run.rows.length}d ` +
          `(${run.rows[0].date}..${run.rows[run.rows.length - 1].date}` +
          (run.med !== null ? `, median spread ${Math.round(run.med * 10) / 10}F` : "") + ")";
        for (const r of run.rows) add(r, flag, note);
      } else {
        suspects.push({
          state, field, value: run.value,
          start: run.rows[0].date, end: run.rows[run.rows.length - 1].date,
          len: run.rows.length, medianSpread: run.med,
        });
      }
    }
  }

  // 3. Seasonal impossibilities outside runs. Candidates without spread
  // corroboration (a real Rockies cold sink can hit the low teens in
  // May/Sep with spreads up to ~35) are reported as SUSPECT, not flagged.
  const suspectSeasonal: SuspectSeasonal[] = [];
  for (const r of rows) {
    if (minSeasonallyImpossible(state, r)) {
      const spread = r.avgLo !== null && r.min !== null ? r.avgLo - r.min : null;
      if (spread !== null && spread > 38) {
        add(r, "implausible-min-seasonal",
          `min_temp_f=${r.min} in month ${monthOf(r.date)}, avg_low_f=${r.avgLo} (spread ${Math.round(spread * 10) / 10}F)`);
      } else if (!flagged.has(r.id)) {
        suspectSeasonal.push({ state, date: r.date, min: r.min!, avgLo: r.avgLo, spread });
      }
    }
    if (maxSeasonallyImpossible(r)) {
      add(r, "implausible-max-seasonal", `max_temp_f=${r.max} in month ${monthOf(r.date)}`);
    }
  }

  return { artifacts: [...flagged.values()], suspects, suspectSeasonal, scanned: rows.length };
}

// ---------- Flag pass (read-merge-write; PATCH replaces whole jsonb) ----------

async function applyFlags(artifacts: Artifact[]): Promise<{ patched: number; skipped: number; failed: number }> {
  let patched = 0, skipped = 0, failed = 0;
  for (let i = 0; i < artifacts.length; i += 100) {
    const chunk = artifacts.slice(i, i + 100);
    const byId = new Map(chunk.map((a) => [a.id, a]));
    const ids = chunk.map((a) => a.id).join(",");
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/hunt_knowledge?select=id,metadata&id=in.(${ids})`,
      { headers },
    );
    if (!res.ok) throw new Error(`flag-pass fetch failed: ${res.status} ${await res.text()}`);
    const rows = (await res.json()) as { id: string; metadata: Record<string, unknown> | null }[];
    for (const row of rows) {
      const a = byId.get(row.id)!;
      const meta = row.metadata ?? {};
      if (meta.qa_flag === a.flag) { skipped++; continue; } // idempotent rerun
      const merged = { ...meta, qa_flag: a.flag, qa_note: a.note, qa_run: QA_RUN };
      let ok = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const p = await fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge?id=eq.${row.id}`, {
            method: "PATCH",
            headers: { ...headers, Prefer: "return=minimal" },
            body: JSON.stringify({ metadata: merged }),
          });
          if (p.ok) { ok = true; break; }
          if (p.status < 500) { console.error(`  PATCH 4xx ${row.id}: ${p.status} ${await p.text()}`); break; }
        } catch { /* network — retry */ }
        await delay((attempt + 1) * 2000);
      }
      if (ok) patched++; else failed++;
      await delay(30); // gentle IO
    }
    if ((patched + skipped + failed) % 1000 < 100 || i + 100 >= artifacts.length) {
      console.log(`  flag pass: ${patched + skipped + failed}/${artifacts.length} (${patched} patched, ${skipped} already-flagged, ${failed} failed)`);
    }
  }
  return { patched, skipped, failed };
}

// ---------- Main ----------

async function main() {
  const states = ONLY_STATES ? STATES.filter((s) => ONLY_STATES.includes(s)) : STATES;
  console.log(`=== GHCN-Daily QA scan: ${states.length} states ===`);

  const allArtifacts: Artifact[] = [];
  const allSuspects: SuspectRun[] = [];
  const allSuspectSeasonal: SuspectSeasonal[] = [];
  const stateSummaries: Record<string, { scanned: number; years: number[]; byType: Record<string, number> }> = {};

  // Modest read concurrency: 4 states in flight (readers fan out; writers never).
  for (let i = 0; i < states.length; i += 4) {
    const batch = states.slice(i, i + 4);
    const results = await Promise.all(batch.map(async (state) => {
      const t0 = Date.now();
      const rows = await fetchState(state);
      const scan = scanState(state, rows);
      return { state, scan, secs: Math.round((Date.now() - t0) / 1000) };
    }));
    for (const { state, scan, secs } of results) {
      const byType: Record<string, number> = {};
      const years = new Set<number>();
      for (const a of scan.artifacts) {
        byType[a.flag] = (byType[a.flag] ?? 0) + 1;
        years.add(yearOf(a.date));
      }
      stateSummaries[state] = { scanned: scan.scanned, years: [...years].sort((a, b) => a - b), byType };
      allArtifacts.push(...scan.artifacts);
      allSuspects.push(...scan.suspects);
      allSuspectSeasonal.push(...scan.suspectSeasonal);
      const typeStr = Object.entries(byType).map(([k, v]) => `${k}:${v}`).join(" ") || "clean";
      console.log(
        `${state}: ${scan.scanned} rows | confirmed ${scan.artifacts.length} [${typeStr}] | ` +
        `suspect runs ${scan.suspects.length} | ${secs}s`,
      );
    }
  }

  // Damage map
  const totalByType: Record<string, number> = {};
  for (const a of allArtifacts) totalByType[a.flag] = (totalByType[a.flag] ?? 0) + 1;
  console.log(`\n=== DAMAGE MAP ===`);
  console.log(`Confirmed artifact rows: ${allArtifacts.length}`);
  for (const [k, v] of Object.entries(totalByType).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
  console.log(`Suspect (unconfirmed, NOT flagged) stuck runs: ${allSuspects.length} runs / ${allSuspects.reduce((s, r) => s + r.len, 0)} days`);
  console.log(`Suspect (unconfirmed, NOT flagged) seasonal min days: ${allSuspectSeasonal.length}`);

  const fs = await import("node:fs");
  fs.writeFileSync(OUT, JSON.stringify({ qa_run: QA_RUN, stateSummaries, artifacts: allArtifacts, suspects: allSuspects, suspectSeasonal: allSuspectSeasonal }, null, 1));
  console.log(`Artifact dump: ${OUT}`);

  if (!DO_FLAG) {
    console.log(`\nSurvey only — rerun with FLAG=1 to apply metadata flags.`);
    return;
  }
  if (allArtifacts.length > FLAG_CEILING) {
    console.error(`\nSTOP: ${allArtifacts.length} confirmed rows exceeds the ${FLAG_CEILING} flag ceiling — report first, flag after sign-off.`);
    process.exit(2);
  }
  console.log(`\n=== FLAG PASS: ${allArtifacts.length} rows ===`);
  const { patched, skipped, failed } = await applyFlags(allArtifacts);
  console.log(`Done: ${patched} patched, ${skipped} already-flagged, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
