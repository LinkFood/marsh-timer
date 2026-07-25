/**
 * restore-drill.ts — the tested restore. An untested backup is a belief.
 *
 * Takes a dump directory produced by dump-tables.ts and REALLY restores it into a
 * Postgres target: creates the tables from THIS REPO'S OWN migration DDL (single
 * source of truth — the drill cannot drift from production schema without the
 * migrations drifting first), loads every NDJSON row, then proves the round trip:
 *
 *   1. COUNT           — restored rows === the manifest's exact production count.
 *   2. CONTIGUITY      — board_frames has one row per calendar day from its first
 *                        day to its last, zero gaps. Generated in SQL, not trusted.
 *   3. FIDELITY        — a canonical per-row digest of the RESTORED board_frames,
 *                        computed in SQL, compared against the same digest computed
 *                        in JS from LIVE PRODUCTION rows. Not a sample: all 27,964
 *                        rows, every field, including the packed bytea. If one byte
 *                        of one dot moved, the md5 differs.
 *   4. WALL CLOCK      — how long a restore actually takes, written down.
 *
 * READ-ONLY against production: the only production traffic is the SELECTs for
 * step 3. Every write goes to the drill target, which must NOT be the production
 * database — the script refuses to run against a supabase.co host.
 *
 * Stand up a throwaway target first (documented in docs/DISASTER-RECOVERY.md):
 *   initdb -D /tmp/pgdrill -U drill --auth=trust
 *   pg_ctl -D /tmp/pgdrill -o "-p 55432 -k /tmp/dcdpg" -l /tmp/pgdrill.log start
 *   createdb -h 127.0.0.1 -p 55432 -U drill dcd_restore_drill
 *
 * Usage:
 *   DRILL_PG_URL=postgres://drill@127.0.0.1:55432/dcd_restore_drill \
 *     npx tsx scripts/backup/restore-drill.ts [dumpDir]
 *   (dumpDir defaults to the newest run under $DCD_BACKUP_DIR)
 */

import { createReadStream, existsSync, readdirSync, readFileSync } from "fs";
import { createGunzip } from "zlib";
import { createInterface } from "readline";
import { createHash } from "crypto";
import { homedir } from "os";
import { join } from "path";
import postgres from "postgres";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "supabase", "migrations");
const BACKUP_ROOT = process.env.DCD_BACKUP_DIR || join(homedir(), "dcd-backups");
const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const DRILL_PG_URL = process.env.DRILL_PG_URL || "";

// Load order. Every table whose DDL carries a REFERENCES must come after its parent.
const LOAD_ORDER = [
  "board_layout", "board_instruments", "board_frames", "board_strings", "board_pool_luts",
  "board_rhymes", "hunt_claims", "hunt_claim_fires", "formation_watches",
  "era5_sampling_points", "era5_state_pressure", "morning_lines", "planting_climatology",
  "hunt_species", "hunt_states", "hunt_seasons", "hunt_zones",
];

// ─── DDL extraction: pull CREATE TABLE straight out of the migrations ───────────
type Col = { name: string; type: string };

/** Paren-matched CREATE TABLE block for `table`, scanning every migration file. */
function findCreateTable(table: string): string | null {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  const re = new RegExp(`CREATE\\s+TABLE\\s+(IF\\s+NOT\\s+EXISTS\\s+)?${table}\\s*\\(`, "i");
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf-8");
    const m = re.exec(sql);
    if (!m) continue;
    let depth = 0, i = m.index + m[0].length - 1;
    const start = i;
    for (; i < sql.length; i++) {
      if (sql[i] === "(") depth++;
      else if (sql[i] === ")") { depth--; if (depth === 0) break; }
    }
    return `CREATE TABLE ${table} ${sql.slice(start, i + 1)}`;
  }
  return null;
}

