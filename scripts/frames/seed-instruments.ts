/**
 * seed-instruments.ts — THE BOARD Rung 2a: seed board_instruments (spine §1.3–1.4).
 *
 * The ~71 v1 instruments (a complete national board today; 500 is a horizon, §1.4):
 *   50 state-temp  — one per state, ghcn-daily avg_high_f     (from _shared/states.ts)
 *   11 tide        — CO-OPS roster, residual max/min          (from tide-roster-backfill.ts)
 *    6 buoy        — NDBC pressure roster, min/avg pressure    (ndbc-pressure-backfill.ts
 *                    ALL_STATIONS ∪ bake-uri BUOYS — the union so the Uri film's 3 buoys
 *                    reproduce, Rung 2e)
 *    4 needle      — AO (daily, CPC file) + NAO/PDO/ENSO (monthly climate-index)
 *
 * Each instrument's Albers x/y is precomputed HERE at the canonical 975×610 frame
 * using the SAME projector the film engine uses (scripts/board/projection.ts), so
 * the projection is computed once, ever. Regression anchor: ghcn-tx = (461.1, 442.9).
 *
 * The seed also computes the LAYOUT (§3.2): the ordered slot manifest + its
 * layout_version (a stable hash), written to board_layout. Every frame the backfill
 * packs is stamped with this version; the serve RPC decodes only matching frames.
 *
 * DEVIATIONS FROM THE SPINE (flagged, not silent):
 *  - Buoy count is 6, not §1.4's ~20. The named roster sources (ndbc-pressure +
 *    bake-uri) name exactly these 6 with curated lat/lng. Widening to ~20 is a
 *    mechanical DB-actives query (§1.4 path-to-500) — deferred, not invented.
 *  - AO needle source_ct = 'cpc-daily-ao' (the daily CPC file), NOT 'climate-index'.
 *    climate-index is MONTHLY (verified: AO Feb-2021 = -1.191); the Rung-2b anchor
 *    (AO 2021-02-10 pct 0.997, v -5.28) and Rung-2e Uri reproduction REQUIRE the
 *    daily series. NAO/PDO/ENSO stay monthly climate-index (no daily anchor/role).
 *  - state metric reads metadata->>avg_high_f directly (a numeric field, as bake-uri
 *    does), not §2.4's speculative content regex.
 *  - slot_offset/slot_count columns added to the registry — the decode order the
 *    layout guard needs; implied by §3.2 "expanded to slots in a fixed order".
 *
 * Usage:
 *   npx tsx scripts/frames/seed-instruments.ts --dry-run   # compute + print, NO writes
 *   npx tsx scripts/frames/seed-instruments.ts             # UPSERT board_instruments +
 *       board_layout (run by the main session AFTER the migration is pushed).
 *   npx tsx scripts/frames/seed-instruments.ts --status
 * Keys: SUPABASE_SERVICE_ROLE_KEY (env or Supabase CLI).
 */

import { execSync } from "child_process";
import { WIDTH, HEIGHT, PROJ_VERSION } from "../board/projection.ts";
import { buildRegistry, type Instrument, type SlotManifestEntry } from "./registry.ts";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";

// ─── Keys / HTTP ────────────────────────────────────────────────────────────────
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
class FatalHttpError extends Error {}
async function fetchWithRetry(url: string, init: RequestInit, label: string, attempts = 5): Promise<Response> {
  let lastErr: any;
  for (let a = 1; a <= attempts; a++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      const body = (await res.text()).slice(0, 300);
      if (res.status >= 400 && res.status < 500) throw new FatalHttpError(`${label} ${res.status}: ${body}`);
      lastErr = new Error(`${label} ${res.status}: ${body}`);
    } catch (e: any) { if (e instanceof FatalHttpError) throw e; lastErr = e; }
    if (a < attempts) await sleep(Math.min(1500 * 2 ** (a - 1), 30000));
  }
  throw lastErr;
}

