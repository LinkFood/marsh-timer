/**
 * Dedupe v2 storm-event rows — non-destructive supersede sweep.
 *
 * WHY: the 2026-07-05 NCEI re-ingest left a small class of duplicate v2 rows.
 * Two mechanisms, both in scripts/ncei-reingest.ts, both now fixed there:
 *   1. existingEventIds() paginated with unordered limit/offset; the DC-era
 *      rerun (07-05 ~21:44) ran that check while the v1 supersede UPDATE pass
 *      churned hunt_knowledge, pages shifted, existing ids were silently
 *      missed, and those events re-inserted. (Fix: keyset pagination on id.)
 *   2. A retried batch POST can double-commit when the first attempt lands
 *      but the response is lost ("fetch failed"). (No unique constraint on
 *      source_event_id — documented at insertRows.)
 *
 * WHAT THIS DOES: stream ALL LIVE v2 rows (content_type=storm-event,
 * metadata.ingest_v=2, metadata.superseded is null) in created_at keyset order
 * over the (content_type, created_at) compound index — every v2 row was created
 * ≥ 2026-07-05, so the range is tight and the plan is stable (per-effective-year
 * windows flipped to a bad plan on some years and 57014'd). Group by
 * metadata.source_event_id; any EVENT_ID with >1 live row keeps its OLDEST
 * created_at row (tie-break: lowest id) and the extras are PATCHed with
 * metadata.superseded=true + metadata.superseded_reason='v2-duplicate'.
 * Readers already filter metadata->superseded is null — extras vanish from
 * every surface with zero reader changes. NOTHING IS EVER DELETED.
 *
 * Usage:
 *   npx tsx scripts/dedupe-v2-storms.ts            # scan only (default) — report, no writes
 *   npx tsx scripts/dedupe-v2-storms.ts --commit   # scan + PATCH extras
 *   npx tsx scripts/dedupe-v2-storms.ts --status   # last commit summary
 *
 * Ops: keyset pagination (created_at cursor, tie-safe overlap dedup) — stable
 * under concurrent churn. Retries 5xx/network only, NEVER 4xx. Idempotent:
 * superseded extras drop out of the live scan, so a rerun converges to zero work.
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const CHECKPOINT_FILE = join(SCRIPTS_DIR, ".dedupe-v2-storms-checkpoint.json");
const PAGE_SIZE = 1000; // PostgREST cap — keyset pages, never offset

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function bootstrapKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const out = execSync(
      "npx supabase projects api-keys --project-ref rvhyotvklfowklzjahdd 2>/dev/null",
      { encoding: "utf-8", timeout: 60_000, cwd: join(SCRIPTS_DIR, "..") }
    ).trim();
    let key = "";
    try {
      const parsed = JSON.parse(out);
      key = (parsed.keys || parsed || []).find?.((k: any) => k.name === "service_role" || k.id === "service_role")?.api_key || "";
    } catch {
      const line = out.split("\n").find((l) => l.includes("service_role"));
      key = line ? line.trim().split(/\s+/).pop() || "" : "";
    }
    if (!key.startsWith("ey")) throw new Error("empty");
    process.env.SUPABASE_SERVICE_ROLE_KEY = key;
    console.log("  ✓ SUPABASE_SERVICE_ROLE_KEY — fetched from CLI");
  } catch {
    console.error("  ✗ SUPABASE_SERVICE_ROLE_KEY — export it and rerun.");
    process.exit(1);
  }
}
function supaHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" };
}

class FatalHttpError extends Error {}
async function fetchWithRetry(url: string, init: RequestInit, label: string, attempts = 5): Promise<Response> {
  let lastErr: any;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      const body = (await res.text()).slice(0, 300);
      if (res.status >= 400 && res.status < 500) {
        throw new FatalHttpError(`${label} ${res.status} (4xx, no retry): ${body}`);
      }
      lastErr = new Error(`${label} ${res.status}: ${body}`);
    } catch (err: any) {
      if (err instanceof FatalHttpError) throw err;
      lastErr = err;
    }
    if (attempt < attempts) {
      const wait = Math.min(2000 * 2 ** (attempt - 1), 30_000);
      console.log(`  ${label}: attempt ${attempt} failed (${String(lastErr).slice(0, 140)}), retrying in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

type LiveRow = { id: string; created_at: string; effective_date: string; sid: string | null };

// Scan lane per state_abbr, keyset on effective_date — this is the exact shape
// of the partial index idx_storm_live_state_date (state_abbr, effective_date)
// WHERE content_type='storm-event' AND metadata->'superseded' IS NULL, so every
// page is a pure index walk (~0.5s). NOTE the `->` filter form: it must match
// the index predicate for planner implication — `->>` does NOT ride it, and
// created_at / plain effective_date scans 57014 on this 9.8M-row table.
const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN",
  "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
  "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
  "VT","VA","WA","WV","WI","WY",
];

/** Stream all LIVE v2 storm-event rows for one state lane (null = territories/marine). */
async function scanState(state: string | null, onRow: (r: LiveRow) => void): Promise<number> {
  let cursor = "";
  let seenAtCursor = new Set<string>(); // ids already processed at the cursor date
  let scanned = 0;
  const lane = state ?? "null";
  while (true) {
    const url =
      `${SUPABASE_URL}/rest/v1/hunt_knowledge` +
      `?content_type=eq.storm-event` +
      `&metadata->superseded=is.null` +
      `&metadata->>ingest_v=eq.2` +
      (state ? `&state_abbr=eq.${state}` : `&state_abbr=is.null`) +
      (cursor ? `&effective_date=gte.${cursor}` : "") +
      `&select=id,created_at,effective_date,sid:metadata->>source_event_id` +
      `&order=effective_date.asc&limit=${PAGE_SIZE}`;
    const res = await fetchWithRetry(url, { headers: supaHeaders() }, `scan ${lane}@${cursor || "start"}`);
    const page: LiveRow[] = await res.json();
    if (!Array.isArray(page)) throw new Error(`scan ${lane}: non-array response`);
    let fresh = 0;
    for (const r of page) {
      if (r.effective_date === cursor && seenAtCursor.has(r.id)) continue; // page-overlap tie
      onRow(r);
      scanned++;
      fresh++;
    }
    if (page.length < PAGE_SIZE) break;
    const last = page[page.length - 1];
    if (last.effective_date === cursor && fresh === 0) {
      throw new Error(`scan ${lane} stuck at ${cursor} — single-day tie group exceeds page size`);
    }
    if (last.effective_date !== cursor) seenAtCursor = new Set();
    for (const r of page) if (r.effective_date === last.effective_date) seenAtCursor.add(r.id);
    cursor = last.effective_date;
  }
  return scanned;
}

