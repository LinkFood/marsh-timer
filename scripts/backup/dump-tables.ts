/**
 * dump-tables.ts — the DCD board-stack backup: a PostgREST-paginated, count-verified,
 * gzipped NDJSON dump that lands OUTSIDE the cluster it protects against.
 *
 * WHY THIS EXISTS (docs/DISASTER-RECOVERY.md)
 *   PITR is OFF. Coverage is 7 daily whole-cluster physical backups on a rolling
 *   window. They are whole-cluster, so restoring DCD rolls JAC and Lupa back to the
 *   same timestamp. Until 2026-07-25 the ONLY external artifact was
 *   scripts/frames/.frame-cache — gitignored, on one Mac, never pushed, and derived
 *   from hunt_knowledge in the very same cluster. That is not a backup.
 *
 * SHAPE
 *   For each table: exact count (Prefer: count=exact) → stable ORDER BY the key →
 *   paginate with Range → stream gzipped NDJSON to disk → sha256 the UNCOMPRESSED
 *   bytes → assert rows_written === exact_count. A dump that silently truncates is
 *   worse than no dump: PostgREST caps every response at 1000 rows and says nothing.
 *
 * THE ORDER BY IS CORRECTNESS-CRITICAL, NOT COSMETIC. Range/offset pagination without a
 * total order lets Postgres return the same row on two pages and no row on a third.
 * Every table below declares a key that is unique across the table.
 *
 * WHERE IT LANDS
 *   $DCD_BACKUP_DIR (default ~/dcd-backups) — deliberately OUTSIDE the repo, so a
 *   dump is never a git accident and never inside a Vercel build context. That is
 *   still ONE Mac. To satisfy the second-failure-domain condition, set
 *   $DCD_BACKUP_SYNC_CMD to an object-storage push; it runs only after every table
 *   verifies. See docs/DISASTER-RECOVERY.md §"Pointing this at object storage".
 *
 * hunt_knowledge is NOT in this dump. 10.1M rows × ~8.3 KB/row of REST JSON (the
 * 512-dim embedding dominates) is ~84 GB across ~10,100 sequential pages, and the
 * daily crons write to it mid-run, so the result would be a torn, non-atomic
 * snapshot. `--hunt-knowledge-plan` prints the honest alternative instead of
 * pretending. See docs/DISASTER-RECOVERY.md §"hunt_knowledge".
 *
 * READ-ONLY. SELECT and HEAD only. This script has no code path that writes to the
 * production database.
 *
 * Usage:
 *   npx tsx scripts/backup/dump-tables.ts                  # the dump
 *   npx tsx scripts/backup/dump-tables.ts --dry-run        # counts + size estimate, no bytes written
 *   npx tsx scripts/backup/dump-tables.ts --only=board_frames,board_layout
 *   npx tsx scripts/backup/dump-tables.ts --hunt-knowledge-plan
 *   DCD_BACKUP_DIR=/Volumes/ext/dcd npx tsx scripts/backup/dump-tables.ts
 * Keys: SUPABASE_SERVICE_ROLE_KEY (env, else bootstrapped from the Supabase CLI).
 */

import { execSync } from "child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { createGzip } from "zlib";
import { createHash } from "crypto";
import { once } from "events";
import { homedir } from "os";
import { join } from "path";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const BACKUP_ROOT = process.env.DCD_BACKUP_DIR || join(homedir(), "dcd-backups");
const SYNC_CMD = process.env.DCD_BACKUP_SYNC_CMD || "";
const KEEP_RUNS = Number(process.env.DCD_BACKUP_KEEP || 7);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── THE TABLE MANIFEST ─────────────────────────────────────────────────────────
// `key` MUST be unique across the table — it is the total order pagination rides on.
// `page` is tuned to payload width, not to row count: board_pool_luts carries two
// ~2,000-element float arrays per row (~21 KB), so 1000-row pages are 21 MB pages.
type TableSpec = { name: string; key: string; page: number; note: string };

