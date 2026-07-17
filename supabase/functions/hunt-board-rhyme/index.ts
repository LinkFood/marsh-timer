import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from "../_shared/cors.ts";
import { cronResponse, cronErrorResponse } from "../_shared/response.ts";
import { logCronRun } from "../_shared/cronLog.ts";

/**
 * hunt-board-rhyme — the front door's daily rhyme line.
 *
 * "Today reads most like March 4, 2019 — the same instruments, deep the same
 * way. What followed then: ___."
 *
 * For the latest board_frames.day (or ?day=YYYY-MM-DD, or ?backfill=N for the
 * latest N days in one invocation), computes the top-5 rhyme days over ALL
 * frames and upserts them into board_rhymes (PK day,rank — idempotent, safe to
 * rerun).
 *
 * THE METRIC is a byte-for-byte port of scripts/frames/rhyme.ts (see its header
 * for the full derivation — the fix for the plain-cosine saturation plateau):
 *   per slot:  pct = byte/254 (255 = null) ; u = 2·pct − 1 ; x = sign(u)·|u|^1.5
 *   over the slots BOTH frames read (≥ MIN_OVERLAP of the manifest's slots):
 *     cos      = Σxy / √(Σx²·Σy²)          — shape: same instruments, same way
 *     r        = √(Σy² / Σx²)              — candidate energy / target energy
 *     magAgree = min(r, 1/r) ^ BETA        — 1 = as-extreme-as, →0 = milder/wilder
 *     score    = max(0, cos) · magAgree
 *
 * Candidates: every frame day EXCEPT those within ±45 calendar days of the
 * target (no "yesterday rhymes with today").
 *
 * Drivers: the top ~4 instruments by aligned joint depth (Σ positive x·y),
 * with human labels ("Iowa temp", "Baltimore harbor", "Arctic Oscillation").
 *
 * "What followed": the most severe stitched-event beginning in [R, R+10d]
 * (severity = deaths·100 + injuries + damage_usd/1e6, ranked CLIENT-side —
 * metadata->>'' numeric filters are TEXT comparisons, never filter numerically
 * server-side); fallback the top live storm-event in the same window; if
 * neither carries a real event → followed = null. Null is honest: no named
 * event followed.
 *
 * Slot offsets come from the board_layout slot_manifest ONLY — never re-derived.
 * logCronRun fires on EVERY exit path. Retries 5xx/network only. Pins std
 * @0.168.0. verify_jwt=false (config.toml).
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FN = "hunt-board-rhyme";

// ─── metric parameters (scripts/frames/rhyme.ts — copy its math exactly) ────────
const GAMMA = 1.5; // tail-emphasis: sharpens deep slots over mild ones
const BETA = 1.0; // magnitude-agreement strength
const MIN_OVERLAP = 80; // need this many shared readable slots to compare
let NSLOT = 0; // set from the layout's slot_manifest length — never hardcoded (append-only law)
const EXCL_DAYS = 45; // drop candidates within ±45 calendar days of the target
const TOP_K = 5;
const FOLLOW_DAYS = 10; // "what followed" window after the rhyme day
const DRIVER_K = 4;

type Direction = "low" | "high";
interface SlotDef { offset: number; inst_id: string; side: Direction; metric: string; }
interface InstMeta { label: string; kind: string; lane: string; sublabel: string | null; }
interface Followed {
  title: string; began: string; days_after: number;
  deaths: number; injuries: number; damage_usd: number;
}

// ─── REST (both headers; retry 5xx/network only) ─────────────────────────────────
async function restGet(query: string, label: string, attempts = 5): Promise<any[]> {
  let lastErr: any;
  for (let a = 1; a <= attempts; a++) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${query}`, { headers: { Authorization: `Bearer ${KEY}`, apikey: KEY } });
      if (res.ok) return await res.json();
      const body = (await res.text()).slice(0, 160);
      if (res.status >= 400 && res.status < 500) throw new Error(`${label} ${res.status}: ${body}`);
      lastErr = new Error(`${label} ${res.status}: ${body}`);
    } catch (e) { lastErr = e; }
    if (a < attempts) await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** (a - 1), 12000)));
  }
  throw lastErr;
}
async function restUpsert(rows: unknown[]) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/board_rhymes?on_conflict=day,rank`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, apikey: KEY, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`upsert ${res.status}: ${(await res.text()).slice(0, 160)}`);
}

// ─── frame decode + tail transform (rhyme.ts, byte-for-byte) ─────────────────────
function decodeHexBytea(hex: string): Uint8Array {
  // PostgREST returns bytea as '\x7688d8...'
  const h = hex.startsWith("\\x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

/** Signed tail-emphasis vector; NaN where the slot is null/unreadable. */
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

// ─── THE METRIC (rhyme.ts, byte-for-byte) ────────────────────────────────────────
interface Match { idx: number; score: number; cos: number; magAgree: number; overlap: number; }
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

