/**
 * embed-era5-pressure.ts — THE EMBEDDING LAW LANE, deliberately separated.
 *
 * ── THE PROBLEM, STATED PLAINLY ─────────────────────────────────────────────
 * CLAUDE.md: "THE EMBEDDING LAW: Every piece of data MUST be embedded via Voyage
 * AI → hunt_knowledge. No exceptions." Also CLAUDE.md: "NEVER batch embed more
 * than 20 entries — Voyage times out."
 *
 * The ERA5 backfill lands 868,350 state-day rows. At 20 per batch that is
 * **43,418 Voyage batches**. Nobody should discover that number halfway through a
 * run, and no script should quietly commit to it as a side effect of an ingest.
 * So the archive write (backfill-era5-pressure.ts → era5_state_pressure) and this
 * lane are separate programs with separate checkpoints, and this one does not run
 * unless someone chooses a MODE.
 *
 * ── THE FOUR OPTIONS, PRICED ────────────────────────────────────────────────
 * Measured/derived against the real backfill window (1979-01-01 → 2026-07-19,
 * 50 states). Dollar figures assume voyage-3-lite at $0.02 / 1M tokens and a
 * ~55-token narrative — verify the rate before spending, but the ORDER of the
 * options does not depend on it.
 *
 *   MODE=days   — the literal law. One row per state-day.
 *                 868,350 rows · 43,418 batches · ~47.8M tokens · ~$0.96
 *                 ~20 h serial (1.7 s/batch incl. insert + the 500 ms pause)
 *                 hunt_knowledge 7.6M → 8.47M rows (+11.4%)
 *                 ⚠ The real cost is not the dollar. It is +11% on a table whose
 *                   IVFFlat index is ALREADY the known bottleneck — lists=2645
 *                   was sized for 7M and the rebuild migration
 *                   (20260414100018) is committed but UNAPPLIED. This mode makes
 *                   a pending problem worse before it is fixed.
 *
 *   MODE=months — one narrative per state-month: the month's mean, its deepest
 *                 24 h fall and the date of it, its highest and lowest days.
 *                 28,550 rows · 1,428 batches · ~$0.03 · ~40 min · +0.4% rows
 *
 *   MODE=events — one narrative per notable fall (|delta| at or beyond
 *                 EVENT_THRESHOLD_HPA, default 12). Each is individually
 *                 retrievable by the brain, which is what the vector space is
 *                 actually for.
 *                 ~25k rows · ~1,250 batches · ~$0.03 · ~35 min · +0.3% rows
 *
 *   MODE=months+events — RECOMMENDED, and the default. Nothing is invisible to
 *                 the brain (every month is described) and every day that
 *                 matters is individually addressable.
 *                 ~54k rows · ~2,700 batches · ~$0.06 · ~1.3 h · +0.7% rows
 *
 * ── THE ARGUMENT FOR months+events, WHICH IS NOT MINE TO ACCEPT ─────────────
 * The law's purpose is that no data is invisible to the brain. 365 near-identical
 * sentences a year per state does not serve that purpose better than 12 plus the
 * days that were actually unusual — it serves it worse, because 868k
 * low-information vectors dilute every similarity search that runs against them,
 * and scanBrainOnWrite fires on each one. The *data* is not lost either way: it
 * is all in era5_state_pressure, queryable exactly, with source_url provenance
 * per row, and the frame/LUT path reads that table, not hunt_knowledge.
 *
 * But "the law says every piece of data" is not ambiguous, and Ruling 6 is
 * explicit: **where the spec is silent or ambiguous, resolve against the looser
 * reading and surface it — do not resolve a gap in your own favour and proceed.**
 * So this script implements the literal reading (MODE=days) as a first-class
 * option, refuses to run without an explicit MODE, and leaves the choice where it
 * belongs. It is a decision, not a default.
 *
 * ── ONE WRITE PIPE ──────────────────────────────────────────────────────────
 * This writes hunt_knowledge. The backfill writes era5_state_pressure. They are
 * still two write pipes and the doctrine is one at a time: finish the archive,
 * then run this.
 *
 * Usage:
 *   MODE=months+events npx tsx scripts/era5/embed-era5-pressure.ts --plan     # no network, no writes
 *   MODE=months+events npx tsx scripts/era5/embed-era5-pressure.ts --dry-run  # reads DB, prints narratives, NO writes
 *   MODE=months+events npx tsx scripts/era5/embed-era5-pressure.ts            # THE RUN
 *   npx tsx scripts/era5/embed-era5-pressure.ts --status
 *
 * Env: VOYAGE_API_KEY (required to run), SUPABASE_SERVICE_ROLE_KEY,
 *      MODE, ONLY_STATES, EVENT_THRESHOLD_HPA (default 12)
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { SAMPLING_VERSION, ERA5_STATES } from "./sampling.ts";
import { STATE_CENTROIDS } from "../../supabase/functions/_shared/states.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKPOINT_FILE = join(HERE, ".era5-embed-checkpoint.json");
const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";

/** CLAUDE.md, absolute: never more than 20. Voyage times out past it. */
const VOYAGE_BATCH = 20;
const CONTENT_TYPE = "era5-state-pressure";
const EVENT_THRESHOLD = Number(process.env.EVENT_THRESHOLD_HPA || 12);
const MODES = ["days", "months", "events", "months+events"] as const;
export type Mode = (typeof MODES)[number];
const MODE = process.env.MODE as Mode | undefined;