/**
 * Column name + declared type from a CREATE TABLE body, skipping table constraints.
 *
 * Comments are stripped BEFORE the comma split, not after. These migrations document
 * jsonb shapes inline — `-- [{inst_id, metric, direction, offset}] in byte order` —
 * and those commas are at paren-depth 0. Splitting first shreds the comment into
 * phantom columns and silently shifts every value one slot right. The 2026-07-25
 * drill caught it as a NOT NULL violation on board_layout; a nullable column would
 * have restored quietly wrong.
 */
function parseColumns(ddl: string): Col[] {
  const body = ddl
    .slice(ddl.indexOf("(") + 1, ddl.lastIndexOf(")"))
    .replace(/--[^\n]*/g, "");

  const cols: Col[] = [];
  for (const raw of splitTopLevel(body)) {
    const line = raw.trim().replace(/\s+/g, " ");
    if (!line) continue;
    if (/^(PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT|EXCLUDE)\b/i.test(line)) continue;
    const c = parseColDef(line);
    if (c) cols.push(c);
  }
  return cols;
}

/** Split on commas at paren-depth 0 — `numeric(10,2)` must not become two columns. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0, cur = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  parts.push(cur);
  return parts;
}

/** `name type [constraints…]` → {name, type}. Type is tokens up to the first constraint keyword. */
function parseColDef(line: string): Col | null {
  const m = /^"?([a-z_][a-z0-9_]*)"?\s+(.+)$/i.exec(line);
  if (!m) return null;
  const rest = m[2];
  const stop = /\s+(NOT\s+NULL|NULL|DEFAULT|PRIMARY|UNIQUE|REFERENCES|CHECK|GENERATED|COLLATE)\b/i.exec(rest);
  const type = (stop ? rest.slice(0, stop.index) : rest).trim().replace(/\s+/g, " ");
  return type ? { name: m[1], type } : null;
}

/**
 * Columns a LATER migration added with `ALTER TABLE … ADD COLUMN`.
 *
 * WITHOUT THIS THE DRILL LIES. `findCreateTable` returns at the first match and
 * never looks further, so a table widened after its birth migration is rebuilt
 * here at its ORIGINAL width — and because the INSERT's column list is derived
 * from the same parse, the dumped values for the newer columns are silently
 * dropped. Row counts match. Contiguity matches. The data is gone.
 *
 * That is exactly the failure the 2026-07-25 drill caught in board_frames: both
 * of Ruling 5's named checks passed on 100% corrupt data. `era5_state_pressure`
 * gaining temperature columns (20260726030000) is the first table in the set to
 * hit this path, and it would have hit it quietly.
 *
 * Only ADD COLUMN is handled. A later DROP COLUMN or ALTER TYPE would still be
 * invisible here — flagged rather than pretended away; neither has ever been
 * used on a backed-up table, and the digest comparison in §"verify" is the check
 * that would catch it.
 */
function findAddedColumns(table: string, existing: Set<string>): Col[] {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  const stmtRe = new RegExp(`ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:public\\.)?${table}\\b([^;]*);`, "gi");
  const seen = new Set(existing);
  const out: Col[] = [];
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf-8").replace(/--[^\n]*/g, "");
    stmtRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = stmtRe.exec(sql)) !== null) {
      for (const raw of splitTopLevel(m[1])) {
        const line = raw.trim().replace(/\s+/g, " ");
        const add = /^ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(.+)$/i.exec(line);
        if (!add) continue;
        const c = parseColDef(add[1]);
        if (!c || seen.has(c.name)) continue;
        seen.add(c.name);
        out.push(c);
      }
    }
  }
  return out;
}

