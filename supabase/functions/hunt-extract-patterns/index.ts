import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { callClaude, parseTextContent, CLAUDE_MODELS } from '../_shared/anthropic.ts';
import { generateEmbedding } from '../_shared/embedding.ts';

// ---------------------------------------------------------------------------
// Config: process BATCH_SIZE states per invocation, then chain to next batch
// ---------------------------------------------------------------------------

const BATCH_SIZE = 1;
const MIN_DATA_POINTS = 10;
const MAX_SAMPLE_SIZE = 200;
const RATE_LIMIT_MS = 2000;

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

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchJoinedData(
  supabase: ReturnType<typeof createSupabaseClient>,
  stateAbbr: string
): Promise<{ withMigration: Record<string, unknown>[]; weatherOnly: Record<string, unknown>[] }> {
  const { data: migData } = await supabase
    .from('hunt_migration_history')
    .select('date,sighting_count,location_count')
    .eq('state_abbr', stateAbbr)
    .eq('species', 'duck')
    .order('date');

  const { data: wxData } = await supabase
    .from('hunt_weather_history')
    .select('date,temp_high_f,temp_low_f,temp_avg_f,wind_speed_avg_mph,wind_speed_max_mph,wind_direction_dominant,pressure_avg_msl,pressure_change_12h,precipitation_total_mm,cloud_cover_avg')
    .eq('state_abbr', stateAbbr)
    .order('date')
    .limit(1000);

  const mig = migData || [];
  const wx = wxData || [];

  if (mig.length > 0) {
    const wxMap = new Map(wx.map((w: Record<string, unknown>) => [w.date, w]));
    const joined = mig
      .filter((m: Record<string, unknown>) => wxMap.has(m.date as string))
      .map((m: Record<string, unknown>) => ({ ...m, weather: wxMap.get(m.date as string) }));
    return { withMigration: joined, weatherOnly: [] };
  }

  return { withMigration: [], weatherOnly: wx };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function sampleData<T>(data: T[]): T[] {
  if (data.length <= MAX_SAMPLE_SIZE) return data;
  return data.filter((_, i) => i % Math.ceil(data.length / MAX_SAMPLE_SIZE) === 0);
}

function formatDataForClaude(
  stateName: string,
  data: { withMigration: Record<string, unknown>[]; weatherOnly: Record<string, unknown>[] }
): string {
  if (data.withMigration.length > 0) {
    const sample = sampleData(data.withMigration);
    const rows = sample.map((d) => {
      const w = d.weather as Record<string, unknown>;
      return `${d.date}: ${d.sighting_count} sightings at ${d.location_count} locations | ${w.temp_avg_f}F (${w.temp_low_f}-${w.temp_high_f}) | wind ${w.wind_speed_avg_mph}mph max ${w.wind_speed_max_mph}mph dir ${w.wind_direction_dominant} | pressure ${w.pressure_avg_msl}mb change ${w.pressure_change_12h}mb | precip ${w.precipitation_total_mm}mm | cloud ${w.cloud_cover_avg}%`;
    });
    return `State: ${stateName}\nDuck season weather + migration data (${data.withMigration.length} days with sightings, Sept-Feb over 5 years):\n\n${rows.join("\n")}`;
  }

  const sample = sampleData(data.weatherOnly);
  const rows = sample.map((w) =>
    `${w.date}: ${w.temp_avg_f}F (${w.temp_low_f}-${w.temp_high_f}) | wind ${w.wind_speed_avg_mph}mph max ${w.wind_speed_max_mph}mph dir ${w.wind_direction_dominant} | pressure ${w.pressure_avg_msl}mb change ${w.pressure_change_12h}mb | precip ${w.precipitation_total_mm}mm | cloud ${w.cloud_cover_avg}%`
  );
  return `State: ${stateName}\nDuck season weather data (${data.weatherOnly.length} days, Sept-Feb over 5 years, NO migration sighting data yet):\n\n${rows.join("\n")}`;
}

// ---------------------------------------------------------------------------
// Pattern extraction via Claude
// ---------------------------------------------------------------------------

async function extractPatterns(stateName: string, dataText: string, weatherOnly: boolean): Promise<string[]> {
  const migrationPrompt = `You are a waterfowl migration analyst. Analyze this historical duck sighting + weather data for ${stateName} and extract actionable hunting intelligence patterns.

${dataText}

Extract 5-10 specific, data-backed patterns. Each pattern should be a standalone insight a duck hunter could use. Focus on:
- Weather conditions that correlate with high sighting counts (cold fronts, pressure drops, wind direction, temperature)
- Timing patterns (which weeks/months peak, how they shift year to year)
- Notable migration triggers (first hard freeze, sustained cold, wind shifts)

Format: Return ONLY a JSON array of pattern strings. Each string should be 1-2 sentences, specific and quantitative where possible.
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

  const response = await callClaude({
    model: CLAUDE_MODELS.sonnet,
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: weatherOnly ? weatherOnlyPrompt : migrationPrompt,
    }],
  });

  const text = parseTextContent(response);

  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    console.error(`[hunt-extract-patterns] Could not parse patterns for ${stateName}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Self-chaining: fire-and-forget next batch
// ---------------------------------------------------------------------------

function chainNextBatch(nextOffset: number) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  fetch(`${supabaseUrl}/functions/v1/hunt-extract-patterns`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ offset: nextOffset }),
  }).catch(err => console.error('[hunt-extract-patterns] Chain error:', err));
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* empty body ok */ }

    const offset = typeof body.offset === 'number' ? body.offset : 0;
    const batch = STATES.slice(offset, offset + BATCH_SIZE);

    if (batch.length === 0) {
      console.log('[hunt-extract-patterns] All states complete');
      return successResponse(req, { status: 'complete', message: 'All 50 states processed' });
    }

    console.log(`[hunt-extract-patterns] Batch ${offset / BATCH_SIZE + 1}: ${batch.join(', ')} (offset ${offset})`);
    const supabase = createSupabaseClient();

    let totalPatterns = 0;
    const stateResults: Record<string, number> = {};
    const errors: string[] = [];

    for (const stateAbbr of batch) {
      const stateName = STATE_NAMES[stateAbbr] || stateAbbr;
      console.log(`[hunt-extract-patterns] Processing ${stateName} (${stateAbbr})`);

      const data = await fetchJoinedData(supabase, stateAbbr);
      const totalPoints = data.withMigration.length + data.weatherOnly.length;

      if (totalPoints < MIN_DATA_POINTS) {
        console.log(`[hunt-extract-patterns] Skipping ${stateName} — only ${totalPoints} data points`);
        stateResults[stateAbbr] = 0;
        continue;
      }

      const dataText = formatDataForClaude(stateName, data);
      const mode = data.withMigration.length > 0 ? "migration+weather" : "weather-only";
      console.log(`[hunt-extract-patterns] ${stateName}: ${totalPoints} points (${mode})`);

      try {
        const weatherOnly = data.withMigration.length === 0;
        const patterns = await extractPatterns(stateName, dataText, weatherOnly);
        console.log(`[hunt-extract-patterns] ${stateName}: ${patterns.length} patterns`);

        const contentType = data.withMigration.length > 0 ? "weather-pattern" : "weather-insight";

        for (const pattern of patterns) {
          const title = `Weather-migration pattern: ${stateName}`;
          const richText = `${title} | ${contentType} | duck, ${stateName.toLowerCase()}, weather, migration | ${pattern}`;

          const embedding = await generateEmbedding(richText, 'document');

          const { error: insertErr } = await supabase
            .from('hunt_knowledge')
            .insert({
              title: `${contentType} | ${stateAbbr} | ${pattern.substring(0, 60)}`,
              content: pattern,
              content_type: contentType,
              tags: ["duck", stateName.toLowerCase(), "weather", "migration", "pattern"],
              species: "duck",
              state_abbr: stateAbbr,
              effective_date: null,
              embedding,
            });

          if (insertErr) {
            console.error(`[hunt-extract-patterns] Insert error:`, insertErr);
          } else {
            totalPatterns++;
          }
        }

        stateResults[stateAbbr] = patterns.length;
        await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
      } catch (err) {
        const errMsg = `${stateName}: ${err}`;
        console.error(`[hunt-extract-patterns] Error: ${errMsg}`);
        errors.push(errMsg);
      }
    }

    // Chain next batch if more states remain
    const nextOffset = offset + BATCH_SIZE;
    const hasMore = nextOffset < STATES.length;
    if (hasMore) {
      console.log(`[hunt-extract-patterns] Chaining next batch at offset ${nextOffset}`);
      chainNextBatch(nextOffset);
    }

    const summary = {
      batch: `${offset / BATCH_SIZE + 1} of ${Math.ceil(STATES.length / BATCH_SIZE)}`,
      states: batch,
      patterns_this_batch: totalPatterns,
      state_results: stateResults,
      has_more: hasMore,
      errors: errors.length > 0 ? errors : undefined,
    };

    console.log(`[hunt-extract-patterns] Batch done: ${totalPatterns} patterns`);
    return successResponse(req, summary);
  } catch (error) {
    console.error('[hunt-extract-patterns] Fatal error:', error);
    return errorResponse(req, 'Internal server error', 500);
  }
});
