import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';
// Pattern linking done by hunt-pattern-link-worker cron
import { logCronRun } from '../_shared/cronLog.ts';
import { cronResponse, cronErrorResponse } from '../_shared/response.ts';

const FUNCTION_NAME = "hunt-space-weather";

const ENDPOINTS = {
  plasma: "https://services.swpc.noaa.gov/products/solar-wind/plasma-7-day.json",
  mag: "https://services.swpc.noaa.gov/products/solar-wind/mag-7-day.json",
  kp: "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json",
  xray: "https://services.swpc.noaa.gov/json/goes/primary/xrays-7-day.json",
};

interface DailySummary {
  date: string;
  avgSpeed: number;
  maxSpeed: number;
  avgDensity: number;
  maxKp: number;
  avgBz: number;
  minBz: number;
  xrayMaxFlux: number;
  xrayClass: string;
  stormLevel: string;
  flags: string[];
}

function classifyXray(flux: number): string {
  if (flux >= 1e-4) return "X";
  if (flux >= 1e-5) return "M";
  if (flux >= 1e-6) return "C";
  if (flux >= 1e-7) return "B";
  return "A";
}

function classifyStormLevel(kp: number): string {
  if (kp >= 9) return "G5 extreme";
  if (kp >= 8) return "G4 severe";
  if (kp >= 7) return "G3 strong";
  if (kp >= 6) return "G2 moderate";
  if (kp >= 5) return "G1 minor";
  return "quiet";
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  const res = await fetch(url, { signal: controller.signal });
  clearTimeout(timeout);

  if (!res.ok) {
    if (res.status >= 400 && res.status < 500) {
      throw new Error(`SWPC ${url} returned ${res.status} (4xx, not retryable)`);
    }
    throw new Error(`SWPC ${url} returned ${res.status}`);
  }

  // Wrap JSON parse — NOAA SWPC sometimes returns truncated JSON during outages
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (parseErr) {
    throw new Error(`SWPC ${url} returned malformed JSON (${text.length} chars): ${parseErr instanceof Error ? parseErr.message : 'parse error'}`);
  }
}

function getDateKey(timeTag: string | undefined | null): string {
  if (!timeTag || typeof timeTag !== "string") return "";
  return timeTag.substring(0, 10);
}

function todayUTC(): string {
  return new Date().toISOString().substring(0, 10);
}

