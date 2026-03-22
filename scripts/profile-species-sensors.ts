/**
 * Species-as-sensor profiler
 * Analyzes which bird species are the best leading indicators for which
 * environmental events by comparing bird entries against environmental entries
 * in the same state and ±3 day time window.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/profile-species-sensors.ts
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY!;

if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }
if (!VOYAGE_KEY) { console.error("VOYAGE_API_KEY required"); process.exit(1); }

const MAX_BIRD_ENTRIES = 2000;
const BATCH_SIZE = 100;
const MIN_CORRELATION_PCT = 10;
const MIN_PAIR_COUNT = 5;

// ---------------------------------------------------------------------------
// Content type filters
// ---------------------------------------------------------------------------

const BIRD_TYPES = [
  "birdweather-daily", "birdweather-acoustic", "birdcast-daily",
  "migration-spike-extreme", "migration-spike-significant", "migration-spike-moderate",
];

const ENV_TYPES = [
  "weather-event", "weather-realtime", "nws-alert", "usgs-water",
  "drought-weekly", "fire-activity", "storm-event", "earthquake-event", "climate-index",
];

// ---------------------------------------------------------------------------
// Voyage AI batch embedding (direct, 20 at a time)
// ---------------------------------------------------------------------------

async function embedBatch(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += 20) {
    const chunk = texts.slice(i, i + 20);
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VOYAGE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "voyage-3-lite",
        input: chunk,
        input_type: "document",
      }),
    });
    if (!res.ok) throw new Error(`Voyage ${res.status}: ${await res.text()}`);
    const data = await res.json();
    for (const item of data.data) results.push(item.embedding);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Upsert batch into hunt_knowledge via REST API
// ---------------------------------------------------------------------------

async function upsertBatch(
  entries: Array<{ text: string; meta: Record<string, any> }>
): Promise<number> {
  if (entries.length === 0) return 0;

  const texts = entries.map((e) => e.text);
  const embeddings = await embedBatch(texts);
  const rows = entries.map((e, i) => ({
    ...e.meta,
    embedding: JSON.stringify(embeddings[i]),
  }));

  let upserted = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      console.error(`  Upsert error: ${res.status} ${await res.text()}`);
    } else {
      upserted += chunk.length;
    }
  }
  return upserted;
}

// ---------------------------------------------------------------------------
// Fetch bird entries via REST API
// ---------------------------------------------------------------------------

async function fetchBirdBatch(offset: number, limit: number): Promise<any[]> {
  const typeFilter = BIRD_TYPES.map((t) => `content_type.eq.${t}`).join(",");
  const url = `${SUPABASE_URL}/rest/v1/hunt_knowledge?select=id,title,content,content_type,state_abbr,effective_date,metadata&or=(${typeFilter})&state_abbr=not.is.null&effective_date=not.is.null&order=created_at.asc&offset=${offset}&limit=${limit}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
    },
  });
  if (!res.ok) {
    console.error(`  Bird fetch error: ${res.status} ${await res.text()}`);
    return [];
  }
  return await res.json();
}

// ---------------------------------------------------------------------------
// Fetch environmental events in same state within ±3 days via REST API
// ---------------------------------------------------------------------------

async function fetchEnvEvents(stateAbbr: string, dateFrom: string, dateTo: string): Promise<any[]> {
  const typeFilter = ENV_TYPES.map((t) => `content_type.eq.${t}`).join(",");
  const url = `${SUPABASE_URL}/rest/v1/hunt_knowledge?select=id,title,content_type,effective_date,state_abbr,metadata&or=(${typeFilter})&state_abbr=eq.${stateAbbr}&effective_date=gte.${dateFrom}&effective_date=lte.${dateTo}&limit=50`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
    },
  });
  if (!res.ok) return [];
  return await res.json();
}

// ---------------------------------------------------------------------------
// Extract species name from bird entry
// ---------------------------------------------------------------------------

function extractSpecies(entry: any): string {
  // Try metadata fields first
  if (entry.metadata?.species_name) return entry.metadata.species_name.toLowerCase();
  if (entry.metadata?.species) return entry.metadata.species.toLowerCase();
  if (entry.metadata?.common_name) return entry.metadata.common_name.toLowerCase();

  // Try parsing from title (e.g. "BirdWeather: Mallard — AR 2025-01-15")
  const titleMatch = entry.title?.match(/^(?:BirdWeather|BirdCast|Migration\s+\w+):\s*(.+?)(?:\s*[—–\-]\s|\s+\d)/i);
  if (titleMatch) return titleMatch[1].trim().toLowerCase();

  return "unknown";
}

// ---------------------------------------------------------------------------
// Map species name to hunt_knowledge species column value
// ---------------------------------------------------------------------------

function mapSpeciesColumn(speciesName: string): string {
  const name = speciesName.toLowerCase();
  if (name.includes("duck") || name.includes("mallard") || name.includes("teal") ||
      name.includes("pintail") || name.includes("wigeon") || name.includes("shoveler") ||
      name.includes("gadwall") || name.includes("canvasback") || name.includes("redhead") ||
      name.includes("scaup") || name.includes("bufflehead") || name.includes("merganser") ||
      name.includes("scoter") || name.includes("eider") || name.includes("goldeneye") ||
      name.includes("wood duck") || name.includes("ring-necked") || name.includes("ruddy")) {
    return "duck";
  }
  if (name.includes("goose") || name.includes("geese") || name.includes("brant")) return "goose";
  if (name.includes("turkey")) return "turkey";
  if (name.includes("deer")) return "deer";
  if (name.includes("dove") || name.includes("pigeon")) return "dove";
  return "duck"; // default for waterfowl-heavy dataset
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CorrelationData {
  count: number;
  leadTimes: number[];
  states: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("[profiler] Species-as-Sensor Profiler starting");
  console.log(`[profiler] Max bird entries: ${MAX_BIRD_ENTRIES}`);
  console.log(`[profiler] Bird types: ${BIRD_TYPES.join(", ")}`);
  console.log(`[profiler] Env types: ${ENV_TYPES.join(", ")}`);
  console.log("---");

  // -------------------------------------------------------------------------
  // Phase 1: Fetch bird entries
  // -------------------------------------------------------------------------

  console.log("[phase 1] Fetching bird entries...");
  const allBirdEntries: any[] = [];
  let offset = 0;

  while (allBirdEntries.length < MAX_BIRD_ENTRIES) {
    const remaining = MAX_BIRD_ENTRIES - allBirdEntries.length;
    const limit = Math.min(BATCH_SIZE, remaining);
    const batch = await fetchBirdBatch(offset, limit);
    if (batch.length === 0) break;
    allBirdEntries.push(...batch);
    offset += batch.length;
    console.log(`  Fetched ${allBirdEntries.length} bird entries so far...`);
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`[phase 1] Total bird entries: ${allBirdEntries.length}`);

  // -------------------------------------------------------------------------
  // Phase 2: Group by species, query env events, build correlations
  // -------------------------------------------------------------------------

  console.log("[phase 2] Grouping by species and querying env events...");

  // Group by species
  const speciesGroups: Record<string, any[]> = {};
  for (const entry of allBirdEntries) {
    const species = extractSpecies(entry);
    if (!speciesGroups[species]) speciesGroups[species] = [];
    speciesGroups[species].push(entry);
  }

  const speciesList = Object.keys(speciesGroups);
  console.log(`  Found ${speciesList.length} unique species: ${speciesList.slice(0, 20).join(", ")}${speciesList.length > 20 ? "..." : ""}`);

  // For each species, build env correlations
  const speciesCorrelations: Record<string, Record<string, CorrelationData>> = {};
  const speciesTotalEntries: Record<string, number> = {};
  let queriesRun = 0;

  for (const [species, entries] of Object.entries(speciesGroups)) {
    speciesTotalEntries[species] = entries.length;
    const envCorrelations: Record<string, CorrelationData> = {};

    for (const bird of entries) {
      const dateObj = new Date(bird.effective_date);
      const dateFrom = new Date(dateObj.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const dateTo = new Date(dateObj.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

      const envEvents = await fetchEnvEvents(bird.state_abbr, dateFrom, dateTo);
      queriesRun++;

      for (const env of envEvents) {
        const type = env.content_type;
        if (!envCorrelations[type]) envCorrelations[type] = { count: 0, leadTimes: [], states: {} };
        envCorrelations[type].count++;

        // Calculate lead time: positive = bird came before env event (predictive)
        const birdDate = new Date(bird.effective_date);
        const envDate = new Date(env.effective_date);
        const leadHours = (envDate.getTime() - birdDate.getTime()) / (1000 * 60 * 60);
        envCorrelations[type].leadTimes.push(leadHours);

        // Track state distribution
        const st = bird.state_abbr;
        envCorrelations[type].states[st] = (envCorrelations[type].states[st] || 0) + 1;
      }

      // Checkpoint
      if (queriesRun % 100 === 0) {
        console.log(`  [checkpoint] ${queriesRun} env queries run, processing species: ${species}`);
      }

      // Small delay to not hammer Supabase
      await new Promise((r) => setTimeout(r, 100));
    }

    speciesCorrelations[species] = envCorrelations;
  }

  console.log(`[phase 2] Complete. ${queriesRun} env queries run across ${speciesList.length} species.`);

  // -------------------------------------------------------------------------
  // Phase 3: Generate sensor profiles and embed
  // -------------------------------------------------------------------------

  console.log("[phase 3] Generating sensor profiles...");

  const today = new Date().toISOString().split("T")[0];
  const profilesToInsert: Array<{ text: string; meta: Record<string, any> }> = [];
  let profilesGenerated = 0;
  let profilesSkipped = 0;

  for (const [species, envCorrelations] of Object.entries(speciesCorrelations)) {
    const totalEntries = speciesTotalEntries[species];

    for (const [envType, data] of Object.entries(envCorrelations)) {
      const pct = Math.round((data.count / totalEntries) * 100);
      if (pct < MIN_CORRELATION_PCT || data.count < MIN_PAIR_COUNT) {
        profilesSkipped++;
        continue;
      }

      const avgLead = Math.round(data.leadTimes.reduce((a, b) => a + b, 0) / data.leadTimes.length * 10) / 10;

      // Top states by count
      const sortedStates = Object.entries(data.states)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5);
      const topStatesStr = sortedStates
        .map(([st, cnt]) => `${st} (${Math.round((cnt / data.count) * 100)}%)`)
        .join(", ");
      const topStatesArr = sortedStates.map(([st]) => st);

      const confidence = data.count > 50 ? "high" : data.count > 20 ? "medium" : "low";

      // Lead time interpretation
      let leadInterpretation: string;
      if (avgLead > 0) {
        leadInterpretation = `${species} signal precedes ${envType} by ~${Math.abs(avgLead)} hours on average`;
      } else if (avgLead < 0) {
        leadInterpretation = `${envType} precedes ${species} signal by ~${Math.abs(avgLead)} hours on average`;
      } else {
        leadInterpretation = `${species} signal and ${envType} occur simultaneously on average`;
      }

      const profileText = [
        `sensor-profile | ${species} | correlates with ${envType} | strength:${pct}% | avg lead:${avgLead}h | based on ${data.count} pairs`,
        ``,
        `Sensor Profile: ${species} → ${envType}`,
        `Correlation: ${pct}% of ${species} signals have a ${envType} within ±72 hours in the same state`,
        `Average lead time: ${avgLead > 0 ? "+" : ""}${avgLead} hours (${leadInterpretation})`,
        `Sample size: ${data.count} pairs from ${totalEntries} ${species} entries`,
        `Confidence: ${confidence}`,
        `Top states: ${topStatesStr}`,
      ].join("\n");

      profilesToInsert.push({
        text: profileText,
        meta: {
          title: `Sensor Profile: ${species} → ${envType}`,
          content: profileText,
          content_type: "sensor-profile",
          state_abbr: null, // national profile
          species: mapSpeciesColumn(species),
          effective_date: today,
          tags: ["sensor-profile", species, envType, "correlation"],
          metadata: {
            source: "species-sensor-profiler",
            species_name: species,
            env_type: envType,
            correlation_strength: pct,
            avg_lead_hours: avgLead,
            sample_size: data.count,
            total_bird_entries: totalEntries,
            confidence,
            top_states: topStatesArr,
            lead_interpretation: leadInterpretation,
          },
        },
      });

      profilesGenerated++;
    }
  }

  console.log(`[phase 3] Generated ${profilesGenerated} profiles, skipped ${profilesSkipped} weak correlations`);

  // -------------------------------------------------------------------------
  // Phase 4: Embed and insert
  // -------------------------------------------------------------------------

  console.log("[phase 4] Embedding and inserting profiles...");

  let totalEmbedded = 0;
  let totalErrors = 0;

  for (let i = 0; i < profilesToInsert.length; i += 20) {
    const batch = profilesToInsert.slice(i, i + 20);
    try {
      const n = await upsertBatch(batch);
      totalEmbedded += n;
      console.log(`  Embedded ${totalEmbedded}/${profilesToInsert.length}`);
    } catch (err) {
      console.error(`  Embed/upsert error:`, err);
      totalErrors++;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------

  console.log("\n===== COMPLETE =====");
  console.log(`Bird entries analyzed: ${allBirdEntries.length}`);
  console.log(`Unique species:       ${speciesList.length}`);
  console.log(`Env queries run:      ${queriesRun}`);
  console.log(`Profiles generated:   ${profilesGenerated}`);
  console.log(`Profiles embedded:    ${totalEmbedded}`);
  console.log(`Profiles skipped:     ${profilesSkipped} (weak)`);
  console.log(`Errors:               ${totalErrors}`);

  // Print top findings
  if (profilesGenerated > 0) {
    console.log("\n----- TOP SENSOR PROFILES -----");
    const sorted = profilesToInsert
      .sort((a, b) => (b.meta.metadata.correlation_strength as number) - (a.meta.metadata.correlation_strength as number))
      .slice(0, 10);
    for (const p of sorted) {
      const m = p.meta.metadata;
      const leadStr = m.avg_lead_hours > 0 ? `leads by ${m.avg_lead_hours}h` : `lags by ${Math.abs(m.avg_lead_hours)}h`;
      console.log(`  ${m.species_name} → ${m.env_type}: ${m.correlation_strength}% (${m.sample_size} pairs, ${leadStr}, ${m.confidence})`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