async function scanAll(onRow: (r: LiveRow) => void): Promise<number> {
  let scanned = 0;
  for (const state of [...STATES, null]) {
    const n = await scanState(state, onRow);
    scanned += n;
    console.log(`  lane ${state ?? "non-state"}: ${n.toLocaleString()} live v2 rows (running ${scanned.toLocaleString()})`);
  }
  return scanned;
}

/** PATCH extras: merge superseded flags into metadata (fetch full metadata first —
 *  PostgREST PATCH replaces the whole jsonb column, so we merge client-side). */
async function markExtras(extras: LiveRow[]): Promise<number> {
  let marked = 0;
  for (let i = 0; i < extras.length; i += 50) {
    const chunk = extras.slice(i, i + 50);
    const res = await fetchWithRetry(
      `${SUPABASE_URL}/rest/v1/hunt_knowledge?id=in.(${chunk.map((r) => r.id).join(",")})&select=id,metadata`,
      { headers: supaHeaders() },
      "fetch-metadata"
    );
    const full = await res.json();
    for (const row of full) {
      const metadata = { ...row.metadata, superseded: true, superseded_reason: "v2-duplicate" };
      await fetchWithRetry(
        `${SUPABASE_URL}/rest/v1/hunt_knowledge?id=eq.${row.id}`,
        { method: "PATCH", headers: { ...supaHeaders(), Prefer: "return=minimal" }, body: JSON.stringify({ metadata }) },
        `patch ${row.id.slice(0, 8)}`
      );
      marked++;
    }
    await sleep(100); // breathe — IO budget
  }
  return marked;
}

async function run(commit: boolean) {
  bootstrapKey();
  console.log(`\n=== DEDUPE v2 STORM EVENTS — ${commit ? "COMMIT (PATCH extras)" : "SCAN ONLY (no writes)"} ===`);

  // Keeper per EVENT_ID = oldest (created_at, id) — compared explicitly so the
  // result is deterministic regardless of intra-timestamp fetch order.
  const older = (a: LiveRow, b: LiveRow) =>
    a.created_at < b.created_at || (a.created_at === b.created_at && a.id < b.id);
  const firstSeen = new Map<string, LiveRow>();
  const extras: LiveRow[] = [];
  const scanned = await scanAll((r) => {
    if (!r.sid) return; // v2 rows always carry one; never touch a null-sid row
    const keeper = firstSeen.get(r.sid);
    if (!keeper) firstSeen.set(r.sid, r);
    else if (older(r, keeper)) { firstSeen.set(r.sid, r); extras.push(keeper); }
    else extras.push(r);
  });

  const dupSids = new Set(extras.map((e) => e.sid)).size;
  console.log(`\nlive v2 rows scanned: ${scanned.toLocaleString()}`);
  console.log(`distinct EVENT_IDs:   ${firstSeen.size.toLocaleString()}`);
  console.log(`duplicated EVENT_IDs: ${dupSids} (${extras.length} extra rows)`);
  if (extras.length) {
    const byYear: Record<string, number> = {};
    const byMin: Record<string, number> = {};
    for (const e of extras) {
      byYear[e.effective_date.slice(0, 4)] = (byYear[e.effective_date.slice(0, 4)] || 0) + 1;
      byMin[e.created_at.slice(0, 16)] = (byMin[e.created_at.slice(0, 16)] || 0) + 1;
    }
    console.log(`extras by effective year: ${Object.entries(byYear).sort().map(([y, n]) => `${y}:${n}`).join("  ")}`);
    console.log(`extras by created minute: ${Object.entries(byMin).sort().map(([m, n]) => `${m}Z:${n}`).join("  ")}`);
  }

  if (!commit) {
    console.log(`\n=== SCAN COMPLETE === (no writes; rerun with --commit to mark the ${extras.length} extras)`);
    return;
  }
  const marked = await markExtras(extras);
  writeFileSync(CHECKPOINT_FILE, JSON.stringify({ at: new Date().toISOString(), scanned, dupSids, marked }, null, 2) + "\n");
  console.log(`\n=== COMMIT COMPLETE === ${marked} extras marked metadata.superseded=true (v2-duplicate)`);
  console.log("Idempotent: a rerun rescans live rows only, so it converges to zero work.");
}

function status() {
  if (!existsSync(CHECKPOINT_FILE)) { console.log("no commit has run yet"); return; }
  console.log(readFileSync(CHECKPOINT_FILE, "utf-8").trim());
}

const mode = process.argv[2] || "";
if (mode === "--status") status();
else if (mode === "--commit" || mode === "" || mode === "--scan") {
  run(mode === "--commit").catch((err) => { console.error("FATAL:", err); process.exit(1); });
} else {
  console.error(`unknown mode ${mode} (use --scan, --commit, --status)`);
  process.exit(1);
}