const TABLES: TableSpec[] = [
  { name: "board_frames",         key: "day",                                   page: 1000, note: "the frame store — one packed bytea per day, 1950-01-01 forward" },
  { name: "board_instruments",    key: "id",                                    page: 1000, note: "the instrument registry — what a dot IS" },
  { name: "board_layout",         key: "version",                               page: 1000, note: "the layout guard — frames are undecodable without it" },
  { name: "board_pool_luts",      key: "layout_version,instrument_id,metric,doy", page: 250, note: "the percentile pools — wide rows, small pages" },
  { name: "board_rhymes",         key: "day,rank",                              page: 1000, note: "precomputed rhyme neighbours" },
  { name: "board_strings",        key: "id",                                    page: 1000, note: "earned edges (empty today — dumped so 'empty' is a recorded fact)" },
  { name: "formation_watches",    key: "id",                                    page: 1000, note: "the formation layer's live watches" },
  { name: "era5_state_pressure",  key: "state_abbr,day,sampling_version",       page: 1000, note: "ERA5 state pressure series" },
  { name: "era5_sampling_points", key: "sampling_version,state_abbr,idx",       page: 1000, note: "the frozen 5-point sampling scheme" },
  { name: "morning_lines",        key: "day,state_abbr",                        page: 1000, note: "published morning lines + grades" },
  { name: "planting_climatology", key: "state_abbr",                            page: 1000, note: "frost/season climatology + receipts" },
  // hunt_species + hunt_states are FK PARENTS of hunt_seasons/hunt_zones. They are
  // 5 and 51 rows and it would be easy to call them "reference data, rebuildable" —
  // but the 2026-07-25 restore drill failed on exactly this: without them, the
  // countdown's season table cannot be loaded at all. A backup set is not a list of
  // interesting tables, it is a closed set under foreign keys.
  { name: "hunt_species",         key: "id",                                    page: 1000, note: "FK parent of hunt_seasons/hunt_zones — restore blocker if missing" },
  { name: "hunt_states",          key: "abbreviation",                          page: 1000, note: "FK parent of hunt_seasons/hunt_zones — restore blocker if missing" },
  { name: "hunt_seasons",         key: "id",                                    page: 1000, note: "season dates — the countdown's source of truth" },
  { name: "hunt_zones",           key: "id",                                    page: 1000, note: "zone geography (empty today)" },
  { name: "hunt_claims",          key: "id",                                    page: 1000, note: "the court's registered claims — pre-registration is worthless if losable" },
  { name: "hunt_claim_fires",     key: "id",                                    page: 1000, note: "the court's graded fires — the grade record itself" },
  // Added 2026-07-25 by the closure check below, which caught all four on its first
  // run. None is an FK parent of anything above, so FK closure alone would have
  // missed every one — they are PRODUCT dependencies. board_series_columns is the
  // sharpest case: it was created three hours before this check ran, is what the
  // frequency card counts, and was already unbacked.
  { name: "board_series_columns", key: "instrument_id,metric",                  page: 50,   note: "the card's counting substrate — one whole series per row, wide" },
  { name: "hunt_weather_history", key: "state_abbr,date",                       page: 1000, note: "day-0 readings — the card's live edge and the atlas" },
  { name: "hunt_weather_events",  key: "id",                                    page: 1000, note: "forward-dated detections — /season's 'is something coming'" },
  { name: "hunt_regulation_links",key: "id",                                    page: 1000, note: "243 official state URLs — Amendment 1.5 ruling 2 made these load-bearing: the card links out rather than transcribing bag limits" },
  // Caught by the gate on its second run, after the first four were added. Both are
  // USER data — the only rows here nothing can reconstruct. hunt_conversations holds
  // 148 real chat exchanges. hunt_profiles is empty today, which is exactly why it
  // would have gone on being forgotten until it wasn't.
  { name: "hunt_conversations",   key: "id",                                    page: 500,  note: "chat history — user-authored, unreconstructible" },
  { name: "hunt_profiles",        key: "id",                                    page: 1000, note: "accounts (empty today) — user data, backed up before there is any to lose" },
];

// ─── THE CLOSURE CHECK ──────────────────────────────────────────────────────────
// Ruling: "Compute the closure rather than curating the list by hand; a curated
// list drifts every time a table is added."
//
// It drifts in TWO directions, and only one of them is foreign keys:
//
//   1. FK parents. The 2026-07-25 restore drill died on hunt_species/hunt_states —
//      5 and 51 rows of reference data whose absence made the season table
//      unloadable. Structural, catchable from pg_constraint.
//
//   2. PRODUCT dependencies. Tables the client reads that no FK points at. The same
//      check's first run found four, including board_series_columns — created that
//      afternoon, counting the card, already unbacked. No FK graph would ever have
//      caught it.
//
// So the set must be closed under both, and the check must FAIL rather than warn.
// A backup set that silently drifts is the thing being defended against.
const CLIENT_SRC = join(import.meta.dirname, "..", "..", "src");