const ONLY_STATES = process.env.ONLY_STATES
  ? process.env.ONLY_STATES.toUpperCase().split(",").map((s) => s.trim()).filter(Boolean)
  : null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const fmtDate = (iso: string) => { const [y, m, d] = iso.split("-"); return `${MONTHS[+m - 1]} ${+d}, ${y}`; };

// ─── Keys / HTTP ─────────────────────────────────────────────────────────────

function bootstrapKeys() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const out = execSync("npx supabase projects api-keys --project-ref rvhyotvklfowklzjahdd --output json 2>/dev/null", { encoding: "utf-8", timeout: 30000 }).trim();
    const key = JSON.parse(out).find((k: any) => k.id === "service_role" || k.name === "service_role")?.api_key;
    if (!key || !key.startsWith("ey")) { console.error("  ✗ SUPABASE_SERVICE_ROLE_KEY — CLI returned no key."); process.exit(1); }
    process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  }
}
function supaHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" };
}
class FatalHttpError extends Error {}
async function fetchWithRetry(url: string, init: RequestInit, label: string, attempts = 5): Promise<Response> {
  let lastErr: any;
  for (let a = 1; a <= attempts; a++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      const body = (await res.text()).slice(0, 300);
      // 429 is the one retryable 4xx and only because it is a throttle, not a
      // malformed request — the same carve-out backfill-ghcn-daily.ts:614 makes.
      if (res.status === 429) { lastErr = new Error(`${label} 429`); await sleep(30000 * a); continue; }
      if (res.status >= 400 && res.status < 500) throw new FatalHttpError(`${label} ${res.status}: ${body}`);
      lastErr = new Error(`${label} ${res.status}: ${body}`);
    } catch (e: any) { if (e instanceof FatalHttpError) throw e; lastErr = e; }
    if (a < attempts) await sleep(Math.min(2000 * 2 ** (a - 1), 30000));
  }
  throw lastErr;
}

async function batchEmbed(texts: string[]): Promise<number[][]> {
  if (texts.length > VOYAGE_BATCH) throw new Error(`batch ${texts.length} > ${VOYAGE_BATCH} — the law`);
  const res = await fetchWithRetry(VOYAGE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "voyage-3-lite", input: texts, input_type: "document" }),
  }, "voyage");
  const data = await res.json();
  if (!Array.isArray(data?.data)) throw new Error("voyage returned a non-array");
  return data.data.map((d: { embedding: number[] }) => d.embedding);
}

// ─── Source read ─────────────────────────────────────────────────────────────

export type Row = { day: string; mean: number; min: number | null; max: number | null; delta: number | null; n: number; spread: number | null; url: string };

