/**
 * rhyme.ts — THE RHYME METRIC, done right (docs/THE-BOARD-SPINE.md §3.5).
 *
 * "Days whose ground reads like this day" — where AS-EXTREME-AS ranks above
 * MERELY-SIMILAR-DIRECTION. This is the fix for the plain-cosine POC's failure
 * (scripts/board/rhyme-poc*.ts): plain cosine over raw frame pcts SATURATES.
 *
 * ─── WHY PLAIN COSINE FAILS ───────────────────────────────────────────────────
 * Every slot in a frame is a percentile-RANK on one danger side. Rank is uniform,
 * so an ORDINARY day sits at pct≈0.5 on EVERY slot. Two boring days are therefore
 * two near-constant 0.5 vectors — and cosine of two constant vectors is ≈1.0. The
 * magnitude (how DEEP into the tail) is exactly what cosine's L2-normalization
 * throws away, so a dozen unremarkable cold Februaries tie at 1.000 and Uri's real
 * decade-earlier precedent (Feb 2011) gets buried under them. Direction was matched;
 * extremity was deleted.
 *
 * ─── THE METRIC ───────────────────────────────────────────────────────────────
 * Two transforms fix it:
 *
 *   1. CENTER + TAIL-EMPHASIS.  Map each slot pct∈[0,1] to a SIGNED tail deviation:
 *          u = 2·pct − 1               // −1 … 0(median) … +1
 *          x = sign(u) · |u|^GAMMA     // GAMMA>1 sharpens the tails
 *      Now an ordinary day → all ≈0 (no direction at all, as it should be); a record
 *      day → ±1 on the slots it broke. Centering is universally valid because rank
 *      is uniform: pct=0.5 is "a perfectly ordinary day for this instrument/side",
 *      independent of whether the side is low, high, or one half of a two-sided pair.
 *
 *   2. DIRECTION × MAGNITUDE-AGREEMENT.  Over the slots both frames actually read:
 *          cos      = Σxy / √(Σx²·Σy²)          // SHAPE: same instruments, same way
 *          r        = √(Σy² / Σx²)              // candidate energy / target energy
 *          magAgree = min(r, 1/r) ^ BETA        // 1 = equally extreme, →0 = mismatch
 *          score    = max(0, cos) · magAgree
 *      cos answers "does the country's ground have the same SHAPE as the target day".
 *      magAgree answers "is it AS EXTREME AS the target". A shallow but same-shaped
 *      day (generic cold Feb) has cos≈1 but low energy → magAgree small → pushed down.
 *      A same-shaped, comparably-deep day (Feb 2011) scores high on BOTH → rises. The
 *      score is 1.0 only for a day that is Uri's shape AND Uri's depth — the plateau
 *      is gone.
 *
 * Requirements met:
 *   (a) no saturation plateau — score=1 requires matching shape AND depth (--matrix proves it)
 *   (b) one bounded read of all 27,951 frames (~4 MB) held in RAM — no per-call DB work
 *   (c) same-season guard via --doy-window (±N calendar days, Dec/Jan wrap)
 *   (d) self-exclusion: candidates within ±3 days of the target are dropped
 *
 * Explainability: a match reports the instruments that drove it — the slots with the
 * largest positive x·y contribution, grouped to their instrument ("matched on: TX
 * temp depth, AO grip, OK temp"). A rhyme you can't explain is a coincidence.
 *
 * The RPC frame_rhyme() (supabase/migrations/20260711110000_frame_rhyme_rpc.sql)
 * implements the SAME metric server-side for the product; the two must agree on the
 * acceptance day.
 *
 * Usage:
 *   npx tsx scripts/frames/rhyme.ts --day 2021-02-15 [--topk 12] [--doy-window 45]
 *   npx tsx scripts/frames/rhyme.ts --day 2021-02-15 --matrix   # benchmark vs plain cosine
 */

import { execSync } from "child_process";

const SUPABASE_URL = "https://rvhyotvklfowklzjahdd.supabase.co";