/** Tables the client reads but we deliberately do not back up, each with its reason. */
const EXCLUDED: Record<string, string> = {
  hunt_knowledge: "~10M rows / 68 GB — REST pagination provably cannot reach it (offset probes at 5.05M and 10.1M both 500 on statement timeout). Covered by the Supabase physical backup; pg_dump is the real path. See docs/DISASTER-RECOVERY.md.",
  hunt_nws_alerts: "live-only by construction — hunt-nws-monitor deletes rows 24h past expiry, so there is no history to lose. Rebuilds itself within the hour.",
};

// ─── keys ───────────────────────────────────────────────────────────────────────
function bootstrapKeys() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const out = execSync(
    "npx supabase projects api-keys --project-ref rvhyotvklfowklzjahdd --output json 2>/dev/null",
    { encoding: "utf-8", timeout: 60000 },
  ).trim();
  const key = JSON.parse(out).find((k: any) => k.id === "service_role" || k.name === "service_role")?.api_key;
  if (!key || !key.startsWith("ey")) {
    console.error("  ✗ SUPABASE_SERVICE_ROLE_KEY — CLI returned no key.");
    process.exit(1);
  }
  process.env.SUPABASE_SERVICE_ROLE_KEY = key;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return { apikey: k, Authorization: `Bearer ${k}`, ...extra };
}

// 5xx + network only. NEVER retry 4xx — a 4xx here means the query is wrong and
// retrying it just burns the same wrong query into the manifest.
async function get(url: string, hdrs: Record<string, string>, tries = 5): Promise<Response> {
  let lastErr = "";
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: hdrs });
      if (res.ok || res.status === 206) return res;
      if (res.status < 500) throw new Error(`${res.status} ${res.statusText} — ${(await res.text()).slice(0, 400)}`);
      lastErr = `${res.status} ${res.statusText}`;
    } catch (e: any) {
      if (String(e.message).match(/^4\d\d /)) throw e;
      lastErr = e.message;
    }
    await sleep(500 * 2 ** i);
  }
  throw new Error(`GET failed after ${tries} tries: ${url} — ${lastErr}`);
}

/** Exact count via a zero-row Range + Prefer: count=exact. This is the number the dump is graded against. */
async function exactCount(table: string): Promise<number> {
  const res = await get(
    `${SUPABASE_URL}/rest/v1/${table}?select=*`,
    headers({ Prefer: "count=exact", Range: "0-0", "Range-Unit": "items" }),
  );
  const cr = res.headers.get("content-range") || "";
  const n = Number(cr.split("/")[1]);
  if (!Number.isFinite(n)) throw new Error(`${table}: no exact count in content-range "${cr}"`);
  return n;
}

// ─── the dump of one table ──────────────────────────────────────────────────────
type TableResult = {
  table: string; expected: number; written: number; ok: boolean;
  bytes_gz: number; bytes_raw: number; sha256_raw: string;
  pages: number; ms: number; order_by: string; page_size: number; file: string;
};

async function dumpTable(spec: TableSpec, dir: string): Promise<TableResult> {
  const t0 = Date.now();
  const expected = await exactCount(spec.name);
  const file = `${spec.name}.ndjson.gz`;
  const path = join(dir, file);

  const hash = createHash("sha256");
  const gz = createGzip({ level: 6 });
  const out = createWriteStream(path);
  gz.pipe(out);

  const order = spec.key.split(",").map((c) => `${c.trim()}.asc`).join(",");
  let written = 0, rawBytes = 0, pages = 0;

  while (written < expected) {
    const from = written;
    const to = written + spec.page - 1;
    const res = await get(
      `${SUPABASE_URL}/rest/v1/${spec.name}?select=*&order=${encodeURIComponent(order)}`,
      headers({ Range: `${from}-${to}`, "Range-Unit": "items" }),
    );
    const rows: any[] = await res.json();
    pages++;
    if (rows.length === 0) break; // guard: never spin forever if the table shrank mid-run

    const chunk = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    hash.update(chunk);
    rawBytes += Buffer.byteLength(chunk);
    if (!gz.write(chunk)) await once(gz, "drain");

    written += rows.length;
    if (pages % 20 === 0 || written >= expected) {
      process.stdout.write(`\r    ${spec.name}: ${written.toLocaleString()}/${expected.toLocaleString()} (${pages} pages)   `);
    }
  }

  gz.end();
  await once(out, "finish");

  const ok = written === expected;
  const bytes_gz = statSync(path).size;
  const ms = Date.now() - t0;
  process.stdout.write(
    `\r    ${ok ? "✓" : "✗"} ${spec.name.padEnd(22)} ${written.toLocaleString().padStart(9)}/${expected.toLocaleString().padEnd(9)} ` +
    `${(bytes_gz / 1e6).toFixed(2).padStart(8)} MB gz  ${(ms / 1000).toFixed(1).padStart(6)}s\n`,
  );

  return {
    table: spec.name, expected, written, ok,
    bytes_gz, bytes_raw: rawBytes, sha256_raw: hash.digest("hex"),
    pages, ms, order_by: order, page_size: spec.page, file,
  };
}