async function readState(state: string): Promise<Row[]> {
  const out: Row[] = [];
  let offset = 0;
  while (true) {
    const res = await fetchWithRetry(
      `${SUPABASE_URL}/rest/v1/era5_state_pressure?state_abbr=eq.${state}&sampling_version=eq.${SAMPLING_VERSION}` +
      `&select=day,pressure_msl_mean,pressure_msl_min,pressure_msl_max,pressure_delta_24h,n_points,spread_hpa,source_url` +
      `&order=day.asc&limit=1000&offset=${offset}`,
      { headers: supaHeaders() }, `era5 read ${state}`,
    );
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error(`non-array for ${state}`);
    for (const r of rows) out.push({
      day: r.day, mean: Number(r.pressure_msl_mean),
      min: r.pressure_msl_min === null ? null : Number(r.pressure_msl_min),
      max: r.pressure_msl_max === null ? null : Number(r.pressure_msl_max),
      delta: r.pressure_delta_24h === null ? null : Number(r.pressure_delta_24h),
      n: r.n_points, spread: r.spread_hpa === null ? null : Number(r.spread_hpa),
      url: r.source_url,
    });
    if (rows.length < 1000) break;
    offset += 1000;
  }
  return out;
}

// ─── Narratives ──────────────────────────────────────────────────────────────
// Fact-only, denominator-honest, no forecast verbs. "Show don't predict."

type Entry = {
  title: string; content: string; tags: string[]; effective_date: string;
  metadata: Record<string, unknown>;
};

const nameOf = (s: string) => STATE_CENTROIDS[s]?.name ?? s;

function dayEntry(state: string, r: Row): Entry {
  const n = nameOf(state);
  let t = `On ${fmtDate(r.day)}, mean sea-level pressure over ${n} averaged ${r.mean.toFixed(1)} hPa across five ERA5 sample points`;
  t += r.min !== null && r.max !== null ? `, ranging from ${r.min.toFixed(1)} to ${r.max.toFixed(1)} hPa through the day.` : ".";
  if (r.delta !== null) {
    t += r.delta <= -1
      ? ` Pressure fell ${Math.abs(r.delta).toFixed(1)} hPa from the day before.`
      : r.delta >= 1
        ? ` Pressure rose ${r.delta.toFixed(1)} hPa from the day before.`
        : ` Pressure was steady, within ${Math.abs(r.delta).toFixed(1)} hPa of the day before.`;
  }
  if (r.spread !== null) t += ` Spread across the five points was ${r.spread.toFixed(1)} hPa.`;
  return {
    title: `ERA5 State Pressure ${state} ${r.day}`,
    content: t,
    tags: [state, "pressure", "era5", "reanalysis", "daily-observation", "historical"],
    effective_date: r.day,
    metadata: {
      source: "era5-open-meteo", kind: "day", state, date: r.day,
      pressure_msl_mean: r.mean, pressure_msl_min: r.min, pressure_msl_max: r.max,
      pressure_delta_24h: r.delta, n_points: r.n, spread_hpa: r.spread,
      sampling_version: SAMPLING_VERSION, source_url: r.url,
      source_event_id: `era5-pressure:v${SAMPLING_VERSION}:${state}:${r.day}`,
    },
  };
}