// ─── metric parameters (justified above) ──────────────────────────────────────
const GAMMA = 1.5; // tail-emphasis: sharpens deep slots over mild ones
const BETA = 1.0; // magnitude-agreement strength
const MIN_OVERLAP = 80; // need this many shared readable slots to compare (of 142)
const SELF_EXCL_DAYS = 3; // drop candidates within ±3 days of the target
const NSLOT = 142;

// ─── key + headers ────────────────────────────────────────────────────────────
function serviceKey(): string {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
  const out = execSync(
    "npx supabase projects api-keys --project-ref rvhyotvklfowklzjahdd --output json 2>/dev/null",
    { encoding: "utf-8", timeout: 30_000 },
  );
  const arr = JSON.parse(out);
  const k = (Array.isArray(arr) ? arr : []).find(
    (x: any) => x.id === "service_role" || x.name === "service_role",
  )?.api_key;
  if (!k) throw new Error("no service_role key");
  return k;
}
const KEY = serviceKey();
const H = { Authorization: `Bearer ${KEY}`, apikey: KEY };

// ─── doy distance (Dec/Jan wrap), inlined so this file is self-contained ───────
function doyOffset(aIso: string, bIso: string): number {
  const md = (s: string) => {
    const [, m, dd] = s.split("-").map(Number);
    return { m, dd };
  };
  const A = md(aIso), B = md(bIso);
  const cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const ord = (m: number, dd: number) => cum[m - 1] + dd;
  let diff = Math.abs(ord(A.m, A.dd) - ord(B.m, B.dd));
  if (diff > 182) diff = 365 - diff;
  return diff;
}

// ─── layout + instruments ──────────────────────────────────────────────────────
interface SlotDef { offset: number; inst_id: string; side: string; metric: string; }
interface InstMeta { label: string; lane: string; sublabel: string | null; }

async function fetchLayout(): Promise<{ version: number; slots: SlotDef[] }> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/board_layout?select=version,slot_manifest&order=created_at.desc&limit=1`,
    { headers: H },
  );
  if (!res.ok) throw new Error(`board_layout ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("no board_layout row");
  const manifest = rows[0].slot_manifest as SlotDef[];
  const slots = new Array(NSLOT);
  for (const s of manifest) slots[s.offset] = s;
  return { version: rows[0].version, slots };
}

