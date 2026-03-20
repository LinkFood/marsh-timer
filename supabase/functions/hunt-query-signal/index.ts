import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { logCronRun } from '../_shared/cronLog.ts';

// Query-as-Signal: analyze what users are asking the brain about.
// When multiple users ask about the same state/species/weather pattern,
// that's crowdsourced anomaly detection. The brain should notice.

// Common state abbreviations for extraction
const STATE_ABBRS = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY",
]);

const STATE_NAMES: Record<string, string> = {
  "alabama":"AL","alaska":"AK","arizona":"AZ","arkansas":"AR","california":"CA",
  "colorado":"CO","connecticut":"CT","delaware":"DE","florida":"FL","georgia":"GA",
  "idaho":"ID","illinois":"IL","indiana":"IN","iowa":"IA","kansas":"KS",
  "kentucky":"KY","louisiana":"LA","maine":"ME","maryland":"MD","massachusetts":"MA",
  "michigan":"MI","minnesota":"MN","mississippi":"MS","missouri":"MO","montana":"MT",
  "nebraska":"NE","nevada":"NV","ohio":"OH","oklahoma":"OK","oregon":"OR",
  "pennsylvania":"PA","tennessee":"TN","texas":"TX","utah":"UT","vermont":"VT",
  "virginia":"VA","washington":"WA","wisconsin":"WI","wyoming":"WY",
};

const SPECIES_KEYWORDS: Record<string, string> = {
  "duck": "duck", "mallard": "duck", "teal": "duck", "pintail": "duck", "wood duck": "duck",
  "canvasback": "duck", "wigeon": "duck", "gadwall": "duck", "shoveler": "duck",
  "goose": "goose", "geese": "goose", "snow goose": "goose", "canada goose": "goose",
  "deer": "deer", "whitetail": "deer", "buck": "deer", "doe": "deer",
  "turkey": "turkey", "gobbler": "turkey", "tom": "turkey",
  "dove": "dove", "mourning dove": "dove",
};

const WEATHER_KEYWORDS = ["cold front", "freeze", "snow", "ice", "wind", "rain", "storm", "pressure", "temperature", "weather"];

function extractSignals(text: string): { states: string[]; species: string[]; weather: string[] } {
  const lower = text.toLowerCase();
  const states: string[] = [];
  const species: string[] = [];
  const weather: string[] = [];

  // Extract state mentions
  for (const [name, abbr] of Object.entries(STATE_NAMES)) {
    if (lower.includes(name)) states.push(abbr);
  }
  // Check for abbreviations (2-letter uppercase in original)
  const abbrMatches = text.match(/\b([A-Z]{2})\b/g) || [];
  for (const m of abbrMatches) {
    if (STATE_ABBRS.has(m) && !states.includes(m)) states.push(m);
  }

  // Extract species mentions
  for (const [keyword, sp] of Object.entries(SPECIES_KEYWORDS)) {
    if (lower.includes(keyword) && !species.includes(sp)) species.push(sp);
  }

  // Extract weather mentions
  for (const kw of WEATHER_KEYWORDS) {
    if (lower.includes(kw)) weather.push(kw);
  }

  return { states, species, weather };
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();

    // Get last 24h of user queries
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: conversations, error: fetchError } = await supabase
      .from("hunt_conversations")
      .select("content, created_at")
      .eq("role", "user")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(200);

    if (fetchError) {
      console.error("Fetch error:", fetchError.message);
      await logCronRun({
        functionName: "hunt-query-signal",
        status: "error",
        errorMessage: fetchError.message,
        durationMs: Date.now() - startTime,
      });
      return errorResponse(req, fetchError.message, 500);
    }

    if (!conversations || conversations.length === 0) {
      console.log("No queries in last 24h");
      await logCronRun({
        functionName: "hunt-query-signal",
        status: "success",
        summary: { queries: 0, embedded: 0 },
        durationMs: Date.now() - startTime,
      });
      return successResponse(req, { queries: 0, embedded: 0 });
    }

    // Aggregate signals across all queries
    const stateCount = new Map<string, number>();
    const speciesCount = new Map<string, number>();
    const weatherCount = new Map<string, number>();
    const queryTexts: string[] = [];

    for (const conv of conversations) {
      const content = conv.content || "";
      queryTexts.push(content);
      const signals = extractSignals(content);

      for (const s of signals.states) stateCount.set(s, (stateCount.get(s) || 0) + 1);
      for (const s of signals.species) speciesCount.set(s, (speciesCount.get(s) || 0) + 1);
      for (const w of signals.weather) weatherCount.set(w, (weatherCount.get(w) || 0) + 1);
    }

    const today = new Date().toISOString().split("T")[0];

    // Build signal summary
    const topStates = [...stateCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const topSpecies = [...speciesCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topWeather = [...weatherCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

    const signalText = [
      `query-signal | date:${today} | total_queries:${conversations.length}`,
      `top_states: ${topStates.map(([s, c]) => `${s}(${c})`).join(", ") || "none"}`,
      `top_species: ${topSpecies.map(([s, c]) => `${s}(${c})`).join(", ") || "none"}`,
      `weather_interest: ${topWeather.map(([w, c]) => `${w}(${c})`).join(", ") || "none"}`,
      `interpretation: Users are asking about ${topStates.length > 0 ? topStates[0][0] : "various states"} most frequently. ${topWeather.length > 0 ? `Weather interest focused on: ${topWeather.map(w => w[0]).join(", ")}` : "No weather-specific queries."} This may indicate emerging activity or conditions in these areas.`,
    ].join(" | ");

    const embeddings = await batchEmbed([signalText]);

    const { error: upsertError } = await supabase
      .from("hunt_knowledge")
      .upsert({
        title: `query-signal ${today}`,
        content: signalText,
        content_type: "query-signal",
        tags: ["query-signal", "crowdsourced", "user-behavior", ...topStates.map(s => s[0])],
        species: topSpecies.length > 0 ? topSpecies[0][0] : null,
        state_abbr: topStates.length > 0 ? topStates[0][0] : null,
        effective_date: today,
        metadata: {
          source: "platform-queries",
          total_queries: conversations.length,
          top_states: Object.fromEntries(topStates),
          top_species: Object.fromEntries(topSpecies),
          top_weather: Object.fromEntries(topWeather),
        },
        embedding: JSON.stringify(embeddings[0]),
      }, { onConflict: "title" });

    let totalEmbedded = 0;
    if (upsertError) {
      console.error("Upsert error:", upsertError.message);
    } else {
      totalEmbedded = 1;
    }

    const durationMs = Date.now() - startTime;
    await logCronRun({
      functionName: "hunt-query-signal",
      status: upsertError ? "partial" : "success",
      summary: { queries: conversations.length, embedded: totalEmbedded, top_states: topStates.slice(0, 3).map(s => s[0]) },
      durationMs,
    });

    return successResponse(req, { queries: conversations.length, embedded: totalEmbedded, top_states: topStates, durationMs });

  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error("Fatal:", err);
    await logCronRun({
      functionName: "hunt-query-signal",
      status: "error",
      errorMessage: String(err),
      durationMs,
    });
    return errorResponse(req, String(err), 500);
  }
});
