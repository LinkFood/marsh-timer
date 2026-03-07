/**
 * Extract weather-migration patterns using Claude Sonnet, then embed via Voyage AI
 * Joins hunt_migration_history + hunt_weather_history, feeds to Sonnet for pattern extraction
 *
 * Prerequisites: Run backfill-weather-history.ts and backfill-ebird-history.ts first
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ANTHROPIC_API_KEY=... npx tsx scripts/extract-patterns.ts
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;

if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }
if (!ANTHROPIC_KEY) { console.error("ANTHROPIC_API_KEY required"); process.exit(1); }

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY,
  "Content-Type": "application/json",
};

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

const STATE_NAMES: Record<string, string> = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",
  CO:"Colorado",CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",
  HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",
  KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",
  MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",
  MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",
  NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",
  OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",
  SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",
  VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",
};

async function fetchJoinedData(stateAbbr: string): Promise<{ withMigration: any[]; weatherOnly: any[] }> {
  // Fetch migration data
  const migRes = await fetch(
    `${SUPABASE_URL}/rest/v1/hunt_migration_history?state_abbr=eq.${stateAbbr}&species=eq.duck&select=date,sighting_count,location_count&order=date`,
    { headers: supaHeaders },
  );
  const migData = migRes.ok ? await migRes.json() : [];

  // Fetch weather
  const wxRes = await fetch(
    `${SUPABASE_URL}/rest/v1/hunt_weather_history?state_abbr=eq.${stateAbbr}&select=date,temp_high_f,temp_low_f,temp_avg_f,wind_speed_avg_mph,wind_speed_max_mph,wind_direction_dominant,pressure_avg_msl,pressure_change_12h,precipitation_total_mm,cloud_cover_avg&order=date&limit=1000`,
    { headers: supaHeaders },
  );
  const wxData = wxRes.ok ? await wxRes.json() : [];

  if (migData.length > 0) {
    // Join mode
    const wxMap = new Map(wxData.map((w: any) => [w.date, w]));
    const joined = migData
      .filter((m: any) => wxMap.has(m.date))
      .map((m: any) => ({ ...m, weather: wxMap.get(m.date) }));
    return { withMigration: joined, weatherOnly: [] };
  }

  // Weather-only mode
  return { withMigration: [], weatherOnly: wxData };
}

function formatDataForClaude(stateName: string, data: { withMigration: any[]; weatherOnly: any[] }): string {
  if (data.withMigration.length > 0) {
    const sample = data.withMigration.length > 200
      ? data.withMigration.filter((_, i) => i % Math.ceil(data.withMigration.length / 200) === 0)
      : data.withMigration;

    const rows = sample.map((d) => {
      const w = d.weather;
      return `${d.date}: ${d.sighting_count} sightings at ${d.location_count} locations | ${w.temp_avg_f}F (${w.temp_low_f}-${w.temp_high_f}) | wind ${w.wind_speed_avg_mph}mph max ${w.wind_speed_max_mph}mph dir ${w.wind_direction_dominant} | pressure ${w.pressure_avg_msl}mb change ${w.pressure_change_12h}mb | precip ${w.precipitation_total_mm}mm | cloud ${w.cloud_cover_avg}%`;
    });

    return `State: ${stateName}\nDuck season weather + migration data (${data.withMigration.length} days with sightings, Sept-Feb over 5 years):\n\n${rows.join("\n")}`;
  }

  // Weather-only mode
  const sample = data.weatherOnly.length > 200
    ? data.weatherOnly.filter((_, i) => i % Math.ceil(data.weatherOnly.length / 200) === 0)
    : data.weatherOnly;

  const rows = sample.map((w) =>
    `${w.date}: ${w.temp_avg_f}F (${w.temp_low_f}-${w.temp_high_f}) | wind ${w.wind_speed_avg_mph}mph max ${w.wind_speed_max_mph}mph dir ${w.wind_direction_dominant} | pressure ${w.pressure_avg_msl}mb change ${w.pressure_change_12h}mb | precip ${w.precipitation_total_mm}mm | cloud ${w.cloud_cover_avg}%`
  );

  return `State: ${stateName}\nDuck season weather data (${data.weatherOnly.length} days, Sept-Feb over 5 years, NO migration sighting data yet):\n\n${rows.join("\n")}`;
}

async function extractPatterns(stateName: string, dataText: string, weatherOnly: boolean): Promise<string[]> {
  const migrationPrompt = `You are a waterfowl migration analyst. Analyze this historical duck sighting + weather data for ${stateName} and extract actionable hunting intelligence patterns.

${dataText}

Extract 5-10 specific, data-backed patterns. Each pattern should be a standalone insight a duck hunter could use. Focus on:
- Weather conditions that correlate with high sighting counts (cold fronts, pressure drops, wind direction, temperature)
- Timing patterns (which weeks/months peak, how they shift year to year)
- Notable migration triggers (first hard freeze, sustained cold, wind shifts)

Format: Return ONLY a JSON array of pattern strings. Each string should be 1-2 sentences, specific and quantitative where possible.

Example: ["In Arkansas, when barometric pressure drops 3+ mb with north winds over 15 mph in November, mallard sighting density increases 3x within 24 hours.", "Peak duck activity in Arkansas consistently occurs in the second and third weeks of December, with an average of 450+ sightings per observation day."]

Return ONLY the JSON array, no other text.`;

  const weatherOnlyPrompt = `You are a waterfowl hunting weather analyst. Analyze this historical weather data for ${stateName} during duck season months (Sept-Feb). Based on your knowledge of how waterfowl respond to weather, extract patterns that hunters should know about.

${dataText}

Extract 5-8 specific, actionable patterns. Focus on:
- Cold front patterns and timing (pressure drops, temp crashes, wind shifts)
- Typical weather windows that experienced hunters target
- Month-by-month weather progression and what it means for duck movement
- Wind direction patterns and what they signal

Format: Return ONLY a JSON array of pattern strings. Each string should be 1-2 sentences.
Return ONLY the JSON array, no other text.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [{
        role: "user",
        content: weatherOnly ? weatherOnlyPrompt : migrationPrompt,
      }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude error: ${res.status} ${err}`);
  }

  const msg = await res.json();
  const text = msg.content[0].text.trim();

  try {
    return JSON.parse(text);
  } catch {
    // Try to extract JSON array from response
    const match = text.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    console.error(`  Could not parse patterns for ${stateName}`);
    return [];
  }
}

async function generateEmbedding(text: string): Promise<number[]> {
  if (VOYAGE_KEY) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${VOYAGE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "voyage-3-lite",
          input: [text],
          input_type: "document",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.data[0].embedding;
      }
      if (res.status === 429 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 30000));
        continue;
      }
      throw new Error(`Voyage error: ${res.status}`);
    }
  }
  // Fallback to edge function
  const res = await fetch(`${SUPABASE_URL}/functions/v1/hunt-generate-embedding`, {
    method: "POST",
    headers: supaHeaders,
    body: JSON.stringify({ text, input_type: "document" }),
  });
  if (!res.ok) throw new Error(`Embedding failed: ${res.status}`);
  const data = await res.json();
  return data.embedding;
}

async function upsertKnowledge(entry: {
  title: string;
  content: string;
  content_type: string;
  tags: string[];
  embedding: number[];
}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge`, {
    method: "POST",
    headers: { ...supaHeaders, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      title: entry.title,
      content: entry.content,
      content_type: entry.content_type,
      tags: entry.tags,
      embedding: JSON.stringify(entry.embedding),
    }),
  });
  if (!res.ok) {
    console.error(`  Upsert failed: ${await res.text()}`);
  }
}

async function main() {
  console.log("=== Extracting Weather-Migration Patterns ===");
  let totalPatterns = 0;

  for (const stateAbbr of STATES) {
    const stateName = STATE_NAMES[stateAbbr] || stateAbbr;
    console.log(`\n${stateName} (${stateAbbr}):`);

    const data = await fetchJoinedData(stateAbbr);
    const totalPoints = data.withMigration.length + data.weatherOnly.length;
    if (totalPoints < 10) {
      console.log(`  Skipping — only ${totalPoints} data points`);
      continue;
    }

    const dataText = formatDataForClaude(stateName, data);
    const mode = data.withMigration.length > 0 ? "migration+weather" : "weather-only";
    console.log(`  ${totalPoints} data points (${mode}), extracting patterns...`);

    try {
      const weatherOnly = data.withMigration.length === 0;
      const patterns = await extractPatterns(stateName, dataText, weatherOnly);
      console.log(`  Got ${patterns.length} patterns`);

      const contentType = data.withMigration.length > 0 ? "weather-pattern" : "weather-insight";
      for (const pattern of patterns) {
        const title = `Weather-migration pattern: ${stateName}`;
        const richText = `${title} | ${contentType} | duck, ${stateName.toLowerCase()}, weather, migration | ${pattern}`;

        const embedding = await generateEmbedding(richText);
        await upsertKnowledge({
          title,
          content: pattern,
          content_type: contentType,
          tags: ["duck", stateName.toLowerCase(), "weather", "migration", "pattern"],
          embedding,
        });
        totalPatterns++;
      }

      // Rate limit Claude
      await new Promise((r) => setTimeout(r, 2000));
    } catch (err) {
      console.error(`  Error for ${stateName}: ${err}`);
    }
  }

  console.log(`\nDone! Total: ${totalPatterns} weather-migration patterns embedded`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
