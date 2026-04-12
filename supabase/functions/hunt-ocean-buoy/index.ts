import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { scanAndLink } from '../_shared/brainScan.ts';
import { logCronRun } from '../_shared/cronLog.ts';
import { cronResponse, cronErrorResponse } from '../_shared/response.ts';

const FUNCTION_NAME = "hunt-ocean-buoy";

// --- Station definitions ---

interface StationDef {
  id: string;
  state: string;
  region: string;
}

const STATIONS: StationDef[] = [
  // Gulf of Mexico
  { id: "42001", state: "LA", region: "Gulf of Mexico" },
  { id: "42002", state: "LA", region: "Gulf of Mexico" },
  { id: "42003", state: "LA", region: "Gulf of Mexico" },
  { id: "42019", state: "TX", region: "Gulf of Mexico" },
  { id: "42020", state: "TX", region: "Gulf of Mexico" },
  { id: "42035", state: "TX", region: "Gulf of Mexico" },
  { id: "42036", state: "FL", region: "Gulf of Mexico" },
  { id: "42039", state: "FL", region: "Gulf of Mexico" },
  { id: "42040", state: "MS", region: "Gulf of Mexico" },
  // Great Lakes
  { id: "45001", state: "MI", region: "Great Lakes" },
  { id: "45002", state: "MI", region: "Great Lakes" },
  { id: "45003", state: "WI", region: "Great Lakes" },
  { id: "45004", state: "WI", region: "Great Lakes" },
  { id: "45005", state: "OH", region: "Great Lakes" },
  { id: "45006", state: "IL", region: "Great Lakes" },
  { id: "45007", state: "MI", region: "Great Lakes" },
  { id: "45008", state: "MI", region: "Great Lakes" },
  { id: "45012", state: "OH", region: "Great Lakes" },
  // Atlantic
  { id: "41001", state: "NC", region: "Atlantic" },
  { id: "41002", state: "NC", region: "Atlantic" },
  { id: "41004", state: "SC", region: "Atlantic" },
  { id: "41008", state: "GA", region: "Atlantic" },
  { id: "41009", state: "NC", region: "Atlantic" },
  { id: "44009", state: "DE", region: "Atlantic" },
  { id: "44013", state: "MA", region: "Atlantic" },
  { id: "44025", state: "NJ", region: "Atlantic" },
];

// --- Parsing ---

interface BuoyObs {
  date: string;       // ISO date string
  wdir: number | null;  // wind direction degrees
  wspd: number | null;  // wind speed m/s
  gst: number | null;   // gust m/s
  wvht: number | null;  // wave height meters
  dpd: number | null;   // dominant wave period seconds
  pres: number | null;  // pressure hPa
  atmp: number | null;  // air temp C
  wtmp: number | null;  // water temp C
}

function isMissing(val: string): boolean {
  return val === "MM" || val === "999" || val === "999.0" || val === "99.0" || val === "99.00";
}

function parseNum(val: string): number | null {
  if (isMissing(val)) return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function cToF(c: number): number {
  return c * 9 / 5 + 32;
}

function metersToFeet(m: number): number {
  return m * 3.28084;
}

function msToMph(ms: number): number {
  return ms * 2.23694;
}

/**
 * Parse NDBC realtime2 text format.
 * First 2 lines are headers. Returns the most recent observation (first data row).
 */
function parseRealtime2(text: string): BuoyObs | null {
  const lines = text.split("\n");
  if (lines.length < 3) return null;

  // Find first data line (skip header lines starting with # or containing units)
  let dataLine: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;
    // Second header line contains units like "yr mo dy hr mn degT m/s"
    if (i <= 1) continue;
    dataLine = line;
    break;
  }

  if (!dataLine) return null;

  const parts = dataLine.trim().split(/\s+/);
  // Columns: #YY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES ATMP WTMP DEWP VIS PTDY TIDE
  // Index:    0   1  2  3  4   5    6    7   8    9   10  11  12   13   14   15   16  17   18
  if (parts.length < 15) return null;

  const year = parts[0].length === 2 ? `20${parts[0]}` : parts[0];
  const month = parts[1].padStart(2, "0");
  const day = parts[2].padStart(2, "0");
  const hour = parts[3].padStart(2, "0");
  const min = parts[4].padStart(2, "0");
  const date = `${year}-${month}-${day}T${hour}:${min}:00Z`;

  return {
    date,
    wdir: parseNum(parts[5]),
    wspd: parseNum(parts[6]),
    gst: parseNum(parts[7]),
    wvht: parseNum(parts[8]),
    dpd: parseNum(parts[9]),
    pres: parseNum(parts[12]),
    atmp: parseNum(parts[13]),
    wtmp: parseNum(parts[14]),
  };
}