function aggregateDailySummary(
  date: string,
  plasmaByDate: Map<string, Array<{ speed: number; density: number }>>,
  magByDate: Map<string, Array<{ bz: number }>>,
  kpByDate: Map<string, number[]>,
  xrayByDate: Map<string, number[]>,
): DailySummary {
  const plasma = plasmaByDate.get(date) || [];
  const mag = magByDate.get(date) || [];
  const kps = kpByDate.get(date) || [];
  const xrays = xrayByDate.get(date) || [];

  const speeds = plasma.map(p => p.speed).filter(v => v > 0);
  const densities = plasma.map(p => p.density).filter(v => v > 0);
  const bzValues = mag.map(m => m.bz).filter(v => !isNaN(v));
  const validKps = kps.filter(v => v >= 0);
  const validXrays = xrays.filter(v => v > 0);

  const avgSpeed = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
  const maxSpeed = speeds.length > 0 ? Math.max(...speeds) : 0;
  const avgDensity = densities.length > 0 ? densities.reduce((a, b) => a + b, 0) / densities.length : 0;
  const maxKp = validKps.length > 0 ? Math.max(...validKps) : 0;
  const avgBz = bzValues.length > 0 ? bzValues.reduce((a, b) => a + b, 0) / bzValues.length : 0;
  const minBz = bzValues.length > 0 ? Math.min(...bzValues) : 0;
  const xrayMaxFlux = validXrays.length > 0 ? Math.max(...validXrays) : 0;
  const xrayClass = classifyXray(xrayMaxFlux);
  const stormLevel = classifyStormLevel(maxKp);

  const flags: string[] = [];
  if (maxSpeed > 800) flags.push("storm-level solar wind (>800 km/s)");
  else if (maxSpeed > 600) flags.push("elevated solar wind (>600 km/s)");
  if (maxKp >= 5) flags.push(`geomagnetic storm (Kp=${maxKp}, ${stormLevel})`);
  if (minBz < -10) flags.push(`strong southward IMF (Bz=${minBz.toFixed(1)} nT, geomagnetically active)`);

  return {
    date,
    avgSpeed: Math.round(avgSpeed),
    maxSpeed: Math.round(maxSpeed),
    avgDensity: parseFloat(avgDensity.toFixed(1)),
    maxKp,
    avgBz: parseFloat(avgBz.toFixed(1)),
    minBz: parseFloat(minBz.toFixed(1)),
    xrayMaxFlux,
    xrayClass,
    stormLevel,
    flags,
  };
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();
    const today = todayUTC();

    // Dedup: check if today's summary already exists (uses compound index on content_type + created_at)
    const { data: existing } = await supabase
      .from("hunt_knowledge")
      .select("id")
      .eq("content_type", "space-weather")
      .eq("effective_date", today)
      .limit(1);

    if (existing && existing.length > 0) {
      const durationMs = Date.now() - startTime;
      console.log(`Space weather for ${today} already exists, skipping.`);
      await logCronRun({
        functionName: FUNCTION_NAME,
        status: "success",
        summary: { skipped: true, reason: "already_exists", date: today },
        durationMs,
      });
      return cronResponse({ ok: true, skipped: true, date: today, durationMs });
    }

    // Fetch all 4 endpoints in parallel
    console.log("Fetching SWPC data...");
    const [plasmaRaw, magRaw, kpRaw, xrayRaw] = await Promise.all([
      fetchJson(ENDPOINTS.plasma),
      fetchJson(ENDPOINTS.mag),
      fetchJson(ENDPOINTS.kp),
      fetchJson(ENDPOINTS.xray),
    ]);

    // Parse plasma: array of arrays, first row is headers — only today's data
    const plasmaByDate = new Map<string, Array<{ speed: number; density: number }>>();
    const plasmaArr = plasmaRaw as string[][];
    for (let i = 1; i < plasmaArr.length; i++) {
      const row = plasmaArr[i];
      if (!row || row.length < 3) continue;
      const dateKey = getDateKey(row[0]);
      if (dateKey !== today) continue;
      const density = parseFloat(row[1]);
      const speed = parseFloat(row[2]);
      if (isNaN(density) && isNaN(speed)) continue;
      if (!plasmaByDate.has(dateKey)) plasmaByDate.set(dateKey, []);
      plasmaByDate.get(dateKey)!.push({ speed: speed || 0, density: density || 0 });
    }

    // Parse mag: array of arrays, first row is headers — only today's data
    const magByDate = new Map<string, Array<{ bz: number }>>();
    const magArr = magRaw as string[][];
    for (let i = 1; i < magArr.length; i++) {
      const row = magArr[i];
      if (!row || row.length < 4) continue;
      const dateKey = getDateKey(row[0]);
      if (dateKey !== today) continue;
      const bz = parseFloat(row[3]); // bz_gsm is column index 3
      if (isNaN(bz)) continue;
      if (!magByDate.has(dateKey)) magByDate.set(dateKey, []);
      magByDate.get(dateKey)!.push({ bz });
    }

    // Parse Kp: array of objects with time_tag and Kp fields
    const kpByDate = new Map<string, number[]>();
    const kpArr = kpRaw as Array<{ time_tag?: string; Kp?: number | string; [k: string]: unknown }>;
    if (Array.isArray(kpArr)) {
      for (const entry of kpArr) {
        if (!entry.time_tag) continue;
        const dateKey = getDateKey(entry.time_tag);
        if (dateKey !== today) continue;
        const kp = typeof entry.Kp === "number" ? entry.Kp : parseFloat(String(entry.Kp || ""));
        if (isNaN(kp)) continue;
        if (!kpByDate.has(dateKey)) kpByDate.set(dateKey, []);
        kpByDate.get(dateKey)!.push(kp);
      }
    }

    // Parse X-ray: array of objects with time_tag and flux — only today's data
    const xrayByDate = new Map<string, number[]>();
    const xrayArr = xrayRaw as Array<{ time_tag: string; flux?: number; [k: string]: unknown }>;
    if (Array.isArray(xrayArr)) {
      for (const entry of xrayArr) {
        if (!entry.time_tag) continue;
        const dateKey = getDateKey(entry.time_tag);
        if (dateKey !== today) continue;
        const flux = typeof entry.flux === "number" ? entry.flux : parseFloat(String(entry.flux || "0"));
        if (isNaN(flux) || flux <= 0) continue;
        if (!xrayByDate.has(dateKey)) xrayByDate.set(dateKey, []);
        xrayByDate.get(dateKey)!.push(flux);
      }
    }

    // Aggregate today's data
    const summary = aggregateDailySummary(today, plasmaByDate, magByDate, kpByDate, xrayByDate);

    const summaryParts: string[] = [];
    if (summary.flags.length > 0) {
      summaryParts.push(summary.flags.join("; "));
    } else {
      summaryParts.push("Conditions nominal");
    }

    const embeddingText = [
      `Space weather ${summary.date}:`,
      `solar wind ${summary.avgSpeed} km/s avg, ${summary.maxSpeed} km/s max`,
      `(density ${summary.avgDensity}/cm³),`,
      `Kp index ${summary.maxKp} (${summary.stormLevel}),`,
      `X-ray flux ${summary.xrayMaxFlux.toExponential(1)} (${summary.xrayClass}-class),`,
      `Bz ${summary.avgBz} nT avg, ${summary.minBz} nT min.`,
      summaryParts.join(" "),
    ].join(" ");

    console.log(`Embedding: ${embeddingText}`);

    const embeddings = await batchEmbed([embeddingText]);
    const embedding = embeddings[0];

    // Insert into hunt_knowledge (dedup check above prevents duplicates)
    const { error: insertError } = await supabase
      .from("hunt_knowledge")
      .insert({
        title: `space-weather ${summary.date}`,
        content: embeddingText,
        content_type: "space-weather",
        tags: ["space-weather", "solar-wind", "geomagnetic", "kp-index", "x-ray-flux", "swpc"],
        species: null,
        state_abbr: null,
        effective_date: summary.date,
        metadata: {
          source: "noaa-swpc",
          date: summary.date,
          solar_wind_avg_speed: summary.avgSpeed,
          solar_wind_max_speed: summary.maxSpeed,
          solar_wind_avg_density: summary.avgDensity,
          max_kp: summary.maxKp,
          storm_level: summary.stormLevel,
          avg_bz: summary.avgBz,
          min_bz: summary.minBz,
          xray_max_flux: summary.xrayMaxFlux,
          xray_class: summary.xrayClass,
          flags: summary.flags,
        },
        embedding,
      });

    if (insertError) {
      throw new Error(`hunt_knowledge insert failed: ${insertError.message}`);
    }

    console.log(`Stored space weather for ${today}`);

    // Pattern linking done by hunt-pattern-link-worker cron

    const durationMs = Date.now() - startTime;
    await logCronRun({
      functionName: FUNCTION_NAME,
      status: "success",
      summary: {
        date: today,
        solar_wind_avg: summary.avgSpeed,
        solar_wind_max: summary.maxSpeed,
        max_kp: summary.maxKp,
        storm_level: summary.stormLevel,
        xray_class: summary.xrayClass,
        flags: summary.flags,
      },
      durationMs,
    });

    return cronResponse({
      ok: true,
      date: today,
      summary: {
        solar_wind_avg: summary.avgSpeed,
        solar_wind_max: summary.maxSpeed,
        density: summary.avgDensity,
        max_kp: summary.maxKp,
        storm_level: summary.stormLevel,
        bz_avg: summary.avgBz,
        bz_min: summary.minBz,
        xray_class: summary.xrayClass,
        flags: summary.flags,
      },
      durationMs,
    });

  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error("Fatal:", err);
    await logCronRun({
      functionName: FUNCTION_NAME,
      status: "error",
      errorMessage: String(err),
      durationMs,
    });
    return cronErrorResponse(String(err));
  }
});