function monthEntries(state: string, rows: Row[]): Entry[] {
  const n = nameOf(state);
  const by = new Map<string, Row[]>();
  for (const r of rows) {
    const k = r.day.slice(0, 7);
    (by.get(k) ?? by.set(k, []).get(k)!).push(r);
  }
  const out: Entry[] = [];
  for (const [ym, rs] of [...by].sort()) {
    const [y, m] = ym.split("-");
    const mean = rs.reduce((a, b) => a + b.mean, 0) / rs.length;
    const hi = rs.reduce((a, b) => (b.mean > a.mean ? b : a));
    const lo = rs.reduce((a, b) => (b.mean < a.mean ? b : a));
    const withD = rs.filter((r) => r.delta !== null);
    const fall = withD.length ? withD.reduce((a, b) => (b.delta! < a.delta! ? b : a)) : null;
    const rise = withD.length ? withD.reduce((a, b) => (b.delta! > a.delta! ? b : a)) : null;

    let t = `Over ${MONTHS[+m - 1]} ${y}, mean sea-level pressure across ${n} averaged ${mean.toFixed(1)} hPa on ${rs.length} days, measured as the mean of five ERA5 sample points.`;
    t += ` The highest daily mean was ${hi.mean.toFixed(1)} hPa on ${fmtDate(hi.day)} and the lowest was ${lo.mean.toFixed(1)} hPa on ${fmtDate(lo.day)}.`;
    if (fall && fall.delta! < 0) t += ` The steepest 24-hour fall was ${Math.abs(fall.delta!).toFixed(1)} hPa on ${fmtDate(fall.day)}.`;
    if (rise && rise.delta! > 0) t += ` The steepest 24-hour rise was ${rise.delta!.toFixed(1)} hPa on ${fmtDate(rise.day)}.`;
    const nFalls = withD.filter((r) => r.delta! <= -EVENT_THRESHOLD).length;
    t += ` ${nFalls === 0 ? "No day" : nFalls === 1 ? "One day" : `${nFalls} days`} fell ${EVENT_THRESHOLD} hPa or more in 24 hours.`;

    out.push({
      title: `ERA5 State Pressure Month ${state} ${ym}`,
      content: t,
      tags: [state, "pressure", "era5", "reanalysis", "monthly-summary", "historical"],
      effective_date: `${ym}-01`,
      metadata: {
        source: "era5-open-meteo", kind: "month", state, month: ym, n_days: rs.length,
        mean_hpa: Math.round(mean * 100) / 100,
        max_day: hi.day, max_hpa: hi.mean, min_day: lo.day, min_hpa: lo.mean,
        steepest_fall_hpa: fall?.delta ?? null, steepest_fall_day: fall?.day ?? null,
        steepest_rise_hpa: rise?.delta ?? null, steepest_rise_day: rise?.day ?? null,
        falls_at_threshold: nFalls, event_threshold_hpa: EVENT_THRESHOLD,
        sampling_version: SAMPLING_VERSION,
        source_event_id: `era5-pressure-month:v${SAMPLING_VERSION}:${state}:${ym}`,
      },
    });
  }
  return out;
}

function eventEntries(state: string, rows: Row[]): Entry[] {
  const n = nameOf(state);
  return rows
    .filter((r) => r.delta !== null && Math.abs(r.delta) >= EVENT_THRESHOLD)
    .map((r) => {
      const fell = r.delta! < 0;
      let t = `On ${fmtDate(r.day)}, mean sea-level pressure over ${n} ${fell ? "fell" : "rose"} ${Math.abs(r.delta!).toFixed(1)} hPa in 24 hours, to a daily mean of ${r.mean.toFixed(1)} hPa`;
      t += r.min !== null ? `, bottoming at ${r.min.toFixed(1)} hPa.` : ".";
      t += ` Measured as the mean of five ERA5 sample points across ${n}`;
      t += r.spread !== null ? `, which differed by ${r.spread.toFixed(1)} hPa that day.` : ".";
      t += ` ${fell ? "A fall" : "A rise"} of this size is the signature of a synoptic system crossing the state.`;
      return {
        title: `ERA5 Pressure ${fell ? "Fall" : "Rise"} ${state} ${r.day}`,
        content: t,
        tags: [state, "pressure", "era5", "reanalysis", fell ? "pressure-fall" : "pressure-rise", "historical"],
        effective_date: r.day,
        metadata: {
          source: "era5-open-meteo", kind: "event", state, date: r.day,
          pressure_msl_mean: r.mean, pressure_msl_min: r.min, pressure_msl_max: r.max,
          pressure_delta_24h: r.delta, n_points: r.n, spread_hpa: r.spread,
          event_threshold_hpa: EVENT_THRESHOLD, sampling_version: SAMPLING_VERSION,
          source_url: r.url,
          source_event_id: `era5-pressure-event:v${SAMPLING_VERSION}:${state}:${r.day}`,
        },
      };
    });
}

export function entriesFor(mode: Mode, state: string, rows: Row[]): Entry[] {
  switch (mode) {
    case "days": return rows.map((r) => dayEntry(state, r));
    case "months": return monthEntries(state, rows);
    case "events": return eventEntries(state, rows);
    case "months+events": return [...monthEntries(state, rows), ...eventEntries(state, rows)];
  }
}

// ─── Idempotency ─────────────────────────────────────────────────────────────
// hunt_knowledge has no unique constraint, so — exactly as
// backfill-ghcn-daily.ts:15-19 does it — the real mechanism is diffing against
// what is already there. Here the key is metadata.source_event_id, which is
// stable per entry and per mode.