// ─── drivers: top instruments by aligned joint depth, human-labeled ──────────────
function humanLabel(m: InstMeta): string {
  switch (m.kind) {
    case "state-temp": return `${m.label} temp`;
    case "tide": return `${m.label} harbor`;
    case "buoy": return `${m.label} pressure`;
    default: return m.label; // needles: 'Arctic Oscillation'
  }
}
function drivers(
  x: Float32Array, y: Float32Array, slots: (SlotDef | undefined)[], inst: Map<string, InstMeta>,
): { label: string; side: Direction; kind: string }[] {
  // per instrument: total positive x·y + the side of its strongest aligned slot
  const byInst = new Map<string, { total: number; bestC: number; side: Direction }>();
  for (let i = 0; i < NSLOT; i++) {
    const xi = x[i], yi = y[i];
    if (Number.isNaN(xi) || Number.isNaN(yi)) continue;
    const c = xi * yi;
    if (c <= 0) continue; // only aligned, same-direction depth explains a rhyme
    const slot = slots[i]; if (!slot) continue;
    const cur = byInst.get(slot.inst_id);
    if (!cur) byInst.set(slot.inst_id, { total: c, bestC: c, side: slot.side });
    else { cur.total += c; if (c > cur.bestC) { cur.bestC = c; cur.side = slot.side; } }
  }
  return [...byInst.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, DRIVER_K)
    .map(([id, v]) => {
      const m = inst.get(id);
      return { label: m ? humanLabel(m) : id, side: v.side, kind: m?.kind ?? "unknown" };
    });
}

// ─── "what followed" — stitched event first, live storm-event fallback ───────────
const isoDaysAfter = (iso: string, n: number): string =>
  new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const severity = (deaths: number, injuries: number, damageUsd: number): number =>
  deaths * 100 + injuries + damageUsd / 1e6;

async function whatFollowed(rhymeDay: string, cache: Map<string, Followed | null>): Promise<Followed | null> {
  const hit = cache.get(rhymeDay);
  if (hit !== undefined) return hit;
  const until = isoDaysAfter(rhymeDay, FOLLOW_DAYS);
  const pick = (rows: any[]): Followed | null => {
    let best: Followed | null = null, bestSev = 0;
    for (const r of rows) {
      const deaths = Number(r.deaths ?? 0), injuries = Number(r.injuries ?? 0), damage = Number(r.damage ?? 0);
      const sev = severity(deaths, injuries, damage);
      if (best === null || sev > bestSev) {
        bestSev = sev;
        best = {
          title: r.title, began: r.effective_date,
          days_after: Math.round((Date.parse(r.effective_date) - Date.parse(rhymeDay)) / 864e5),
          deaths, injuries, damage_usd: damage,
        };
      }
    }
    return best;
  };

  // 1. Stitched events (few, curated, named) — severity-ranked CLIENT-side.
  const stitched = await restGet(
    `hunt_knowledge?content_type=eq.stitched-event&effective_date=gte.${rhymeDay}&effective_date=lte.${until}` +
      `&select=title,effective_date,deaths:metadata->total_deaths,injuries:metadata->total_injuries,damage:metadata->total_damage_usd`,
    "stitched window",
  );
  let followed = pick(stitched);

  // 2. Fallback: top live (non-superseded) storm-event, national, same window.
  //    Bounded fetch (limit 200, DB-ordered by metadata->deaths desc) then
  //    severity-ranked client-side. Never order hunt_knowledge unfiltered.
  if (!followed) {
    const storms = await restGet(
      `hunt_knowledge?content_type=eq.storm-event&metadata->superseded=is.null` +
        `&effective_date=gte.${rhymeDay}&effective_date=lte.${until}` +
        `&select=title,effective_date,deaths:metadata->deaths,injuries:metadata->injuries,damage:metadata->damage_usd` +
        `&order=metadata->deaths.desc.nullslast&limit=200`,
      "storm window",
    );
    const top = pick(storms);
    // A zero-severity storm row is not a named event that "followed" — stay null.
    if (top && severity(top.deaths, top.injuries, top.damage_usd) > 0) followed = top;
  }

  cache.set(rhymeDay, followed);
  return followed;
}