// --- Event flags ---

function buildEventFlags(obs: BuoyObs): string[] {
  const flags: string[] = [];
  if (obs.wvht !== null && metersToFeet(obs.wvht) > 10) {
    flags.push("storm conditions (wave height >10ft)");
  }
  if (obs.pres !== null && obs.pres < 1000) {
    flags.push("low pressure system (<1000mb)");
  }
  return flags;
}

// --- Entry builder ---

interface BuoyEntry {
  text: string;
  station: StationDef;
  obs: BuoyObs;
}

function buildEntry(station: StationDef, obs: BuoyObs): BuoyEntry {
  const sstF = obs.wtmp !== null ? cToF(obs.wtmp).toFixed(1) : "N/A";
  const wvhtFt = obs.wvht !== null ? metersToFeet(obs.wvht).toFixed(1) : "N/A";
  const dpdS = obs.dpd !== null ? obs.dpd.toFixed(1) : "N/A";
  const presMb = obs.pres !== null ? obs.pres.toFixed(1) : "N/A";
  const wspdMph = obs.wspd !== null ? msToMph(obs.wspd).toFixed(1) : "N/A";
  const wdirDeg = obs.wdir !== null ? `${obs.wdir}` : "N/A";
  const atmpF = obs.atmp !== null ? cToF(obs.atmp).toFixed(1) : "N/A";

  const dateStr = obs.date.slice(0, 10);
  const flags = buildEventFlags(obs);
  const flagStr = flags.length > 0 ? " " + flags.join(". ") + "." : "";

  const text = `Ocean buoy ${station.id} (${station.region}) on ${dateStr}: SST ${sstF}\u00B0F, wave height ${wvhtFt}ft, period ${dpdS}s, pressure ${presMb}mb, wind ${wspdMph}mph ${wdirDeg}\u00B0, air temp ${atmpF}\u00B0F.${flagStr}`;

  return { text, station, obs };
}