async function existingEventIds(state: string): Promise<Set<string>> {
  const out = new Set<string>();
  let offset = 0;
  while (true) {
    const res = await fetchWithRetry(
      `${SUPABASE_URL}/rest/v1/hunt_knowledge?content_type=eq.${CONTENT_TYPE}&state_abbr=eq.${state}` +
      `&select=eid:metadata->>source_event_id&limit=1000&offset=${offset}`,
      { headers: supaHeaders() }, `existing ${state}`,
    );
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error(`non-array existing for ${state}`);
    for (const r of rows) if (r.eid) out.add(r.eid);
    if (rows.length < 1000) break;
    offset += 1000;
  }
  return out;
}

async function insertBatch(rows: Record<string, unknown>[]) {
  await fetchWithRetry(`${SUPABASE_URL}/rest/v1/hunt_knowledge`, {
    method: "POST",
    headers: { ...supaHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify(rows),
  }, "hunt_knowledge insert");
}

// ─── Checkpoint ──────────────────────────────────────────────────────────────

type Checkpoint = { mode: Mode | null; doneStates: string[]; embedded: number };
function loadCheckpoint(): Checkpoint {
  if (existsSync(CHECKPOINT_FILE)) { try { return JSON.parse(readFileSync(CHECKPOINT_FILE, "utf-8")); } catch {} }
  return { mode: null, doneStates: [], embedded: 0 };
}
function saveCheckpoint(cp: Checkpoint) { writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2) + "\n"); }

// ─── Modes ───────────────────────────────────────────────────────────────────

function requireMode(): Mode {
  if (!MODE || !MODES.includes(MODE)) {
    console.error(
      `  ✗ MODE is required and there is deliberately no default.\n\n` +
      `    MODE=days           the literal Embedding Law — 868,350 rows, 43,418 Voyage\n` +
      `                        batches, ~20 h, and +11.4% on a hunt_knowledge whose\n` +
      `                        IVFFlat rebuild is already pending and unapplied.\n` +
      `    MODE=months         28,550 rows, 1,428 batches, ~40 min.\n` +
      `    MODE=events         ~25k rows at |delta| >= ${EVENT_THRESHOLD} hPa, ~35 min.\n` +
      `    MODE=months+events  ~54k rows, ~2,700 batches, ~1.3 h. Recommended.\n\n` +
      `    Read this file's header before choosing. It is a decision, not a default,\n` +
      `    and the numbers differ by a factor of sixteen.`,
    );
    process.exit(1);
  }
  return MODE;
}

function roster(): string[] {
  return ONLY_STATES ? ERA5_STATES.filter((s) => ONLY_STATES.includes(s)) : ERA5_STATES;
}

function plan() {
  const mode = requireMode();
  const days = 17_367, states = roster().length;
  const perState: Record<Mode, number> = {
    days, months: 571, events: 500, "months+events": 1071,
  };
  const rows = perState[mode] * states;
  const batches = Math.ceil(rows / VOYAGE_BATCH);
  console.log(`=== EMBED PLAN — MODE=${mode} (offline estimate, no network, no writes) ===`);
  console.log(`  states ${states} | rows ~${rows.toLocaleString()} | Voyage batches ~${batches.toLocaleString()} (${VOYAGE_BATCH}/batch)`);
  console.log(`  tokens ~${(rows * 55 / 1e6).toFixed(1)}M → ~$${(rows * 55 / 1e6 * 0.02).toFixed(2)} at voyage-3-lite $0.02/1M`);
  console.log(`  wall clock ~${(batches * 1.7 / 3600).toFixed(1)} h serial`);
  console.log(`  hunt_knowledge 7.6M → ${((7.6e6 + rows) / 1e6).toFixed(2)}M (+${(rows / 7.6e6 * 100).toFixed(1)}%)`);
  if (mode === "days") {
    console.log(`\n  ⚠ MODE=days also fires scanBrainOnWrite-shaped pressure on 868k near-identical`);
    console.log(`    vectors and lands on top of the UNAPPLIED IVFFlat rebuild (lists=2645 was`);
    console.log(`    sized for 7M rows). Apply 20260414100018 first or do not run this mode.`);
  }
  console.log(`\n  The event counts for MODE=events are an ESTIMATE at |delta| >= ${EVENT_THRESHOLD} hPa.`);
  console.log(`  Run --dry-run against a real state to replace it with a measurement.`);
}

