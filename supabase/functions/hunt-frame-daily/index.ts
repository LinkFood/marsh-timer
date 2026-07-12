import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from "../_shared/cors.ts";
import { cronResponse, cronErrorResponse } from "../_shared/response.ts";
import { logCronRun } from "../_shared/cronLog.ts";

/**
 * hunt-frame-daily — THE BOARD Rung 2g: today's live frame (spine §5.1).
 *
 * Upserts ONE board_frames row for today (and re-finalizes yesterday) against the
 * seeded board_instruments/board_layout. A one-row daily maintenance write, exempt
 * from the big-pipe doctrine (§5.1) — it is not a backfill.
 *
 * THE POOL LUTs (board_pool_luts, migration 20260711090000): the 77-year same-doy
 * pools are precomputed ONCE by scripts/frames/bake-luts.ts. This function no longer
 * scans every instrument's whole history per invocation (that hung past the 120s
 * edge wall). It reads only:
 *   1. the layout + registry (the seed's output),
 *   2. the LUT rows for today's and yesterday's doy (ONE query),
 *   3. a small current-year day-0 window per lane (a handful of bounded reads),
 * then converts each raw reading to its board byte with a single binary search over
 * the LUT — reproducing scripts/board/tailDepth.ts EXACTLY:
 *   below(v) = count of pool values strictly < v   (lut.below[j], j = lowerBound(v))
 *   pct      = side==low ? 1 - below/n : below/n ;  if years<10: pct = min(pct,0.6)
 *   byte     = round(pct * 254)                     (255 = null)
 *
 * Day-0 value comes from each instrument's OWN source_ct (commensurable with its
 * pool), taking the freshest reading ≤ target day within a small current-year
 * window; day0_source labels the leading lane's freshness ('live'|'live-yesterday'
 * |'archive'). logCronRun fires on EVERY exit path. verify_jwt=false (config.toml).
 * Pins std @0.168.0. Target: completes in <10s.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FN = "hunt-frame-daily";
const DAY0_WINDOW = 17; // days back within the current year to hunt the freshest day-0 reading.
// Matches the old ±BAND(17) lookback: keeps the day-0 reading seasonally close to
// today (commensurable with today's doy pool) while tolerating realistic ingest lag
// (lanes can trail today by a week+; the freshest reading ≤ today in this window wins).

type Direction = "low" | "high";

// ─── LUT byte path (mirrors scripts/board/tailDepth.ts + bake-luts.ts EXACTLY) ───
type Lut = { vals: number[]; below: number[]; n: number; years: number };
function belowOf(lut: Lut, v: number): number {
  let lo = 0, hi = lut.vals.length; // first index with vals[j] >= v
  while (lo < hi) { const mid = (lo + hi) >> 1; if (lut.vals[mid] < v) lo = mid + 1; else hi = mid; }
  return lo < lut.below.length ? lut.below[lo] : lut.n;
}
const round3 = (x: number) => Math.round(x * 1000) / 1000;
const byteOf = (pct: number | null): number => (pct === null ? 255 : Math.round(pct * 254));
function byteFromLut(lut: Lut, v: number, side: Direction): number {
  if (lut.n === 0) return 255;
  const below = belowOf(lut, v);
  let pct = side === "low" ? 1 - below / lut.n : below / lut.n;
  if (lut.years < 10) pct = Math.min(pct, 0.6);
  return byteOf(round3(pct));
}

// ─── doy key (leap-year/2000 ordinal — matches bake-luts.ts) ────────────────────
const DOY_EPOCH = Date.UTC(2000, 0, 1);
function doyOfIso(iso: string): number {
  const [, m, d] = iso.split("-").map(Number);
  return Math.round((Date.UTC(2000, m - 1, d) - DOY_EPOCH) / 86400000) + 1;
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
  const res = await fetch(`${SUPABASE_URL}/rest/v1/board_frames?on_conflict=day`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, apikey: KEY, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`upsert ${res.status}: ${(await res.text()).slice(0, 160)}`);
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
const isoOf = (d: Date) => d.toISOString().slice(0, 10);

// ─── MAIN ─────────────────────────────────────────────────────────────────────
serve(async (req) => {
  const cors = handleCors(req); if (cors) return cors;
  const started = Date.now();
  try {
    let body: any = {}; try { body = await req.json(); } catch { /* cron sends {} */ }
    const today = body.day ? new Date(body.day + "T00:00:00Z") : new Date();
    const todayIso = isoOf(today);
    const yesterday = new Date(today); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayIso = isoOf(yesterday);
    const targetDays = [yesterdayIso, todayIso];
    const nowYear = today.getUTCFullYear();
    const windowStart = new Date(today); windowStart.setUTCDate(windowStart.getUTCDate() - DAY0_WINDOW);
    const winGte = isoOf(windowStart) < `${nowYear}-01-01` ? `${nowYear}-01-01` : isoOf(windowStart);

    // 1. Layout + registry (the seed's output).
    const layoutRows = await restGet(`board_layout?select=version,slot_manifest&order=created_at.desc&limit=1`, "layout");
    if (!layoutRows.length) { await logCronRun({ functionName: FN, status: "error", errorMessage: "no board_layout — seed not run", durationMs: Date.now() - started }); return cronErrorResponse("no board_layout", 412); }
    const layoutVersion: number = layoutRows[0].version;
    const manifest: { inst_id: string; metric: string; side: Direction; offset: number }[] = layoutRows[0].slot_manifest;
    const insts = await restGet(`board_instruments?active=eq.true&select=id,source_ct,source_key,metrics`, "instruments");
    if (!insts.length) { await logCronRun({ functionName: FN, status: "error", errorMessage: "no board_instruments", durationMs: Date.now() - started }); return cronErrorResponse("no instruments", 412); }

    // 2. LUT rows for today's + yesterday's doy (ONE query). Keyed by (inst,metric,doy).
    const doys = [...new Set(targetDays.map(doyOfIso))];
    const lutRows = await restGet(`board_pool_luts?layout_version=eq.${layoutVersion}&doy=in.(${doys.join(",")})&select=instrument_id,metric,doy,vals,below,n,years`, "pool_luts");
    if (!lutRows.length) { await logCronRun({ functionName: FN, status: "error", errorMessage: `no board_pool_luts for layout ${layoutVersion} — run bake-luts.ts`, durationMs: Date.now() - started }); return cronErrorResponse("no pool LUTs", 412); }
    const lutByKey = new Map<string, Lut>(); // `${inst}:${metric}:${doy}`
    for (const r of lutRows) lutByKey.set(`${r.instrument_id}:${r.metric}:${r.doy}`, { vals: r.vals, below: r.below, n: r.n, years: r.years });

    // 3. Small current-year day-0 windows per lane (bounded — NO order-by).
    // series key `${instId}:${field}` → Map<date, value>; keep-extreme dedup per side.
    const series = new Map<string, Map<string, number>>();
    const ensure = (k: string) => { let m = series.get(k); if (!m) { m = new Map(); series.set(k, m); } return m; };
    const put = (m: Map<string, number>, date: string, v: number, side: "low" | "high" | "last") => {
      if (!Number.isFinite(v)) return; const cur = m.get(date);
      if (cur === undefined) m.set(date, v); else if (side === "low") m.set(date, Math.min(cur, v)); else if (side === "high") m.set(date, Math.max(cur, v)); else m.set(date, v);
    };
    const sideOf = (i: any, f: string): "low" | "high" | "last" => { const m = i.metrics.find((x: any) => x.field === f); return m.direction === "two-sided" ? "last" : m.direction; };

    // state-temp — one query for ALL states in the window. ghcn-daily's backfill
    // edge ends ~2025-12 (no current-year rows), so day-0 comes from
    // hunt_weather_history (cron-fed daily, temp_high_f current through
    // yesterday) — the same live-vs-GHCN-pool pattern the dossiers shipped
    // 2026-07-08 (9efc29f). The LUT pools stay GHCN; both are state avg highs.
    const stateInsts = insts.filter((i: any) => i.source_ct === "ghcn-daily");
    if (stateInsts.length) {
      const byAbbr = new Map<string, any>(stateInsts.map((i: any) => [i.source_key.state_abbr, i]));
      const rows = await restGet(`hunt_weather_history?date=gte.${winGte}&date=lte.${todayIso}&select=date,state_abbr,temp_high_f`, "weather_history window");
      for (const r of rows) { const i = byAbbr.get(r.state_abbr); if (i) put(ensure(`${i.id}:avg_high_f`), r.date, parseFloat(r.temp_high_f), "last"); }
    }
    // tide + buoy — one query each for the whole roster (station_id in-list).
    for (const [ct, fields] of [["tide-gauge", ["residual_max_ft", "residual_min_ft"]], ["ocean-buoy-historical", ["pressure_mb", "min_pressure_mb"]]] as const) {
      const lane = insts.filter((i: any) => i.source_ct === ct);
      if (!lane.length) continue;
      const byStation = new Map<string, any>(lane.map((i: any) => [i.source_key.station_id, i]));
      const idList = lane.map((i: any) => i.source_key.station_id).join(",");
      const sel = "select=effective_date,sid:metadata->>station_id," + fields.map((f, i) => `f${i}:metadata->>${f}`).join(",");
      const rows = await restGet(`hunt_knowledge?content_type=eq.${ct}&metadata->>station_id=in.(${idList})&effective_date=gte.${winGte}&effective_date=lte.${todayIso}&${sel}`, `${ct} window`);
      for (const r of rows) { const i = byStation.get(r.sid); if (!i) continue; fields.forEach((f, k) => put(ensure(`${i.id}:${f}`), r.effective_date, parseFloat(r[`f${k}`]), sideOf(i, f))); }
    }
    // needles — AO daily (archive's climate-index-daily rows); NAO/PDO/ENSO monthly → current month held.
    const aoInsts = insts.filter((i: any) => i.source_ct === "cpc-daily-ao");
    if (aoInsts.length) {
      for (const i of aoInsts) {
        const rows = await restGet(`hunt_knowledge?content_type=eq.climate-index-daily&metadata->>index_id=eq.${i.source_key.index_id}&effective_date=gte.${winGte}&effective_date=lte.${todayIso}&select=effective_date,val:metadata->>value`, `daily-AO ${i.source_key.index_id}`);
        const m = ensure(`${i.id}:value`);
        for (const r of rows) { const val = parseFloat(r.val); if (Number.isFinite(val) && val > -99) m.set(r.effective_date, val); }
      }
    }
    const monthlyInsts = insts.filter((i: any) => i.source_ct === "climate-index");
    if (monthlyInsts.length) {
      const prevMonth = new Date(Date.UTC(nowYear, today.getUTCMonth() - 1, 1));
      const idList = monthlyInsts.map((i: any) => i.source_key.index_id).join(",");
      const byId = new Map<string, any>(monthlyInsts.map((i: any) => [i.source_key.index_id, i]));
      const rows = await restGet(`hunt_knowledge?content_type=eq.climate-index&metadata->>index_id=in.(${idList})&effective_date=gte.${isoOf(prevMonth)}&effective_date=lte.${todayIso}&select=effective_date,iid:metadata->>index_id,val:metadata->>value`, "monthly idx");
      // Month-held: the value of a month applies to every day in it (the freshest ≤ target wins below).
      for (const r of rows) {
        const i = byId.get(r.iid); if (!i) continue; const val = parseFloat(r.val); if (!Number.isFinite(val) || val <= -99) continue;
        const [yy, mo] = r.effective_date.split("-").map(Number);
        const days = new Date(Date.UTC(yy, mo, 0)).getUTCDate();
        const m = ensure(`${i.id}:value`);
        for (let dd = 1; dd <= days; dd++) { const iso = `${yy}-${String(mo).padStart(2, "0")}-${String(dd).padStart(2, "0")}`; if (iso >= winGte && iso <= todayIso) m.set(iso, val); }
      }
    }

    // 4. Assemble + upsert a frame per target day (LUT lookup — no pool scan).
    const frames: any[] = [];
    let anyLive = false, anyRecent = false;
    for (const day of targetDays) {
      const dayDoy = doyOfIso(day);
      const buf = new Uint8Array(manifest.length).fill(255);
      let dayFresh: "live" | "live-yesterday" | "archive" = "archive";
      for (const slot of manifest) {
        const s = series.get(`${slot.inst_id}:${slot.metric}`); if (!s) continue;
        // Day-0: exact target value, else freshest reading ≤ day in the current year.
        let v = s.get(day); let vDate = day;
        if (v === undefined) {
          let best: string | null = null;
          for (const d of s.keys()) if (d <= day && d.slice(0, 4) === String(nowYear) && (best === null || d > best)) best = d;
          if (best !== null) { v = s.get(best); vDate = best; }
        }
        if (v === undefined) continue;
        const lut = lutByKey.get(`${slot.inst_id}:${slot.metric}:${dayDoy}`); if (!lut) continue;
        buf[slot.offset] = byteFromLut(lut, v, slot.side);
        if (vDate === day) dayFresh = "live"; else if (dayFresh !== "live") { const diff = (new Date(day + "T00:00:00Z").getTime() - new Date(vDate + "T00:00:00Z").getTime()) / 86400000; if (diff <= 2) dayFresh = "live-yesterday"; }
      }
      if (dayFresh === "live") anyLive = true; if (dayFresh === "live-yesterday") anyRecent = true;
      frames.push({ day, layout_version: layoutVersion, dots: "\\x" + Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join(""), day0_source: dayFresh });
    }
    await restUpsert(frames);

    const summary = { days: targetDays, layoutVersion, instruments: insts.length, slots: manifest.length, lutRows: lutRows.length, day0: anyLive ? "live" : anyRecent ? "live-yesterday" : "archive" };
    await logCronRun({ functionName: FN, status: "success", summary, durationMs: Date.now() - started });
    return cronResponse({ ok: true, ...summary });
  } catch (err) {
    await logCronRun({ functionName: FN, status: "error", errorMessage: String(err).slice(0, 300), durationMs: Date.now() - started });
    return cronErrorResponse(String(err).slice(0, 300), 500);
  }
});