// ─── Sanity ──────────────────────────────────────────────────────────────────────
function sanityCheck(rows: (Instrument & { slot_offset: number })[]): void {
  const tx = rows.find((r) => r.id === "ghcn-tx")!;
  const dx = Math.abs((tx.albers_x ?? 0) - 461.1), dy = Math.abs((tx.albers_y ?? 0) - 442.9);
  if (dx > 0.05 || dy > 0.05) {
    console.error(`  ✗ PROJECTION ANCHOR FAIL: ghcn-tx = (${tx.albers_x}, ${tx.albers_y}), expected (461.1, 442.9)`);
    process.exit(1);
  }
  console.log(`  ✓ projection anchor: ghcn-tx = (${tx.albers_x}, ${tx.albers_y})`);
}

// ─── Print / write ───────────────────────────────────────────────────────────────
function summarize(rows: (Instrument & { slot_offset: number; slot_count: number })[], layout: { version: number; slotCount: number }) {
  const byKind: Record<string, number> = {};
  for (const r of rows) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
  console.log(`\n  instruments: ${rows.length} — ${Object.entries(byKind).map(([k, v]) => `${v} ${k}`).join(", ")}`);
  console.log(`  slots: ${layout.slotCount}  (${(layout.slotCount)} bytes/day → ${(layout.slotCount * 60 / 1024).toFixed(1)} KB per 60-day replay)`);
  console.log(`  layout_version: ${layout.version}  (canonical ${WIDTH}×${HEIGHT}, proj_version ${PROJ_VERSION})`);
  console.log(`  Uri instruments present: ${["ghcn-tx", "needle-ao", "buoy-42035", "tide-8761724", "tide-8747437", "tide-8735180"].filter((id) => rows.some((r) => r.id === id)).join(", ")}`);
}

async function writeRows(rows: (Instrument & { slot_offset: number; slot_count: number })[], layout: { version: number; manifest: SlotManifestEntry[]; slotCount: number }) {
  // board_layout first (board_frames FKs it later; instruments do not, but keep order clean).
  await fetchWithRetry(`${SUPABASE_URL}/rest/v1/board_layout?on_conflict=version`, {
    method: "POST", headers: { ...supaHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ version: layout.version, slot_manifest: layout.manifest, instrument_count: rows.length, slot_count: layout.slotCount, note: "v1 seed" }]),
  }, "board_layout upsert");

  const payload = rows.map((r) => ({
    id: r.id, kind: r.kind, label: r.label, sublabel: r.sublabel, lane: r.lane,
    lat: r.lat, lng: r.lng, albers_x: r.albers_x, albers_y: r.albers_y, proj_version: r.proj_version,
    source_ct: r.source_ct, source_key: r.source_key, metrics: r.metrics,
    slot_offset: r.slot_offset, slot_count: r.slot_count, active: true,
  }));
  await fetchWithRetry(`${SUPABASE_URL}/rest/v1/board_instruments?on_conflict=id`, {
    method: "POST", headers: { ...supaHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(payload),
  }, "board_instruments upsert");
  console.log(`\n  ✓ wrote ${payload.length} instruments + layout_version ${layout.version}`);
}

async function status() {
  bootstrapKeys();
  const res = await fetchWithRetry(`${SUPABASE_URL}/rest/v1/board_instruments?select=kind&active=eq.true`, { headers: supaHeaders() }, "status");
  const rows = await res.json();
  if (!Array.isArray(rows)) { console.log("  board_instruments not reachable (migration pushed?)"); return; }
  const byKind: Record<string, number> = {};
  for (const r of rows) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
  console.log(`board_instruments: ${rows.length} active — ${JSON.stringify(byKind)}`);
}

async function main() {
  const arg = process.argv[2] || "";
  const { rows, layout } = buildRegistry();

  if (arg === "--status") return status();

  console.log(`=== SEED THE BOARD — ${rows.length} instruments ===`);
  sanityCheck(rows);
  summarize(rows, layout);

  if (arg === "--dry-run") {
    console.log("\n  DRY RUN — no writes. Sample rows:");
    for (const r of rows.slice(0, 3)) console.log(`    ${r.id} [${r.kind}] lane=${r.lane} (${r.albers_x},${r.albers_y}) slots@${r.slot_offset}+${r.slot_count} src=${r.source_ct} ${JSON.stringify(r.source_key)}`);
    console.log(`    …needle-ao: ${JSON.stringify(rows.find((r) => r.id === "needle-ao"))}`);
    return;
  }

  bootstrapKeys();
  await writeRows(rows, layout);
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