// ─── value → the text Postgres wants, per declared type ─────────────────────────
function toPgArrayLiteral(v: any[]): string {
  return "{" + v.map((x) => {
    if (x === null) return "NULL";
    if (typeof x === "number" || typeof x === "boolean") return String(x);
    return `"${String(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }).join(",") + "}";
}

function encodeValue(v: any, type: string): string | null {
  if (v === null || v === undefined) return null;
  const t = type.toLowerCase();
  if (t.endsWith("[]")) return toPgArrayLiteral(Array.isArray(v) ? v : [v]);
  if (t.startsWith("json")) return JSON.stringify(v);
  // bytea: hand over BARE hex and let SQL decode(…, 'hex') do the work — see placeholderFor().
  if (t === "bytea") return String(v).replace(/^\\x/, "");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * The SQL expression a column's parameter is fed through on INSERT.
 *
 * bytea gets decode($n,'hex'), NOT $n::bytea. This is the sharpest trap in the whole
 * restore path and the 2026-07-25 drill caught it: PostgREST returns bytea as the
 * string '\xd826f7…', and a text parameter cast with ::bytea does NOT run bytea_in on
 * it — it stores the raw ASCII of the literal, double-encoding every blob to exactly
 * 2× length. Row counts still matched. Contiguity still passed. All 27,964 frames were
 * corrupt. Only a byte-level comparison against production found it.
 */
function placeholderFor(col: Col, i: number): string {
  return col.type.toLowerCase() === "bytea" ? `decode($${i}, 'hex')` : `$${i}::${col.type}`;
}

// ─── NDJSON reader ──────────────────────────────────────────────────────────────
async function* readNdjsonGz(path: string): AsyncGenerator<any> {
  const rl = createInterface({ input: createReadStream(path).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) yield JSON.parse(line);
}

// ─── the canonical board_frames row digest — the fidelity contract ──────────────
// One string per row, identical whether built in SQL from the restored table or in
// JS from live production. Any drift in any field changes the aggregate md5.
const FRAME_CANON_SQL = `
  md5(string_agg(
    to_char(day,'YYYY-MM-DD') || '|' || layout_version::text || '|' ||
    encode(dots,'hex') || '|' || coalesce(day0_source,'') || '|' ||
    coalesce(strings::text,'') || '|' || coalesce(blooms::text,''),
    E'\\n' ORDER BY day))`;

function frameCanonJs(rows: any[]): string {
  const lines = rows.map((r) =>
    [r.day, String(r.layout_version), String(r.dots).replace(/^\\x/, ""),
     r.day0_source ?? "", r.strings === null ? "" : JSON.stringify(r.strings),
     r.blooms === null ? "" : JSON.stringify(r.blooms)].join("|"));
  return createHash("md5").update(lines.join("\n")).digest("hex");
}

async function fetchLiveFrames(): Promise<any[]> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const h = { apikey: key, Authorization: `Bearer ${key}` };
  const out: any[] = [];
  for (let off = 0; ; off += 1000) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/board_frames?select=*&order=day.asc`,
      { headers: { ...h, Range: `${off}-${off + 999}`, "Range-Unit": "items" } });
    if (!res.ok && res.status !== 206) throw new Error(`live board_frames ${res.status}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

// ─── run ────────────────────────────────────────────────────────────────────────
async function main() {
  if (!DRILL_PG_URL) { console.error("  ✗ DRILL_PG_URL is required (a THROWAWAY target)."); process.exit(1); }
  if (/supabase\.(co|com)/i.test(DRILL_PG_URL)) {
    console.error("  ✗ DRILL_PG_URL points at Supabase. This script restores INTO its target — refusing.");
    process.exit(1);
  }

  const dumpDir = process.argv[2] || (() => {
    const runs = readdirSync(BACKUP_ROOT).filter((d) => /^\d{4}-\d{2}-\d{2}T/.test(d)).sort();
    if (!runs.length) { console.error(`  ✗ no dump runs under ${BACKUP_ROOT}`); process.exit(1); }
    return join(BACKUP_ROOT, runs[runs.length - 1]);
  })();

  const manifest = JSON.parse(readFileSync(join(dumpDir, "manifest.json"), "utf-8"));
  console.log(`\n  RESTORE DRILL`);
  console.log(`  dump   ${dumpDir}`);
  console.log(`  taken  ${manifest.created_at}  (${manifest.total_rows.toLocaleString()} rows, ${(manifest.total_bytes_gz / 1e6).toFixed(1)} MB gz)`);
  console.log(`  target ${DRILL_PG_URL.replace(/:[^:@/]*@/, ":***@")}\n`);

  const sql = postgres(DRILL_PG_URL, { max: 1, onnotice: () => {} });
  const tStart = Date.now();
  const report: any[] = [];

  // ── phase 1: schema, from the repo's own migrations ──────────────────────────
  const tSchema = Date.now();
  const schemas = new Map<string, Col[]>();
  const added = new Map<string, Col[]>();
  for (const t of LOAD_ORDER) {
    const ddl = findCreateTable(t);
    if (!ddl) { console.error(`  ✗ no CREATE TABLE for ${t} in supabase/migrations/`); process.exit(1); }
    const base = parseColumns(ddl);
    const later = findAddedColumns(t, new Set(base.map((c) => c.name)));
    added.set(t, later);
    schemas.set(t, [...base, ...later]);
    await sql.unsafe(`DROP TABLE IF EXISTS ${t} CASCADE`);
  }
  for (const t of LOAD_ORDER) {
    await sql.unsafe(findCreateTable(t)!);
    for (const c of added.get(t)!) await sql.unsafe(`ALTER TABLE ${t} ADD COLUMN "${c.name}" ${c.type}`);
  }
  const widened = LOAD_ORDER.filter((t) => added.get(t)!.length);
  console.log(`  ✓ schema  ${LOAD_ORDER.length} tables from supabase/migrations/  ${((Date.now() - tSchema) / 1000).toFixed(1)}s`);
  for (const t of widened) {
    console.log(`    + ${t}: ${added.get(t)!.length} column(s) from later ALTER TABLE — ${added.get(t)!.map((c) => c.name).join(", ")}`);
  }

  // ── phase 2: load ────────────────────────────────────────────────────────────
  const tLoad = Date.now();
  for (const t of LOAD_ORDER) {
    const spec = manifest.tables.find((x: any) => x.table === t);
    if (!spec) { console.log(`    - ${t}: not in dump, skipped`); continue; }
    const cols = schemas.get(t)!;
    const file = join(dumpDir, spec.file);
    if (!existsSync(file)) { console.error(`  ✗ ${t}: ${spec.file} missing`); process.exit(1); }

    const t0 = Date.now();
    const colNames = cols.map((c) => `"${c.name}"`).join(",");
    const casts = cols.map((c, i) => placeholderFor(c, i + 1)).join(",");
    const stmt = `INSERT INTO ${t} (${colNames}) VALUES (${casts})`;
    let n = 0;
    let batch: (string | null)[][] = [];

    const flush = async () => {
      if (!batch.length) return;
      await sql.begin(async (tx) => { for (const p of batch) await tx.unsafe(stmt, p as any); });
      batch = [];
    };
    for await (const row of readNdjsonGz(file)) {
      batch.push(cols.map((c) => encodeValue(row[c.name], c.type)));
      n++;
      if (batch.length >= 1000) await flush();
    }
    await flush();

    const [{ count }] = await sql.unsafe(`SELECT count(*)::int AS count FROM ${t}`);
    const ok = count === spec.expected && n === spec.expected;
    report.push({ table: t, expected: spec.expected, loaded: count, ok, ms: Date.now() - t0 });
    console.log(`    ${ok ? "✓" : "✗"} ${t.padEnd(22)} ${String(count).padStart(9)}/${String(spec.expected).padEnd(9)} ${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`);
  }
  const loadMs = Date.now() - tLoad;

  // ── phase 3: contiguity ──────────────────────────────────────────────────────
  const [gap] = await sql`
    WITH b AS (SELECT min(day) lo, max(day) hi, count(*)::int n FROM board_frames)
    SELECT b.lo, b.hi, b.n,
           (SELECT count(*)::int FROM generate_series(b.lo, b.hi, interval '1 day') g
             WHERE NOT EXISTS (SELECT 1 FROM board_frames f WHERE f.day = g::date)) AS missing,
           (b.hi - b.lo + 1) AS expected_days
    FROM b`;
  const contiguous = gap.missing === 0 && gap.n === Number(gap.expected_days);
  console.log(`\n  ${contiguous ? "✓" : "✗"} contiguity  board_frames ${gap.lo.toISOString().slice(0, 10)} → ${gap.hi.toISOString().slice(0, 10)}  ` +
    `${gap.n.toLocaleString()} rows / ${Number(gap.expected_days).toLocaleString()} calendar days, ${gap.missing} missing`);

  // ── phase 4: fidelity vs LIVE production ─────────────────────────────────────
  const [{ digest }] = await sql.unsafe(`SELECT ${FRAME_CANON_SQL} AS digest FROM board_frames`);
  const live = await fetchLiveFrames();
  const liveDigest = frameCanonJs(live);
  const fidelity = digest === liveDigest && live.length === gap.n;
  console.log(`  ${fidelity ? "✓" : "✗"} fidelity    restored md5 ${digest}`);
  console.log(`  ${" ".repeat(14)}live     md5 ${liveDigest}   (${live.length.toLocaleString()} live rows, all fields incl. packed bytea)`);

  // ── phase 5: array fidelity — board_pool_luts real[] / integer[] round trip ──
  // board_frames proves bytea + jsonb + date. The pool LUTs are the only float-array
  // payload in the stack (two ~2,000-element arrays per row) and arrays have their own
  // encoding traps, so they get their own element-wise check against the dump file.
  const lutSpec = manifest.tables.find((x: any) => x.table === "board_pool_luts");
  let arraysOk = true, arrayChecked = 0, arrayElems = 0;
  if (lutSpec && lutSpec.expected > 0) {
    const step = Math.max(1, Math.floor(lutSpec.expected / 200));
    let idx = 0;
    for await (const row of readNdjsonGz(join(dumpDir, lutSpec.file))) {
      if (idx++ % step !== 0) continue;
      const [db] = await sql`
        SELECT vals, below, n, years FROM board_pool_luts
        WHERE layout_version = ${row.layout_version} AND instrument_id = ${row.instrument_id}
          AND metric = ${row.metric} AND doy = ${row.doy}`;
      const same = db
        && db.n === row.n && db.years === row.years
        && db.vals.length === row.vals.length && db.below.length === row.below.length
        && db.vals.every((v: number, i: number) => v === row.vals[i])
        && db.below.every((v: number, i: number) => v === row.below[i]);
      if (!same) { arraysOk = false; console.log(`    ✗ pool_lut drift: ${row.instrument_id}/${row.metric}/doy ${row.doy}`); }
      arrayChecked++; arrayElems += row.vals.length + row.below.length;
    }
  }
  console.log(`  ${arraysOk ? "✓" : "✗"} arrays      board_pool_luts ${arrayChecked} sampled rows, ` +
    `${arrayElems.toLocaleString()} float/int elements compared exactly`);

  const totalMs = Date.now() - tStart;
  const allOk = report.every((r) => r.ok) && contiguous && fidelity && arraysOk;
  console.log(`\n  ${allOk ? "✓ DRILL PASSED" : "✗ DRILL FAILED"} — ` +
    `${report.reduce((a, r) => a + r.loaded, 0).toLocaleString()} rows restored in ${(loadMs / 1000).toFixed(1)}s ` +
    `(${(totalMs / 1000).toFixed(1)}s including schema + verification)\n`);

  await sql.end();
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => { console.error("\n  ✗", e); process.exit(1); });
