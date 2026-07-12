/**
 * anchors.ts — LOOKOUT MINE, step 0: the outcome-anchor set (docs/THE-WEEK.md PARK LIST).
 *
 * Pulls the 4,233 stitched-event rows from hunt_knowledge and prepares them as
 * OUTCOME ANCHORS for the mine orchestrator: parse spans, dedupe for statistical
 * independence, and compute which (family, region) cells clear the eligibility
 * floors. Outcome-first retrodiction starts here — every lane walks backward from
 * these anchors through D-30..D-0 vs matched controls.
 *
 * ─── WHY DEDUPE ────────────────────────────────────────────────────────────────
 * One synoptic outbreak = multiple stitched rows (e.g. the 2012 derecho produced
 * separate wind + heat + hail rows on identical spans). Counting those as three
 * independent outcomes would triple-count one weather system and fake significance.
 * Within each family we merge anchors whose date spans overlap or sit within ±7
 * days AND whose state sets intersect → one "effective anchor" per family per
 * synoptic episode (union span, union states, summed severity, member row ids
 * kept). Across families we do NOT merge — a wind row and a heat row from the
 * same system are different OUTCOME types and each anchors its own family's mine.
 *
 * ─── ELIGIBILITY FLOORS ────────────────────────────────────────────────────────
 * A (family, region) cell is minable only with n_eff ≥ 20 effective anchors AND
 * ≥ 10 distinct years — below that, D-30 lane rates vs controls are noise.
 * family×national is always computed (flagged eligible or not); family×primary-state
 * cells are emitted only where the floors pass.
 *
 * READ-ONLY: GET against PostgREST only. Never selects bare `metadata` — the
 * member_ids arrays are enormous (212 KB for 3 rows); we project exactly the
 * fields the mine needs. Severity fields are filtered client-side, never via
 * `->>` numeric comparison (that's TEXT comparison — proved live).
 *
 * Usage:
 *   npx tsx scripts/mine/anchors.ts --probe     # counts + eligible-cell table
 * Module:
 *   import { loadAnchors } from "./anchors";    // Promise<AnchorSet>
 */

import { execSync } from "child_process";
import { pathToFileURL } from "url";

const SUPABASE_URL = "https://rvhyotvklfowklzjahdd.supabase.co";

// ─── mine parameters ───────────────────────────────────────────────────────────
const EXPECTED_RAW = 4233; // stitched-event rows as of 2026-07-12 — assert, fail loudly on drift
const MERGE_GAP_DAYS = 7; // same-family spans within ±7 days + intersecting states → one episode
const FLOOR_N_EFF = 20; // eligibility floor: effective anchors per cell
const FLOOR_YEARS = 10; // eligibility floor: distinct anchor years per cell
// The stitcher currently covers 1990+ (NCEI v2 re-ingest window). If it later
// backfills earlier eras (1950–89 tornado CSVs are queued), this assert fires ON
// PURPOSE: the mine's control-window logic assumes lane coverage that mostly
// exists 1990+, and pre-1990 anchors would sit over sparse/absent lanes — the
// control matching needs revisiting before those anchors are minable.
const MIN_ANCHOR_DATE = "1990-01-01";

// ─── key + headers (lazy — module import must not shell out) ───────────────────
let KEY: string | null = null;
function serviceKey(): string {
  if (KEY) return KEY;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return (KEY = process.env.SUPABASE_SERVICE_ROLE_KEY);
  const out = execSync(
    "npx supabase projects api-keys --project-ref rvhyotvklfowklzjahdd --output json 2>/dev/null",
    { encoding: "utf-8", timeout: 30_000 },
  );
  const arr = JSON.parse(out);
  const k = (Array.isArray(arr) ? arr : []).find(
    (x: any) => x.id === "service_role" || x.name === "service_role",
  )?.api_key;
  if (!k) throw new Error("no service_role key");
  return (KEY = k);
}
function headers(): Record<string, string> {
  const k = serviceKey();
  return { Authorization: `Bearer ${k}`, apikey: k };
}

// ─── fetch with retry — 5xx/network only, NEVER 4xx ────────────────────────────
async function fetchJson(url: string, tries = 4): Promise<any> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    try {
      const res = await fetch(url, { headers: headers() });
      if (res.ok) return res.json();
      const body = (await res.text()).slice(0, 200);
      if (res.status >= 400 && res.status < 500) {
        throw Object.assign(new Error(`${res.status} (no retry): ${body}`), { fatal: true });
      }
      lastErr = new Error(`${res.status}: ${body}`);
    } catch (e: any) {
      if (e?.fatal) throw e;
      lastErr = e; // network error → retry
    }
  }
  throw lastErr;
}

