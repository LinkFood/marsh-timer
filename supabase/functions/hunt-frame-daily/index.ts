import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from "../_shared/cors.ts";
import { cronResponse, cronErrorResponse } from "../_shared/response.ts";
import { logCronRun } from "../_shared/cronLog.ts";

/**
 * hunt-frame-daily — THE BOARD Rung 2g: today's live frame (spine §5.1).
 *
 * Upserts ONE board_frames row for today (and re-finalizes yesterday) against the
 * seeded board_instruments/board_layout. A one-row daily maintenance write, exempt
 * from the big-pipe doctrine (§5.1) — it is not a backfill. It READS a bounded
 * same-doy±N band per lane (NO order-by → 57014) and computes each instrument's
 * depth-into-its-own-tail with the SAME engine the backfill mirrors, then packs the
 * one-sided uint8 bytea in layout order.
 *
 * Day-0 value comes from each instrument's OWN source_ct (commensurable with its
 * pool), taking the freshest reading ≤ target day within the band; day0_source
 * labels the leading lane's freshness ('live' | 'live-yesterday' | 'archive').
 * (Deviation from §5.1's hunt_weather_history temp day-0: same-source keeps value
 * and pool apples-to-apples; a fresher live-temp feed is a documented follow-up.)
 *
 * logCronRun fires on EVERY exit path. verify_jwt=false (config.toml). Pins std
 * @0.168.0. The tail-depth engine is inlined (pure, self-contained bundle) — the
 * canonical copy is scripts/board/tailDepth.ts.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FN = "hunt-frame-daily";
const BAND = 17; // ±days loaded around today's mmdd — covers every metric's N (max 15) + slack

// ─── Inlined engine (mirrors scripts/board/tailDepth.ts EXACTLY) ────────────────
type Direction = "low" | "high" | "two-sided";
const FULL_SWELL_MIN_YEARS = 10, LOW_CONFIDENCE_CAP = 0.6;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
function doyOffset(aIso: string, bIso: string): number {
  const md = (s: string) => { const [, m, dd] = s.split("-").map(Number); return { m, dd }; };
  const A = md(aIso), B = md(bIso);
  const cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const ord = (m: number, dd: number) => cum[m - 1] + dd;
  let diff = Math.abs(ord(A.m, A.dd) - ord(B.m, B.dd));
  if (diff > 182) diff = 365 - diff;
  return diff;
}
function lowRank(v: number, pool: number[]): number { let b = 0; for (const p of pool) if (p < v) b++; return 1 - b / pool.length; }
function highRank(v: number, pool: number[]): number { let b = 0; for (const p of pool) if (p < v) b++; return b / pool.length; }
function tailDepth(value: number, pool: number[], direction: Direction, years: number): number | null {
  if (pool.length === 0) return null;
  let pct: number;
  if (direction === "low") pct = lowRank(value, pool);
  else if (direction === "high") pct = highRank(value, pool);
  else { const lo = lowRank(value, pool), hi = highRank(value, pool); pct = Math.max(lo, hi); }
  if (years < FULL_SWELL_MIN_YEARS) pct = Math.min(pct, LOW_CONFIDENCE_CAP);
  return round3(pct);
}
function poolForDay(series: Map<string, number>, day: string, nDays: number): { pool: number[]; years: number } {
  const pool: number[] = []; const yrs = new Set<string>();
  for (const [d, v] of series) if (doyOffset(d, day) <= nDays && Number.isFinite(v)) { pool.push(v); yrs.add(d.slice(0, 4)); }
  return { pool, years: yrs.size };
}
const byteOf = (pct: number | null): number => (pct === null ? 255 : Math.round(pct * 254));

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
  const res = await fetch(`${SUPABASE_URL}/rest/v1/board_frames?on_conflict=day`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, apikey: KEY, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`upsert ${res.status}: ${(await res.text()).slice(0, 160)}`);
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
function bandRangesForYear(y: number, mmdd: string): [string, string][] {
  // The ±BAND calendar window around `mmdd`, clipped per year (wrap → two ranges).
  const [m, d] = mmdd.split("-").map(Number);
  const center = new Date(Date.UTC(2001, m - 1, d));
  const lo = new Date(center); lo.setUTCDate(lo.getUTCDate() - BAND);
  const hi = new Date(center); hi.setUTCDate(hi.getUTCDate() + BAND);
  const mmddOf = (x: Date) => isoOf(x).slice(5);
  if (lo.getUTCFullYear() === hi.getUTCFullYear()) return [[`${y}-${mmddOf(lo)}`, `${y}-${mmddOf(hi)}`]];
  // Wrap across Jan 1: [Dec tail of y-1..this y start] handled by two same-year ranges.
  return [[`${y}-01-01`, `${y}-${mmddOf(hi)}`], [`${y}-${mmddOf(lo)}`, `${y}-12-31`]];
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
serve(async (req) => {
  const cors = handleCors(req); if (cors) return cors;
  const started = Date.now();
  try {
    let body: any = {}; try { body = await req.json(); } catch { /* cron sends {} */ }
    const today = body.day ? new Date(body.day + "T00:00:00Z") : new Date();
    const todayIso = isoOf(today);
    const yesterday = new Date(today); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const targetDays = [isoOf(yesterday), todayIso];
    const nowYear = today.getUTCFullYear();
    const mmdd = todayIso.slice(5);

    // 1. Layout + registry (the seed's output).
    const layoutRows = await restGet(`board_layout?select=version,slot_manifest&order=created_at.desc&limit=1`, "layout");
    if (!layoutRows.length) { await logCronRun({ functionName: FN, status: "error", errorMessage: "no board_layout — seed not run", durationMs: Date.now() - started }); return cronErrorResponse("no board_layout", 412); }
    const layoutVersion: number = layoutRows[0].version;
    const manifest: { inst_id: string; metric: string; side: "low" | "high"; offset: number }[] = layoutRows[0].slot_manifest;
    const insts = await restGet(`board_instruments?active=eq.true&select=id,source_ct,source_key,metrics`, "instruments");
    if (!insts.length) { await logCronRun({ functionName: FN, status: "error", errorMessage: "no board_instruments", durationMs: Date.now() - started }); return cronErrorResponse("no instruments", 412); }
    const instById = new Map<string, any>(insts.map((i: any) => [i.id, i]));
    const nDaysOf = new Map<string, number>();
    for (const i of insts) for (const m of i.metrics) nDaysOf.set(`${i.id}:${m.field}`, m.n_days);

    // 2. Band series per (instId, field), loaded from each lane (bounded, NO order-by).
    const series = new Map<string, Map<string, number>>(); // key `${instId}:${field}`
    const ensure = (k: string) => { let m = series.get(k); if (!m) { m = new Map(); series.set(k, m); } return m; };
    const put = (m: Map<string, number>, date: string, v: number, side: "low" | "high" | "last") => {
      if (!Number.isFinite(v)) return; const cur = m.get(date);
      if (cur === undefined) m.set(date, v); else if (side === "low") m.set(date, Math.min(cur, v)); else if (side === "high") m.set(date, Math.max(cur, v)); else m.set(date, v);
    };
    const years = Array.from({ length: nowYear - 1950 + 1 }, (_, k) => 1950 + k);
    const rangesByYear = new Map<number, [string, string][]>(); for (const y of years) rangesByYear.set(y, bandRangesForYear(y, mmdd));

    // state-temp — one query/year for ALL states in the band.
    const stateInsts = insts.filter((i: any) => i.source_ct === "ghcn-daily");
    if (stateInsts.length) {
      const byAbbr = new Map<string, any>(stateInsts.map((i: any) => [i.source_key.state_abbr, i]));
      for (const y of years) for (const [gte, lte] of rangesByYear.get(y)!) {
        const rows = await restGet(`hunt_knowledge?content_type=eq.ghcn-daily&effective_date=gte.${gte}&effective_date=lte.${lte}&select=effective_date,state_abbr,ah:metadata->>avg_high_f`, `ghcn ${y}`);
        for (const r of rows) { const i = byAbbr.get(r.state_abbr); if (i) put(ensure(`${i.id}:avg_high_f`), r.effective_date, parseFloat(r.ah), "last"); }
      }
    }
    // tide + buoy — one query/year for the whole roster (station_id in-list).
    for (const [ct, fields] of [["tide-gauge", ["residual_max_ft", "residual_min_ft"]], ["ocean-buoy-historical", ["pressure_mb", "min_pressure_mb"]]] as const) {
      const lane = insts.filter((i: any) => i.source_ct === ct);
      if (!lane.length) continue;
      const byStation = new Map<string, any>(lane.map((i: any) => [i.source_key.station_id, i]));
      const idList = lane.map((i: any) => i.source_key.station_id).join(",");
      const sel = "select=effective_date,sid:metadata->>station_id," + fields.map((f, i) => `f${i}:metadata->>${f}`).join(",");
      const sideOf = (i: any, f: string) => { const m = i.metrics.find((x: any) => x.field === f); return m.direction === "two-sided" ? "last" : m.direction; };
      for (const y of years) for (const [gte, lte] of rangesByYear.get(y)!) {
        const rows = await restGet(`hunt_knowledge?content_type=eq.${ct}&metadata->>station_id=in.(${idList})&effective_date=gte.${gte}&effective_date=lte.${lte}&${sel}`, `${ct} ${y}`);
        for (const r of rows) { const i = byStation.get(r.sid); if (!i) continue; fields.forEach((f, k) => put(ensure(`${i.id}:${f}`), r.effective_date, parseFloat(r[`f${k}`]), sideOf(i, f))); }
      }
    }
    // needles — AO daily (CPC file); NAO/PDO/ENSO monthly climate-index → month-held.
    const needleInsts = insts.filter((i: any) => i.source_ct === "cpc-daily-ao" || i.source_ct === "climate-index");
    for (const i of needleInsts) {
      const m = ensure(`${i.id}:value`);
      if (i.source_ct === "cpc-daily-ao") {
        const text = await (await fetch("https://ftp.cpc.ncep.noaa.gov/cwlinks/norm.daily.ao.index.b500101.current.ascii")).text();
        for (const line of text.split("\n")) { const p = line.trim().split(/\s+/); if (p.length < 4) continue; const [yy, mo, dd, v] = p; const val = parseFloat(v); const iso = `${yy}-${mo.padStart(2, "0")}-${dd.padStart(2, "0")}`; if (Number.isFinite(val) && doyOffset(iso, todayIso) <= BAND) m.set(iso, val); }
      } else {
        const rows = await restGet(`hunt_knowledge?content_type=eq.climate-index&metadata->>index_id=eq.${i.source_key.index_id}&select=effective_date,val:metadata->>value`, `idx ${i.source_key.index_id}`);
        for (const r of rows) { const val = parseFloat(r.val); if (!Number.isFinite(val) || val <= -99) continue; const [yy, mo] = r.effective_date.split("-").map(Number); const days = new Date(Date.UTC(yy, mo, 0)).getUTCDate(); for (let dd = 1; dd <= days; dd++) { const iso = `${yy}-${String(mo).padStart(2, "0")}-${String(dd).padStart(2, "0")}`; if (doyOffset(iso, todayIso) <= BAND) m.set(iso, val); } }
      }
    }

    // 3. Assemble + upsert a frame per target day.
    const frames: any[] = [];
    let anyLive = false, anyRecent = false;
    for (const day of targetDays) {
      const buf = new Uint8Array(manifest.length).fill(255);
      let dayFresh: "live" | "live-yesterday" | "archive" = "archive";
      for (const slot of manifest) {
        const s = series.get(`${slot.inst_id}:${slot.metric}`); if (!s) continue;
        const nDays = nDaysOf.get(`${slot.inst_id}:${slot.metric}`)!;
        // Day-0: exact target value, else freshest reading ≤ day in the current year.
        let v = s.get(day); let vDate = day;
        if (v === undefined) {
          let best: string | null = null;
          for (const d of s.keys()) if (d <= day && d.slice(0, 4) === String(nowYear) && (best === null || d > best)) best = d;
          if (best) { v = s.get(best); vDate = best; }
        }
        if (v === undefined) continue;
        const { pool, years: yrs } = poolForDay(s, day, nDays);
        buf[slot.offset] = byteOf(tailDepth(v, pool, slot.side as Direction, yrs));
        const off = doyOffset(vDate, day);
        if (vDate === day) dayFresh = "live"; else if (off <= 2 && dayFresh !== "live") dayFresh = "live-yesterday";
      }
      if (dayFresh === "live") anyLive = true; if (dayFresh === "live-yesterday") anyRecent = true;
      frames.push({ day, layout_version: layoutVersion, dots: "\\x" + Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join(""), day0_source: dayFresh });
    }
    await restUpsert(frames);

    const summary = { days: targetDays, layoutVersion, instruments: insts.length, slots: manifest.length, day0: anyLive ? "live" : anyRecent ? "live-yesterday" : "archive" };
    await logCronRun({ functionName: FN, status: "success", summary, durationMs: Date.now() - started });
    return cronResponse({ ok: true, ...summary });
  } catch (err) {
    await logCronRun({ functionName: FN, status: "error", errorMessage: String(err).slice(0, 300), durationMs: Date.now() - started });
    return cronErrorResponse(String(err).slice(0, 300), 500);
  }
});