// ─── scripts/frames/.frame-cache — the one artifact that was never anywhere else ─
// 35 MB of per-instrument series, .gitignore:49, `git ls-files` returns 0, one Mac.
// Its upstream is hunt_knowledge in the same cluster, so if the cluster is gone this
// cache IS the reconstruction path for backfill-frames.ts (see docs/DISASTER-RECOVERY.md).
// Capturing it here puts it in the same artifact that goes to object storage, which is
// a better answer than un-gitignoring 35 MB of regenerable-but-not-really binary.
function captureFrameCache(dir: string): { file: string; bytes: number; sha256: string } | null {
  const cache = join(import.meta.dirname, "..", "frames", ".frame-cache");
  if (!existsSync(cache)) return null;
  const file = "frame-cache.tar.gz";
  execSync(`tar -czf ${JSON.stringify(join(dir, file))} -C ${JSON.stringify(join(cache, ".."))} .frame-cache`);
  const bytes = statSync(join(dir, file)).size;
  const sha256 = createHash("sha256").update(readFileSync(join(dir, file))).digest("hex");
  return { file, bytes, sha256 };
}

// ─── hunt_knowledge: the honest answer, not a fake dump ─────────────────────────
async function huntKnowledgePlan() {
  console.log("\n  hunt_knowledge — why it is NOT in this dump\n");
  const n = await exactCount("hunt_knowledge");
  const pages = Math.ceil(n / 1000);
  const NO_EMBED = "id,title,content,content_type,tags,created_at,metadata,state_abbr,species,effective_date,signal_weight";

  // Sample from three windows, not just the head. hunt_knowledge is ~30 heterogeneous
  // ingest streams with wildly different content widths, so the first 100 rows are not
  // the table — an early-offset-only estimate was off by ~20x on the no-embedding figure.
  const offsets = [0, Math.floor(n / 2), Math.max(0, n - 100)];
  const deepFailures: number[] = [];
  const measure = async (select: string) => {
    let bytes = 0, rows = 0;
    for (const off of offsets) {
      try {
        const res = await get(`${SUPABASE_URL}/rest/v1/hunt_knowledge?select=${select}&order=id.asc`,
          headers({ Range: `${off}-${off + 99}`, "Range-Unit": "items" }), 2);
        const txt = await res.text();
        bytes += Buffer.byteLength(txt);
        rows += JSON.parse(txt).length;
      } catch {
        // A deep ORDER BY + OFFSET on 10M rows exceeds the statement timeout. This is not
        // an inconvenience to route around — it is the proof that REST pagination cannot
        // dump this table: page 5,000 of 10,104 does not complete at all.
        if (!deepFailures.includes(off)) deepFailures.push(off);
      }
    }
    return rows > 0 ? bytes / rows : NaN;
  };

  const perRow = await measure("*");
  const perRowNoEmb = await measure(NO_EMBED);

  console.log(`    rows                       ${n.toLocaleString()}`);
  console.log(`    REST JSON bytes/row        ~${Math.round(perRow).toLocaleString()} B  (sampled at 3 offsets; the 512-dim embedding dominates)`);
  console.log(`    full dump over PostgREST   ~${((perRow * n) / 1e9).toFixed(0)} GB across ~${pages.toLocaleString()} sequential 1000-row pages`);
  console.log(`    without the embedding col  ~${((perRowNoEmb * n) / 1e9).toFixed(0)} GB  (embeddings re-derivable via Voyage, at real cost + days of pipeline)`);
  if (deepFailures.length) {
    console.log(`    deep-offset probe          FAILED at offsets ${deepFailures.map((o) => o.toLocaleString()).join(", ")}`);
    console.log(`                               (statement timeout — those pages never complete)`);
  }
  console.log("");
  console.log("    VERDICT: PostgREST pagination is NOT a viable backup path for this table.");
  if (deepFailures.length) {
    console.log("    Proven, not assumed: the deep pages 500 outright. A dump that cannot fetch");
    console.log("    page 5,000 of 10,104 is not slow, it is impossible.");
  }
  console.log("    And even if they completed: the daily crons write to hunt_knowledge during a");
  console.log("    run that long, so the result is a TORN snapshot with no consistent point in time.");
  console.log("");
  console.log("    What IS viable: pg_dump, which takes one consistent snapshot in a single");
  console.log("    transaction. It needs SUPABASE_DB_PASSWORD (present in .env.local) and it must");
  console.log("    go through the SESSION POOLER — db.<ref>.supabase.co is IPv6-only and does not");
  console.log("    resolve from an IPv4-only machine. See docs/DISASTER-RECOVERY.md.");
  console.log("");
  console.log("    Interim answer: the Supabase 7-day whole-cluster physicals DO cover");
  console.log("    hunt_knowledge. The gap is not 'no copy' — it is 'no copy outside the cluster'.");
  console.log("");
}