// ─── types ─────────────────────────────────────────────────────────────────────
export interface DateSpan {
  start: string; // YYYY-MM-DD — d0, the anchor date
  end: string; // YYYY-MM-DD
}

/** One stitched-event row, as stored. */
export interface Anchor {
  id: string; // hunt_knowledge row id
  title: string;
  family: string; // wind | flood | hail | winter | tornado | heat | tropical
  primaryState: string | null; // state_abbr
  states: string[]; // full multi-state set from metadata
  span: DateSpan;
  d0: string; // = span.start
  nMembers: number; // underlying NCEI member rows
  deaths: number;
  injuries: number;
  damageUsd: number;
}

/** One independent synoptic episode after same-family merge. */
export interface EffectiveAnchor {
  family: string;
  span: DateSpan; // union of merged spans
  d0: string; // = span.start
  states: string[]; // union, sorted
  primaryState: string | null; // state_abbr of the most severe merged row
  memberIds: string[]; // hunt_knowledge row ids merged into this episode
  titles: string[];
  rawCount: number; // stitched rows merged (1 = no merge)
  nMembers: number; // summed underlying NCEI rows
  deaths: number; // summed severity
  injuries: number;
  damageUsd: number;
}

/** A minable (family, region) cell with its floor stats. */
export interface Cell {
  family: string;
  region: string; // "US" or a state abbr
  nEff: number;
  distinctYears: number;
  eligible: boolean; // nEff ≥ FLOOR_N_EFF && distinctYears ≥ FLOOR_YEARS
}

export interface AnchorSet {
  raw: Anchor[];
  effective: EffectiveAnchor[];
  cells: Cell[];
}

// ─── date helpers (UTC, ISO date strings) ──────────────────────────────────────
const dayMs = 864e5;
const toTs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const minIso = (a: string, b: string) => (a <= b ? a : b);
const maxIso = (a: string, b: string) => (a >= b ? a : b);

