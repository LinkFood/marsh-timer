/**
 * verify-engine.ts — acceptance harness for the film engine core (spine rungs 2a/2b).
 *
 * Proves the shared projector and the direction-aware tail-depth math reproduce
 * Rung 1's hand-baked numbers BEFORE the generalized baker is built on top of them.
 * Reads only local cache (scripts/board/.uri-cache) + public/board/uri-2021.json —
 * no network, no DB. Exits non-zero on any parity failure.
 *
 * Usage: npx tsx scripts/board/verify-engine.ts
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { project, WIDTH, HEIGHT } from "./projection.ts";
import { tailDepth, poolForDay, doyOffset } from "./tailDepth.ts";

const DIR = dirname(fileURLToPath(import.meta.url));
const CACHE = join(DIR, ".uri-cache");
const URI = JSON.parse(readFileSync(join(DIR, "..", "..", "public", "board", "uri-2021.json"), "utf-8"));

let fails = 0;
const ok = (cond: boolean, label: string, detail = "") => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) fails++;
};
const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

// ── Projection (spine §1.3) ────────────────────────────────────────────────────
console.log(`\nPROJECTION (canonical ${WIDTH}×${HEIGHT}, proj_version 1)`);
{
  const tx = project(31.054, -97.563);
  ok(near(tx.x, 461.1, 0.05) && near(tx.y, 442.9, 0.05), "TX centroid = (461.1, 442.9)", `got (${tx.x}, ${tx.y})`);

  // Uri's coastal instruments must land where uri-2021.json placed them (≤0.1px).
  const coastal: [string, number, number][] = [
    ["b42035", 29.2, -94.4],       // Galveston buoy
    ["t8761724", 29.2633, -89.9567], // Grand Isle tide
    ["t8747437", 30.3264, -89.3258], // Bay Waveland tide
  ];
  for (const [id, lat, lng] of coastal) {
    const p = project(lat, lng);
    const dot = URI.dots.find((d: any) => d.id === id);
    ok(near(p.x, dot.x, 0.1) && near(p.y, dot.y, 0.1), `${id} matches uri-2021.json`, `engine (${p.x},${p.y}) vs baked (${dot.x},${dot.y})`);
  }
}

// ── Tail-depth: state parity, EXACT (same doy±10 pool as bake-uri) ─────────────
console.log(`\nTAIL-DEPTH — state parity (exact, doy±10)`);
{
  const band: { date: string; v: number }[] = JSON.parse(readFileSync(join(CACHE, "ghcn-TX.json"), "utf-8"));
  const series = new Map<string, number>();
  for (const r of band) series.set(r.date, r.v);
  const day = "2021-02-15";
  const { pool, years } = poolForDay(series, day, 10);
  const lowSlot = tailDepth(21.4, pool, "low", years);
  const twoSided = tailDepth(21.4, pool, "two-sided", years);
  const baked = URI.dots.find((d: any) => d.id === "tx").series[day].pct;
  console.log(`    TX ${day}: v=21.4, pool n=${pool.length}, years=${years}`);
  ok(lowSlot.pct === baked, `low-slot pct = baked ${baked}`, `got ${lowSlot.pct}`);
  ok(twoSided.pct === baked && twoSided.won === "low", `two-sided picks cold tail = ${baked}`, `got ${twoSided.pct} (won ${twoSided.won})`);
}

// ── AO: does the spine's doy±N reproduce Rung 1's whole-season DJF pool? ───────
console.log(`\nTAIL-DEPTH — AO needle: spine doy±15 vs Rung 1 whole-DJF (§2.2 claim)`);
{
  const raw: string = JSON.parse(readFileSync(join(CACHE, "ao.txt"), "utf-8"));
  const aoAll = new Map<string, number>();
  for (const line of raw.split("\n")) {
    const p = line.trim().split(/\s+/);
    if (p.length < 4) continue;
    const [y, mo, d, v] = p;
    const val = parseFloat(v);
    if (Number.isFinite(val)) aoAll.set(`${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`, val);
  }
  const CUTOFF = "2021-02-28"; // bake-uri capped the pool here
  const day = "2021-02-10";
  const v = URI.dots.find((d: any) => d.id === "ao").series[day].v; // -5.28
  const baked = URI.dots.find((d: any) => d.id === "ao").series[day].pct; // 0.997

  // Spine method: doy±15, all years up to cutoff.
  const capped = new Map<string, number>();
  for (const [d, val] of aoAll) if (d <= CUTOFF) capped.set(d, val);
  const { pool: poolDoy, years: yDoy } = poolForDay(capped, day, 15);
  const doy = tailDepth(v, poolDoy, "two-sided", yDoy);

  // Rung 1 method: whole DJF pool (mo 12/1/2), coldPct — reproduced inline.
  const djf: number[] = [];
  for (const [d, val] of capped) {
    const mo = Number(d.split("-")[1]);
    if (mo === 12 || mo === 1 || mo === 2) djf.push(val);
  }
  let below = 0; for (const p of djf) if (p < v) below++;
  const djfPct = Math.round((1 - below / djf.length) * 1000) / 1000;

  console.log(`    AO ${day}: v=${v}, baked(DJF)=${baked}`);
  console.log(`    doy±15 pool n=${poolDoy.length} (${yDoy}y) → pct ${doy.pct} (won ${doy.won})`);
  console.log(`    whole-DJF pool n=${djf.length} → pct ${djfPct}`);
  ok(near(djfPct, baked, 0.001), `DJF method reproduces baked ${baked}`, `got ${djfPct}`);
  const within = doy.pct !== null && near(doy.pct, baked, 0.005);
  ok(within, `spine doy±15 reproduces Rung 1 within ±0.005`, `Δ=${doy.pct === null ? "null" : Math.abs(doy.pct - baked).toFixed(4)} — ${within ? "spine §2.2 holds" : "FLAG: doc claim needs revisit"}`);
}

console.log(`\n${fails ? "✗" : "✓"} engine core — ${fails} failure(s)\n`);
process.exit(fails ? 1 : 0);