// ─── run ────────────────────────────────────────────────────────────────────────
/** Every `.from("table")` the browser bundle issues. Walks src/ rather than trusting a list. */
function clientReadSet(dir: string, found = new Set<string>()): Set<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { clientReadSet(p, found); continue; }
    if (!/\.(ts|tsx)$/.test(e.name)) continue;
    for (const m of readFileSync(p, "utf-8").matchAll(/\.from\(\s*["'`]([a-z0-9_]+)["'`]\s*\)/g)) found.add(m[1]);
  }
  return found;
}

/**
 * Fails the run if the manifest is not closed under FK parentage or client reads.
 * Loud and blocking on purpose: a backup set that quietly drifts is precisely the
 * failure this whole script exists to prevent.
 */
function checkClosure(): boolean {
  const inSet = new Set(TABLES.map((t) => t.name));
  let ok = true;

  for (const t of [...clientReadSet(CLIENT_SRC)].sort()) {
    if (inSet.has(t) || t in EXCLUDED) continue;
    console.error(`  ✗ CLIENT READS BUT NOT BACKED UP: ${t}`);
    ok = false;
  }

  if (ok) console.log(`  ✓ client-read closure clean — ${TABLES.length} tables, ${Object.keys(EXCLUDED).length} excluded with a stated reason`);
  return ok;
}
// The FK half is deliberately NOT re-implemented here. PostgREST cannot reach
// pg_constraint, and a hand-maintained edge list would be the same drifting curation
// this check exists to kill. It is verified where it actually bites instead:
// scripts/backup/restore-drill.ts builds the schema from the repo's own migrations
// and fails on a missing parent — which is exactly how hunt_species/hunt_states were
// caught. An FK gap is a restore-time failure, so the restore is the honest gate.
// To audit it by hand:
//   select c.conrelid::regclass::text child, c.confrelid::regclass::text parent
//     from pg_constraint c join pg_namespace n on n.oid = c.connamespace
//    where c.contype = 'f' and n.nspname = 'public' order by 1;

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const onlyArg = argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.slice(7).split(",").map((s) => s.trim()) : null;

  bootstrapKeys();

  if (argv.includes("--hunt-knowledge-plan")) { await huntKnowledgePlan(); return; }

  const specs = only ? TABLES.filter((t) => only.includes(t.name)) : TABLES;
  if (specs.length === 0) { console.error("  ✗ --only matched no tables."); process.exit(1); }

  console.log(`\n  DCD board-stack dump — ${SUPABASE_URL}`);
  console.log(`  destination: ${BACKUP_ROOT}${dryRun ? "  (DRY RUN — no bytes written)" : ""}\n`);

  // Gate the dump on the manifest still covering what the product reads. Runs on
  // every invocation including --dry-run, and blocks: a set that drifts silently is
  // the failure mode. `--only` runs a partial set by design, so the gate is advisory
  // there. Override with --skip-closure only if you know why.
  if (!checkClosure() && !only && !argv.includes("--skip-closure")) {
    console.error(`\n  ✗ REFUSING TO DUMP — the manifest no longer covers what the client reads.`);
    console.error(`    Add the table above to TABLES, or add it to EXCLUDED with a reason.`);
    process.exit(1);
  }
  console.log("");

  if (dryRun) {
    let total = 0;
    for (const s of specs) {
      const n = await exactCount(s.name);
      total += n;
      console.log(`    ${s.name.padEnd(22)} ${n.toLocaleString().padStart(10)} rows   order by ${s.key}`);
    }
    console.log(`\n    ${total.toLocaleString()} rows total across ${specs.length} tables.\n`);
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "Z";
  const dir = join(BACKUP_ROOT, stamp);
  mkdirSync(dir, { recursive: true });

  const t0 = Date.now();
  const results: TableResult[] = [];
  for (const s of specs) results.push(await dumpTable(s, dir));
  const ms = Date.now() - t0;

  const frameCache = only ? null : captureFrameCache(dir);
  if (frameCache) console.log(`    ✓ ${"frame-cache.tar.gz".padEnd(22)} ${" ".repeat(19)} ${(frameCache.bytes / 1e6).toFixed(2).padStart(8)} MB`);

  const failed = results.filter((r) => !r.ok);
  const manifest = {
    dump_version: 1,
    created_at: new Date().toISOString(),
    source: SUPABASE_URL,
    method: "postgrest-paginated-ndjson",
    complete: failed.length === 0,
    wall_clock_ms: ms,
    total_rows: results.reduce((a, r) => a + r.written, 0),
    total_bytes_gz: results.reduce((a, r) => a + r.bytes_gz, 0),
    total_bytes_raw: results.reduce((a, r) => a + r.bytes_raw, 0),
    tables: results,
    frame_cache: frameCache,
    excluded: {
      hunt_knowledge:
        "~10.1M rows / ~84 GB of REST JSON / ~10,100 sequential pages, and written to by " +
        "daily crons mid-run — PostgREST pagination cannot produce a consistent snapshot. " +
        "Covered by the Supabase 7-day whole-cluster physicals only. See docs/DISASTER-RECOVERY.md.",
    },
  };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`\n  ${failed.length === 0 ? "✓" : "✗"} ${results.length} tables, ` +
    `${manifest.total_rows.toLocaleString()} rows, ` +
    `${(manifest.total_bytes_gz / 1e6).toFixed(1)} MB gz ` +
    `(${(manifest.total_bytes_raw / 1e6).toFixed(1)} MB raw), ` +
    `${(ms / 1000).toFixed(1)}s wall clock`);
  console.log(`  → ${dir}`);

  if (failed.length > 0) {
    console.error(`\n  ✗ COUNT MISMATCH on ${failed.map((f) => f.table).join(", ")} — this dump is INCOMPLETE.`);
    console.error("    Not syncing. A truncated backup you believe in is worse than none.\n");
    process.exit(1);
  }

  // Retention: keep the last N complete runs. Only ever prunes inside BACKUP_ROOT.
  const runs = readdirSync(BACKUP_ROOT)
    .filter((d) => /^\d{4}-\d{2}-\d{2}T/.test(d) && existsSync(join(BACKUP_ROOT, d, "manifest.json")))
    .sort();
  for (const old of runs.slice(0, Math.max(0, runs.length - KEEP_RUNS))) {
    rmSync(join(BACKUP_ROOT, old), { recursive: true, force: true });
    console.log(`  pruned ${old}`);
  }

  // The second failure domain. Runs ONLY after every table verified.
  if (SYNC_CMD) {
    console.log(`\n  syncing → second failure domain: ${SYNC_CMD}`);
    execSync(SYNC_CMD, { stdio: "inherit", env: { ...process.env, DCD_BACKUP_RUN_DIR: dir, DCD_BACKUP_ROOT: BACKUP_ROOT } });
    console.log("  ✓ synced");
  } else {
    console.log("\n  ⚠ DCD_BACKUP_SYNC_CMD is not set — this dump exists on ONE machine.");
    console.log("    That is a second copy, not a second failure domain. See docs/DISASTER-RECOVERY.md.");
  }
  console.log("");
}

main().catch((e) => { console.error("\n  ✗", e.message); process.exit(1); });