function parseSpan(raw: string, id: string): DateSpan {
  const m = /^(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$/.exec(raw ?? "");
  if (!m) throw new Error(`anchor ${id}: unparseable date_span ${JSON.stringify(raw)}`);
  return { start: m[1], end: m[2] };
}

/** Gap in days between two spans: ≤0 = overlap, positive = days apart. */
function spanGapDays(a: DateSpan, b: DateSpan): number {
  const gap = Math.max(toTs(b.start) - toTs(a.end), toTs(a.start) - toTs(b.end));
  return gap / dayMs;
}

const intersects = (a: string[], bSet: Set<string>) => a.some((s) => bSet.has(s));

// ─── 1. pull ───────────────────────────────────────────────────────────────────
// NEVER select bare `metadata` — member_ids arrays are enormous (212 KB / 3 rows).
const SELECT =
  "select=id,title,state_abbr,effective_date," +
  "span:metadata->>date_span,states:metadata->states,families:metadata->families," +
  "n_members:metadata->>n_members,deaths:metadata->total_deaths," +
  "injuries:metadata->total_injuries,damage:metadata->total_damage_usd";

export async function fetchRawAnchors(): Promise<Anchor[]> {
  const raw: Anchor[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const rows = await fetchJson(
      `${SUPABASE_URL}/rest/v1/hunt_knowledge?${SELECT}` +
        `&content_type=eq.stitched-event&order=effective_date.asc&limit=${PAGE}&offset=${offset}`,
    );
    if (!Array.isArray(rows)) throw new Error(`page @${offset}: non-array response`);
    for (const r of rows) {
      const families: string[] = Array.isArray(r.families) ? r.families : [];
      if (families.length !== 1) {
        throw new Error(
          `anchor ${r.id}: expected exactly 1 family, got ${JSON.stringify(r.families)} — ` +
            `multi-family stitched rows change the dedupe model; revisit before mining`,
        );
      }
      const span = parseSpan(r.span, r.id);
      raw.push({
        id: r.id,
        title: r.title,
        family: families[0],
        primaryState: r.state_abbr ?? null,
        states: Array.isArray(r.states) ? r.states : [],
        span,
        d0: span.start,
        nMembers: Number(r.n_members ?? 0),
        deaths: Number(r.deaths ?? 0),
        injuries: Number(r.injuries ?? 0),
        damageUsd: Number(r.damage ?? 0),
      });
    }
    if (rows.length < PAGE) break;
  }

  // ── invariants (fail loudly — drift here means the mine's inputs moved) ──
  if (raw.length !== EXPECTED_RAW) {
    throw new Error(
      `ANCHOR DRIFT: expected ${EXPECTED_RAW} stitched-event rows, got ${raw.length}. ` +
        `The stitcher re-ran or committed new events — re-verify counts, then update EXPECTED_RAW.`,
    );
  }
  const pre1990 = raw.filter((a) => a.d0 < MIN_ANCHOR_DATE);
  if (pre1990.length > 0) {
    throw new Error(
      `PRE-1990 ANCHORS (${pre1990.length}, earliest ${pre1990[0].d0}): the stitcher backfilled ` +
        `earlier eras. The mine's control-window logic assumes 1990+ lane coverage — revisit ` +
        `control matching before admitting these (see MIN_ANCHOR_DATE comment).`,
    );
  }
  return raw;
}

// ─── 2. dedupe for independence ────────────────────────────────────────────────
export function dedupeAnchors(raw: Anchor[]): EffectiveAnchor[] {
  const effective: EffectiveAnchor[] = [];
  const byFamily = new Map<string, Anchor[]>();
  for (const a of raw) {
    if (!byFamily.has(a.family)) byFamily.set(a.family, []);
    byFamily.get(a.family)!.push(a);
  }

  for (const [family, anchors] of byFamily) {
    anchors.sort((a, b) => (a.d0 < b.d0 ? -1 : a.d0 > b.d0 ? 1 : 0));
    // Greedy transitive clustering over the date-sorted list. A cluster stays
    // open while new anchors land within MERGE_GAP_DAYS of its (growing) union
    // span AND touch its (growing) state set — that IS the transitive closure
    // for interval data once sorted by start.
    const clusters: Anchor[][] = [];
    for (const a of anchors) {
      let placed = false;
      for (const c of clusters) {
        const uSpan: DateSpan = {
          start: c.reduce((s, x) => minIso(s, x.span.start), c[0].span.start),
          end: c.reduce((e, x) => maxIso(e, x.span.end), c[0].span.end),
        };
        const uStates = new Set(c.flatMap((x) => x.states));
        if (spanGapDays(uSpan, a.span) <= MERGE_GAP_DAYS && intersects(a.states, uStates)) {
          c.push(a);
          placed = true;
          break;
        }
      }
      if (!placed) clusters.push([a]);
    }

    for (const c of clusters) {
      const start = c.reduce((s, x) => minIso(s, x.span.start), c[0].span.start);
      const end = c.reduce((e, x) => maxIso(e, x.span.end), c[0].span.end);
      // primary state = state_abbr of the most severe merged row (deaths, then
      // damage, then injuries, then member count) — the episode's center of harm.
      const sev = [...c].sort(
        (a, b) =>
          b.deaths - a.deaths || b.damageUsd - a.damageUsd || b.injuries - a.injuries ||
          b.nMembers - a.nMembers,
      )[0];
      effective.push({
        family,
        span: { start, end },
        d0: start,
        states: [...new Set(c.flatMap((x) => x.states))].sort(),
        primaryState: sev.primaryState,
        memberIds: c.map((x) => x.id),
        titles: c.map((x) => x.title),
        rawCount: c.length,
        nMembers: c.reduce((n, x) => n + x.nMembers, 0),
        deaths: c.reduce((n, x) => n + x.deaths, 0),
        injuries: c.reduce((n, x) => n + x.injuries, 0),
        damageUsd: c.reduce((n, x) => n + x.damageUsd, 0),
      });
    }
  }

  effective.sort((a, b) => (a.d0 < b.d0 ? -1 : a.d0 > b.d0 ? 1 : a.family < b.family ? -1 : 1));
  return effective;
}

// ─── 3. eligibility cells ──────────────────────────────────────────────────────
export function computeCells(effective: EffectiveAnchor[]): Cell[] {
  const cells: Cell[] = [];
  const families = [...new Set(effective.map((e) => e.family))].sort();

  for (const family of families) {
    const fam = effective.filter((e) => e.family === family);
    // family×national — always computed, eligibility flagged
    const natYears = new Set(fam.map((e) => e.d0.slice(0, 4)));
    cells.push({
      family,
      region: "US",
      nEff: fam.length,
      distinctYears: natYears.size,
      eligible: fam.length >= FLOOR_N_EFF && natYears.size >= FLOOR_YEARS,
    });
    // family×primary-state — emitted only where the floors pass
    const byState = new Map<string, EffectiveAnchor[]>();
    for (const e of fam) {
      if (!e.primaryState) continue;
      if (!byState.has(e.primaryState)) byState.set(e.primaryState, []);
      byState.get(e.primaryState)!.push(e);
    }
    for (const [state, list] of [...byState.entries()].sort()) {
      const years = new Set(list.map((e) => e.d0.slice(0, 4)));
      if (list.length >= FLOOR_N_EFF && years.size >= FLOOR_YEARS) {
        cells.push({ family, region: state, nEff: list.length, distinctYears: years.size, eligible: true });
      }
    }
  }
  return cells;
}

// ─── the export the orchestrator calls ─────────────────────────────────────────
export async function loadAnchors(): Promise<AnchorSet> {
  const raw = await fetchRawAnchors();
  const effective = dedupeAnchors(raw);
  const cells = computeCells(effective);
  return { raw, effective, cells };
}

// ─── CLI: --probe ──────────────────────────────────────────────────────────────
async function probe() {
  const t0 = Date.now();
  const { raw, effective, cells } = await loadAnchors();

  console.log(`\n=== LOOKOUT MINE — ANCHOR SET ===`);
  console.log(
    `raw ${raw.length} stitched rows → ${effective.length} effective anchors ` +
      `(merge: same family, spans overlap/±${MERGE_GAP_DAYS}d, states intersect)`,
  );
  console.log(`anchor range: ${raw[0].d0} → ${raw[raw.length - 1].d0}   (${Date.now() - t0} ms)`);

  const pad = (s: string | number, n: number) => String(s).padStart(n);
  const padE = (s: string, n: number) => s.padEnd(n);

  console.log(`\nper family (raw → effective):`);
  const families = [...new Set(raw.map((a) => a.family))].sort();
  for (const f of families) {
    const r = raw.filter((a) => a.family === f).length;
    const e = effective.filter((a) => a.family === f);
    const merged = e.filter((x) => x.rawCount > 1).length;
    console.log(
      `  ${padE(f, 9)} ${pad(r, 5)} → ${pad(e.length, 5)}   (${merged} merged episodes, ` +
        `largest ${Math.max(...e.map((x) => x.rawCount))} rows)`,
    );
  }

  console.log(`\nper decade (raw → effective, by d0):`);
  const decade = (d: string) => `${d.slice(0, 3)}0s`;
  const decades = [...new Set(raw.map((a) => decade(a.d0)))].sort();
  for (const dec of decades) {
    const r = raw.filter((a) => decade(a.d0) === dec).length;
    const e = effective.filter((a) => decade(a.d0) === dec).length;
    console.log(`  ${padE(dec, 9)} ${pad(r, 5)} → ${pad(e, 5)}`);
  }

  console.log(`\neligible cells (floors: n_eff ≥ ${FLOOR_N_EFF}, distinct years ≥ ${FLOOR_YEARS}):`);
  console.log(`  ${padE("family", 9)} ${padE("region", 7)} ${pad("n_eff", 6)} ${pad("years", 6)}  eligible`);
  for (const c of cells) {
    console.log(
      `  ${padE(c.family, 9)} ${padE(c.region, 7)} ${pad(c.nEff, 6)} ${pad(c.distinctYears, 6)}  ` +
        (c.eligible ? "YES" : "no"),
    );
  }
  const eligible = cells.filter((c) => c.eligible);
  console.log(
    `\n${eligible.length} eligible cells (${eligible.filter((c) => c.region === "US").length} national, ` +
      `${eligible.filter((c) => c.region !== "US").length} state) of ${cells.length} computed.\n`,
  );
}

const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
  } catch {
    return false;
  }
})();

if (isMain) {
  if (!process.argv.includes("--probe")) {
    console.error("usage: npx tsx scripts/mine/anchors.ts --probe");
    process.exit(1);
  }
  probe().catch((e) => {
    console.error("FATAL:", e);
    process.exit(1);
  });
}