async function dryRun() {
  const mode = requireMode();
  bootstrapKeys();
  const state = (process.env.DRY_STATE || "MD").toUpperCase();
  console.log(`=== EMBED DRY RUN — MODE=${mode} ${state} — reads only, NO WRITES, NO VOYAGE CALLS ===`);
  const rows = await readState(state);
  if (rows.length === 0) {
    console.log(`  no era5_state_pressure rows for ${state} — run the archive backfill first.`);
    return;
  }
  const entries = entriesFor(mode, state, rows);
  console.log(`  ${rows.length.toLocaleString()} source days → ${entries.length.toLocaleString()} entries → ${Math.ceil(entries.length / VOYAGE_BATCH).toLocaleString()} batches`);
  console.log(`  extrapolated to ${roster().length} states: ~${(entries.length * roster().length).toLocaleString()} rows, ~${Math.ceil(entries.length * roster().length / VOYAGE_BATCH).toLocaleString()} batches`);
  for (const e of [entries[0], entries[Math.floor(entries.length / 2)], entries[entries.length - 1]]) {
    console.log(`\n  ─ ${e.title}  (${e.effective_date})`);
    console.log(`    ${e.content}`);
  }
  console.log(`\n=== DRY RUN COMPLETE — nothing embedded, nothing written ===`);
}

async function run() {
  const mode = requireMode();
  if (!process.env.VOYAGE_API_KEY) { console.error("  ✗ VOYAGE_API_KEY required"); process.exit(1); }
  bootstrapKeys();
  const cp = loadCheckpoint();
  if (cp.mode && cp.mode !== mode) {
    console.error(`  ✗ checkpoint holds MODE=${cp.mode}, you asked for ${mode}. Finish or delete ${CHECKPOINT_FILE}.`);
    process.exit(1);
  }
  cp.mode = mode;
  const done = new Set(cp.doneStates);
  let failures = 0;

  console.log(`=== EMBED ERA5 PRESSURE — MODE=${mode} ===`);
  for (const state of roster()) {
    if (done.has(state)) continue;
    const rows = await readState(state);
    if (!rows.length) { console.log(`  ${state}: no source rows, skipped`); continue; }
    const entries = entriesFor(mode, state, rows);
    const already = await existingEventIds(state);
    const todo = entries.filter((e) => !already.has(e.metadata.source_event_id as string));

    let landed = 0;
    for (let i = 0; i < todo.length; i += VOYAGE_BATCH) {
      const batch = todo.slice(i, i + VOYAGE_BATCH);
      try {
        const vecs = await batchEmbed(batch.map((e) => e.content));
        await insertBatch(batch.map((e, k) => ({
          title: e.title, content: e.content, content_type: CONTENT_TYPE,
          tags: e.tags, state_abbr: state, species: null,
          effective_date: e.effective_date, metadata: e.metadata,
          embedding: JSON.stringify(vecs[k]),
        })));
        landed += batch.length;
      } catch (err) {
        console.error(`    ✗ ${state} batch @${i}: ${err}`);
        failures += batch.length;
      }
      await sleep(500);
    }
    done.add(state); cp.doneStates = [...done]; cp.embedded += landed; saveCheckpoint(cp);
    console.log(`  ✓ ${state}: ${landed}/${todo.length} embedded (${already.size} already present)`);
  }
  console.log(`\n=== ${cp.embedded.toLocaleString()} embedded total ===`);
  if (failures) { console.error(`=== ${failures} FAILURES — data is incomplete, re-run to fill gaps ===`); process.exit(1); }
}

function status() {
  const cp = loadCheckpoint();
  console.log(`mode: ${cp.mode ?? "none"} | states done: ${cp.doneStates.length}/${ERA5_STATES.length} | embedded: ${cp.embedded.toLocaleString()}`);
}

async function main() {
  const arg = process.argv[2] || "";
  if (arg === "--plan") return plan();
  if (arg === "--dry-run") return dryRun();
  if (arg === "--status") return status();
  return run();
}
// Only run when executed directly — the entry builders are importable for tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
}