// ─── load the whole frame store (ordered day-PK pagination, ~28 pages) ──────────
async function fetchAllFrames(layoutVersion: number): Promise<{ days: string[]; mat: Float32Array[] }> {
  const days: string[] = [];
  const mat: Float32Array[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const rows = await restGet(
      `board_frames?select=day,dots&layout_version=eq.${layoutVersion}&order=day.asc&limit=${PAGE}&offset=${offset}`,
      "board_frames page",
    );
    for (const r of rows) { days.push(r.day); mat.push(transformFrame(decodeHexBytea(r.dots))); }
    if (rows.length < PAGE) break;
  }
  return { days, mat };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
serve(async (req) => {
  const cors = handleCors(req); if (cors) return cors;
  const started = Date.now();
  try {
    let body: any = {}; try { body = await req.json(); } catch { /* cron sends {} */ }
    const url = new URL(req.url);
    const dayParam: string | null = url.searchParams.get("day") ?? body.day ?? null;
    const backfillRaw = url.searchParams.get("backfill") ?? body.backfill;
    const backfill = backfillRaw ? Math.max(1, Math.min(120, parseInt(String(backfillRaw), 10) || 0)) : 0;

    // 1. Layout (slot offsets from the manifest ONLY) + instrument labels.
    const layoutRows = await restGet(`board_layout?select=version,slot_manifest&order=created_at.desc&limit=1`, "layout");
    if (!layoutRows.length) {
      await logCronRun({ functionName: FN, status: "error", errorMessage: "no board_layout — seed not run", durationMs: Date.now() - started });
      return cronErrorResponse("no board_layout", 412);
    }
    const layoutVersion: number = layoutRows[0].version;
    NSLOT = (layoutRows[0].slot_manifest as SlotDef[]).length; // 144 as of layout v1711701607
    const slots: (SlotDef | undefined)[] = new Array(NSLOT);
    for (const s of layoutRows[0].slot_manifest as SlotDef[]) slots[s.offset] = s;

    const instRows = await restGet(`board_instruments?active=eq.true&select=id,label,kind,lane,sublabel`, "instruments");
    const inst = new Map<string, InstMeta>();
    for (const r of instRows) inst.set(r.id, { label: r.label, kind: r.kind, lane: r.lane, sublabel: r.sublabel });

    // 2. ALL frames into RAM (server-side next to the DB — one bounded read).
    const { days, mat } = await fetchAllFrames(layoutVersion);
    if (!days.length) {
      await logCronRun({ functionName: FN, status: "error", errorMessage: "no board_frames — backfill not run", durationMs: Date.now() - started });
      return cronErrorResponse("no board_frames", 412);
    }

    // 3. Targets: ?backfill=N → latest N days; ?day= → that day; else latest.
    let targets: string[];
    if (backfill > 0) targets = days.slice(-backfill);
    else if (dayParam) {
      if (!days.includes(dayParam)) {
        await logCronRun({ functionName: FN, status: "error", errorMessage: `no frame for ${dayParam}`, durationMs: Date.now() - started });
        return cronErrorResponse(`no frame for ${dayParam}`, 404);
      }
      targets = [dayParam];
    } else targets = [days[days.length - 1]];

    // 4. Rhyme each target over the SAME loaded store; upsert (day,rank).
    const followedCache = new Map<string, Followed | null>();
    const computedAt = new Date().toISOString();
    const outRows: any[] = [];
    const skipped: string[] = [];
    const preview: any[] = [];
    for (const target of targets) {
      const ti = days.indexOf(target);
      const x = mat[ti];
      const targetTs = Date.parse(target + "T00:00:00Z");
      const cands: Match[] = [];
      for (let i = 0; i < days.length; i++) {
        if (i === ti) continue;
        if (Math.abs(Date.parse(days[i] + "T00:00:00Z") - targetTs) <= EXCL_DAYS * 864e5) continue;
        const m = rhymeScore(x, mat[i]);
        if (m) { m.idx = i; cands.push(m); }
      }
      if (!cands.length) { skipped.push(target); continue; }
      cands.sort((a, b) => b.score - a.score);
      const top = cands.slice(0, TOP_K);
      for (let rank = 1; rank <= top.length; rank++) {
        const m = top[rank - 1];
        const rhymeDay = days[m.idx];
        outRows.push({
          day: target, rank, rhyme_day: rhymeDay,
          score: Math.round(m.score * 1e6) / 1e6,
          cos: Math.round(m.cos * 1e6) / 1e6,
          mag: Math.round(m.magAgree * 1e6) / 1e6,
          drivers: drivers(x, mat[m.idx], slots, inst),
          followed: await whatFollowed(rhymeDay, followedCache),
          computed_at: computedAt,
        });
      }
      preview.push({ day: target, rank1: { rhyme_day: days[top[0].idx], score: Math.round(top[0].score * 1e3) / 1e3 } });
    }
    if (outRows.length) await restUpsert(outRows);

    const summary = {
      targets: targets.length, frames: days.length, layoutVersion,
      rowsUpserted: outRows.length, skipped, latest: preview[preview.length - 1] ?? null,
    };
    await logCronRun({ functionName: FN, status: "success", summary, durationMs: Date.now() - started });
    return cronResponse({ ok: true, ...summary, preview });
  } catch (err) {
    await logCronRun({ functionName: FN, status: "error", errorMessage: String(err).slice(0, 300), durationMs: Date.now() - started });
    return cronErrorResponse(String(err).slice(0, 300), 500);
  }
});