// --- Main ---

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();
    let totalEmbedded = 0;
    let errors = 0;
    let skipped = 0;

    // Dedup: check if today's data already exists
    const today = new Date().toISOString().slice(0, 10);
    const { count: existingCount } = await supabase
      .from("hunt_knowledge")
      .select("id", { count: "estimated", head: true })
      .eq("content_type", "ocean-buoy")
      .eq("effective_date", today);

    if ((existingCount ?? 0) > 20) {
      const durationMs = Date.now() - startTime;
      console.log(`Already have ${existingCount} ocean-buoy entries for ${today} — skipping`);
      await logCronRun({
        functionName: FUNCTION_NAME,
        status: "success",
        summary: { already_exists: true, existing_count: existingCount, date: today },
        durationMs,
      });
      return cronResponse({ already_exists: true, existing_count: existingCount, durationMs });
    }

    // Process all stations in a single pass
    const entries: BuoyEntry[] = [];

    for (const station of STATIONS) {
        try {
          const url = `https://www.ndbc.noaa.gov/data/realtime2/${station.id}.txt`;
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 8000);
          const res = await fetch(url, { signal: controller.signal });
          clearTimeout(timeout);

          if (res.status >= 400 && res.status < 500) {
            console.warn(`  ${station.id}: HTTP ${res.status} — skipping`);
            skipped++;
            continue;
          }
          if (!res.ok) {
            console.warn(`  ${station.id}: HTTP ${res.status} — 5xx`);
            errors++;
            continue;
          }

          const text = await res.text();
          const obs = parseRealtime2(text);
          if (!obs) {
            console.warn(`  ${station.id}: failed to parse observation`);
            skipped++;
            continue;
          }

          entries.push(buildEntry(station, obs));
          console.log(`  ${station.id} (${station.region}): obs at ${obs.date}`);
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") {
            console.warn(`  ${station.id}: timeout — skipping`);
            skipped++;
          } else {
            console.warn(`  ${station.id}: ${err}`);
            errors++;
          }
        }

        // Small delay between station fetches
        await new Promise(r => setTimeout(r, 50));
      }

    if (entries.length > 0) {
      // Embed all entries
      try {
        const texts = entries.map(e => e.text);
        const embeddings = await batchEmbed(texts);

        const rows = entries.map((e, j) => {
          const dateStr = e.obs.date.slice(0, 10);
          const sstF = e.obs.wtmp !== null ? parseFloat(cToF(e.obs.wtmp).toFixed(1)) : null;
          const wvhtFt = e.obs.wvht !== null ? parseFloat(metersToFeet(e.obs.wvht).toFixed(1)) : null;
          const wspdMph = e.obs.wspd !== null ? parseFloat(msToMph(e.obs.wspd).toFixed(1)) : null;
          const flags = buildEventFlags(e.obs);

          return {
            title: `ocean-buoy ${e.station.id} ${dateStr}`,
            content: e.text,
            content_type: "ocean-buoy",
            tags: [e.station.state, "ocean", "buoy", "sst", "waves", e.station.region.toLowerCase().replace(/ /g, "-")],
            state_abbr: e.station.state,
            species: null,
            effective_date: dateStr,
            metadata: {
              source: "noaa-ndbc",
              station_id: e.station.id,
              region: e.station.region,
              obs_time: e.obs.date,
              sst_f: sstF,
              sst_c: e.obs.wtmp,
              wave_height_ft: wvhtFt,
              wave_height_m: e.obs.wvht,
              wave_period_s: e.obs.dpd,
              pressure_mb: e.obs.pres,
              wind_speed_mph: wspdMph,
              wind_speed_ms: e.obs.wspd,
              wind_dir_deg: e.obs.wdir,
              air_temp_f: e.obs.atmp !== null ? parseFloat(cToF(e.obs.atmp).toFixed(1)) : null,
              air_temp_c: e.obs.atmp,
              gust_ms: e.obs.gst,
              event_flags: flags,
            },
            embedding: embeddings[j],
          };
        });

        const { data: inserted, error: insertError } = await supabase
          .from("hunt_knowledge")
          .insert(rows)
          .select('id');

        if (insertError) {
          console.error(`  Insert error: ${insertError.message}`);
          errors++;
        } else {
          totalEmbedded += rows.length;

          // Fire-and-forget scan+link for every inserted entry (writes hunt_pattern_links)
          if (inserted && inserted.length === rows.length) {
            for (let k = 0; k < inserted.length; k++) {
              scanAndLink(inserted[k].id, embeddings[k], {
                state_abbr: entries[k].station.state,
                source_content_type: "ocean-buoy",
              }).catch(() => {});
            }
          }
        }
      } catch (err) {
        console.error(`  Embed/upsert batch error: ${err}`);
        errors++;
      }
    }

    const durationMs = Date.now() - startTime;
    const status = errors > 0 ? "partial" : "success";

    await logCronRun({
      functionName: FUNCTION_NAME,
      status,
      summary: {
        stations_total: STATIONS.length,
        embedded: totalEmbedded,
        skipped,
        errors,
      },
      durationMs,
    });

    return cronResponse({ embedded: totalEmbedded, skipped, errors, durationMs });

  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error("Fatal:", err);
    await logCronRun({
      functionName: FUNCTION_NAME,
      status: "error",
      errorMessage: String(err),
      durationMs,
    });
    return cronErrorResponse(String(err), 500);
  }
});