async function fetchInstruments(): Promise<Map<string, InstMeta>> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/board_instruments?select=id,label,lane,sublabel&active=eq.true`,
    { headers: H },
  );
  if (!res.ok) throw new Error(`board_instruments ${res.status}`);
  const rows = await res.json();
  const m = new Map<string, InstMeta>();
  for (const r of rows) m.set(r.id, { label: r.label, lane: r.lane, sublabel: r.sublabel });
  return m;
}

// ─── load ALL frames into RAM (§3.5 v1: one bounded read, ~4 MB) ───────────────
// board_frames.day is the PK, so ordered pagination is index-backed (no 57014).
function decodeHexBytea(hex: string): Uint8Array {
  // PostgREST returns bytea as '\x7688d8...'
  const h = hex.startsWith("\\x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

/**
 * Transform a raw frame (uint8, 255=null) into the signed tail-emphasis vector.
 * Returns Float32Array[NSLOT] with NaN where the slot is null/unreadable.
 */
function transformFrame(bytes: Uint8Array): Float32Array {
  const x = new Float32Array(NSLOT);
  for (let i = 0; i < NSLOT; i++) {
    const b = bytes[i];
    if (b === 255 || b === undefined) { x[i] = NaN; continue; }
    const pct = b / 254; // [0,1]
    const u = 2 * pct - 1; // [-1,1], 0 at median
    x[i] = Math.sign(u) * Math.pow(Math.abs(u), GAMMA);
  }
  return x;
}

async function fetchAllFrames(): Promise<{ days: string[]; mat: Float32Array[] }> {
  const days: string[] = [];
  const mat: Float32Array[] = [];
  const PAGE = 1000;
  let offset = 0;
  process.stderr.write("loading frames");
  for (;;) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/board_frames?select=day,dots&order=day.asc&limit=${PAGE}&offset=${offset}`,
      { headers: H },
    );
    if (!res.ok) throw new Error(`board_frames ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const r of rows) {
      days.push(r.day);
      mat.push(transformFrame(decodeHexBytea(r.dots)));
    }
    process.stderr.write(".");
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  process.stderr.write(` ${days.length} frames\n`);
  return { days, mat };
}

// ─── THE METRIC ────────────────────────────────────────────────────────────────
interface Match { idx: number; score: number; cos: number; magAgree: number; overlap: number; }

/** Core score of candidate y against target x (both already tail-transformed). */
function rhymeScore(x: Float32Array, y: Float32Array): Match | null {
  let dot = 0, nx = 0, ny = 0, n = 0;
  for (let i = 0; i < NSLOT; i++) {
    const xi = x[i], yi = y[i];
    if (Number.isNaN(xi) || Number.isNaN(yi)) continue;
    dot += xi * yi; nx += xi * xi; ny += yi * yi; n++;
  }
  if (n < MIN_OVERLAP || nx === 0 || ny === 0) return null;
  const cos = dot / Math.sqrt(nx * ny);
  const r = Math.sqrt(ny / nx);
  const magAgree = Math.pow(Math.min(r, 1 / r), BETA);
  const score = Math.max(0, cos) * magAgree;
  return { idx: -1, score, cos, magAgree, overlap: n };
}

/** Plain cosine (the POC's metric) — kept only for --matrix benchmarking. */
function plainCosine(x: Float32Array, y: Float32Array): number | null {
  let dot = 0, nx = 0, ny = 0, n = 0;
  for (let i = 0; i < NSLOT; i++) {
    const xi = x[i], yi = y[i];
    if (Number.isNaN(xi) || Number.isNaN(yi)) continue;
    dot += xi * yi; nx += xi * xi; ny += yi * yi; n++;
  }
  if (n < MIN_OVERLAP || nx === 0 || ny === 0) return null;
  return dot / Math.sqrt(nx * ny);
}

/** Top instruments that DROVE a match: largest positive per-slot x·y, grouped. */
function explain(
  x: Float32Array, y: Float32Array, slots: SlotDef[], inst: Map<string, InstMeta>, k = 4,
): string[] {
  const byInst = new Map<string, number>();
  for (let i = 0; i < NSLOT; i++) {
    const xi = x[i], yi = y[i];
    if (Number.isNaN(xi) || Number.isNaN(yi)) continue;
    const c = xi * yi;
    if (c <= 0) continue; // only aligned, same-direction depth explains a rhyme
    const id = slots[i]?.inst_id ?? `slot${i}`;
    byInst.set(id, (byInst.get(id) ?? 0) + c);
  }
  return [...byInst.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([id]) => {
      const m = inst.get(id);
      if (!m) return id;
      // direction tag from the target's dominant side for this instrument
      const lowOff = slots.findIndex((s) => s?.inst_id === id && s.side === "low");
      const dir = lowOff >= 0 && !Number.isNaN(x[lowOff]) && x[lowOff] > 0 ? "cold/low" : "hot/high";
      return m.lane === "air" ? `${m.label} temp (${dir})` : `${m.label}`;
    });
}

// ─── CLI ───────────────────────────────────────────────────────────────────────
function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return def;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const day = arg("day");
  if (!day) { console.error("usage: --day YYYY-MM-DD [--topk N] [--doy-window N] [--matrix]"); process.exit(1); }
  const topk = parseInt(arg("topk", "12")!, 10);
  const doyWindow = arg("doy-window") ? parseInt(arg("doy-window")!, 10) : null;
  const matrixMode = flag("matrix");

  const [{ version, slots }, inst, { days, mat }] = await Promise.all([
    fetchLayout(), fetchInstruments(), fetchAllFrames(),
  ]);
  const ti = days.indexOf(day);
  if (ti < 0) { console.error(`no frame for ${day}`); process.exit(1); }
  const x = mat[ti];

  const targetTs = Date.parse(day);
  const candidates: Match[] = [];
  const plainCands: { idx: number; cos: number }[] = [];
  for (let i = 0; i < days.length; i++) {
    if (i === ti) continue;
    if (Math.abs(Date.parse(days[i]) - targetTs) <= SELF_EXCL_DAYS * 864e5) continue;
    if (doyWindow !== null && doyOffset(days[i], day) > doyWindow) continue;
    const m = rhymeScore(x, mat[i]);
    if (m) { m.idx = i; candidates.push(m); }
    if (matrixMode) { const c = plainCosine(x, mat[i]); if (c !== null) plainCands.push({ idx: i, cos: c }); }
  }

  console.log(`\n=== FRAME RHYME — ${day} ===`);
  console.log(`layout v${version} · ${days.length} frames · ${candidates.length} candidates` +
    (doyWindow !== null ? ` (doy±${doyWindow})` : " (all seasons)") +
    ` · metric: direction × magnitude-agreement (γ=${GAMMA}, β=${BETA})`);

  // target self-energy — a magnitude read on the day itself
  let selfE = 0, selfN = 0;
  for (let i = 0; i < NSLOT; i++) if (!Number.isNaN(x[i])) { selfE += x[i] * x[i]; selfN++; }
  console.log(`target energy (RMS tail-depth over ${selfN} slots): ${Math.sqrt(selfE / selfN).toFixed(3)}  ` +
    `(0=calm, 1=everything at its extreme)`);
  console.log(`target's deepest instruments: ${explain(x, x, slots, inst, 6).join(", ")}`);

  candidates.sort((a, b) => b.score - a.score);
  const scoreVals = candidates.map((c) => c.score).sort((a, b) => a - b);
  const q = (p: number) => scoreVals[Math.floor(scoreVals.length * p)] ?? 0;
  console.log(`\nscore distribution: median ${q(0.5).toFixed(3)} · 90th ${q(0.9).toFixed(3)} · ` +
    `99th ${q(0.99).toFixed(3)} · max ${(scoreVals[scoreVals.length - 1] ?? 0).toFixed(3)}`);
  const plateau = candidates.filter((c) => c.score >= 0.999).length;
  console.log(`saturation check: ${plateau} candidates at score≥0.999 (plateau is the POC's disease)`);

  console.log(`\ntop ${topk} rhymes:`);
  for (const m of candidates.slice(0, topk)) {
    const why = explain(x, mat[m.idx], slots, inst, 4).join(", ");
    console.log(`  ${days[m.idx]}   score ${m.score.toFixed(3)}   ` +
      `[cos ${m.cos.toFixed(2)} · mag ${m.magAgree.toFixed(2)}]   matched on: ${why}`);
  }

  // --probe DATE[,DATE...] : where do specific days rank? (acceptance diagnostics)
  const probe = arg("probe");
  if (probe) {
    console.log(`\n── PROBE: rank of specific days ──`);
    const ranked = candidates; // already sorted desc by score
    for (const p of probe.split(",")) {
      const hit = ranked.findIndex((m) => days[m.idx] === p);
      if (hit < 0) { console.log(`  ${p}: not a candidate (missing frame / out of window / self-excluded)`); continue; }
      const m = ranked[hit];
      const why = explain(x, mat[m.idx], slots, inst, 4).join(", ");
      console.log(`  ${p}: rank #${hit + 1}/${ranked.length}  score ${m.score.toFixed(3)}  ` +
        `[cos ${m.cos.toFixed(2)} · mag ${m.magAgree.toFixed(2)}]  matched on: ${why}`);
    }
  }

  if (matrixMode) {
    plainCands.sort((a, b) => b.cos - a.cos);
    const plainPlateau = plainCands.filter((c) => c.cos >= 0.999).length;
    console.log(`\n── BENCHMARK: plain cosine (the POC) vs the hybrid ──`);
    console.log(`plain cosine: ${plainPlateau} candidates tie at cos≥0.999 (the saturation plateau)`);
    console.log(`plain-cosine top ${topk} (magnitude-blind — note the unremarkable days):`);
    for (const c of plainCands.slice(0, topk)) {
      console.log(`  ${days[c.idx]}   cos ${c.cos.toFixed(4)}`);
    }
    console.log(`\nthe hybrid re-sorts that plateau by AS-EXTREME-AS (magnitude), lifting the`);
    console.log(`genuinely-comparable days above the merely-same-direction ones.`);
  }

  console.log(`\nhonest frame: score=1 needs matching SHAPE and DEPTH. a high cos with low mag`);
  console.log(`is "same weather, milder"; a high mag with low cos is "as extreme, different ground".\n`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
