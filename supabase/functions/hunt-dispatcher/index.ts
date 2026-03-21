import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors, getCorsHeaders } from '../_shared/cors.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { callClaude, parseToolUse, parseTextContent, calculateCost, CLAUDE_MODELS } from '../_shared/anthropic.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';

const INTENT_TOOLS = [
  {
    name: 'route_intent',
    description: 'Route the user message to the appropriate handler based on intent',
    input_schema: {
      type: 'object',
      properties: {
        intent: {
          type: 'string',
          enum: ['weather', 'solunar', 'season_info', 'search', 'general'],
          description: 'The classified intent of the user message',
        },
        state_abbr: {
          type: 'string',
          description: 'State abbreviation mentioned or implied (e.g., "TX", "CA"). null if not applicable.',
        },
        species: {
          type: 'string',
          enum: ['duck', 'goose', 'deer', 'turkey', 'dove'],
          description: 'Species mentioned or implied',
        },
        query: {
          type: 'string',
          description: 'Cleaned/rewritten query for the handler',
        },
      },
      required: ['intent', 'query'],
    },
  },
];

// Shared brain search helper — calls hunt-search with v2 filters
async function searchBrain(opts: {
  query: string;
  content_types?: string[];
  state_abbr?: string;
  species?: string;
  recency_weight?: number;
  exclude_du_report?: boolean;
  limit?: number;
  min_similarity?: number;
}): Promise<Array<{ title: string; content: string; similarity: number; content_type: string; state_abbr?: string; effective_date?: string; species?: string }>> {
  try {
    const searchUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/hunt-search`;
    const res = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({
        query: opts.query,
        content_types: opts.content_types,
        state_abbr: opts.state_abbr,
        species: opts.species,
        recency_weight: opts.recency_weight ?? 0.0,
        exclude_du_report: opts.exclude_du_report ?? false,
        limit: opts.limit || 5,
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const minSim = opts.min_similarity ?? 0.3;
    return (data.vector || []).filter((v: { similarity: number }) => v.similarity > minSim);
  } catch {
    return [];
  }
}

// Fetch recent pattern links for a state via RPC
async function getRecentPatternLinks(stateAbbr: string | null, limit = 5): Promise<Array<{
  source_title: string;
  source_content_type: string;
  matched_title: string;
  matched_content_type: string;
  matched_content: string;
  similarity: number;
  created_at: string;
}>> {
  if (!stateAbbr) return [];
  try {
    const supabase = createSupabaseClient();
    const { data } = await supabase.rpc('get_recent_pattern_links', {
      p_state_abbr: stateAbbr,
      p_limit: limit,
      p_hours_back: 72,
    });
    return data || [];
  } catch {
    return [];
  }
}

// Check if a hunting season is currently open for a species/state
async function getSeasonStatus(species: string, stateAbbr: string): Promise<{ isOpen: boolean; nextOpen?: string; status: string }> {
  try {
    const supabase = createSupabaseClient();
    const { data: seasons } = await supabase
      .from('hunt_seasons')
      .select('season_type, dates')
      .eq('species_id', species)
      .eq('state_abbr', stateAbbr);

    if (!seasons || seasons.length === 0) return { isOpen: false, status: 'no data' };

    const now = new Date();
    for (const s of seasons) {
      const dates = s.dates as Array<{ start?: string; end?: string; open?: string; close?: string }>;
      for (const d of dates) {
        const start = new Date(d.start || d.open || '');
        const end = new Date(d.end || d.close || '');
        if (now >= start && now <= end) {
          return { isOpen: true, status: `${s.season_type} open until ${end.toLocaleDateString()}` };
        }
      }
    }

    // Find next opening
    let nextOpen: Date | null = null;
    for (const s of seasons) {
      const dates = s.dates as Array<{ start?: string; end?: string; open?: string; close?: string }>;
      for (const d of dates) {
        const start = new Date(d.start || d.open || '');
        if (start > now && (!nextOpen || start < nextOpen)) {
          nextOpen = start;
        }
      }
    }

    return {
      isOpen: false,
      nextOpen: nextOpen ? nextOpen.toLocaleDateString() : undefined,
      status: nextOpen ? `closed, opens ${nextOpen.toLocaleDateString()}` : 'closed',
    };
  } catch {
    return { isOpen: false, status: 'unknown' };
  }
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const headers = { ...getCorsHeaders(req), 'Content-Type': 'application/json' };

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
    }

    const body = await req.json();
    const { message, species: ctxSpecies, stateAbbr: ctxState, sessionId } = body;

    if (!message || typeof message !== 'string') {
      return new Response(JSON.stringify({ error: 'message required' }), { status: 400, headers });
    }

    // Auth: try JWT, fall back to anonymous
    let userId: string | null = null;
    const authHeader = req.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ') && !authHeader.includes(Deno.env.get('SUPABASE_ANON_KEY') || '__none__')) {
      try {
        const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.84.0');
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_ANON_KEY')!,
          { global: { headers: { Authorization: authHeader } } },
        );
        const { data } = await supabase.auth.getUser();
        userId = data.user?.id || null;
      } catch { /* anonymous */ }
    }

    // Rate limit
    const rateCheck = await checkRateLimit(userId);
    if (!rateCheck.allowed) {
      return new Response(JSON.stringify({
        response: rateCheck.error || 'Rate limit exceeded',
        cards: [],
        rateLimited: true,
      }), { status: 429, headers });
    }

    const supabase = createSupabaseClient();

    // Fetch recent conversation context
    let conversationContext = '';
    if (userId && sessionId) {
      const { data: recent } = await supabase
        .from('hunt_conversations')
        .select('role, content')
        .eq('user_id', userId)
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(10);

      if (recent && recent.length > 0) {
        conversationContext = '\n\nRecent conversation:\n' +
          recent.reverse().map((m: { role: string; content: string }) => `${m.role}: ${m.content}`).join('\n');
      }
    }

    // Step 1: Intent classification
    const systemPrompt = `You are the Duck Countdown Brain — an environmental intelligence system monitoring patterns across 21 data sources for all 50 US states.
You analyze convergence signals from weather, wildlife migration, lunar cycles, satellite data, water levels, drought conditions, and more.
You can answer questions about environmental patterns, weather intelligence, wildlife movement, and — when asked — hunting conditions and season dates.

Current context:
- Selected species: ${ctxSpecies || 'duck'}
- Selected state: ${ctxState || 'none'}
${conversationContext}

Classify the user's message intent and extract relevant parameters.
- weather: questions about weather, wind, temperature, conditions for hunting
- solunar: moon phase, feeding times, best hunting times, solunar
- season_info: when does season open/close, bag limits, dates, regulations
- search: searching for hunting knowledge, tips, regulations, general hunting info
- general: greetings, casual chat, meta questions about the app`;

    const classifyResponse = await callClaude({
      model: CLAUDE_MODELS.haiku,
      system: systemPrompt,
      messages: [{ role: 'user', content: message }],
      tools: INTENT_TOOLS,
      tool_choice: { type: 'tool', name: 'route_intent' },
      max_tokens: 256,
      temperature: 0,
    });

    const toolUse = parseToolUse(classifyResponse);
    if (!toolUse) {
      return respondGeneral(req, headers, message, ctxSpecies, ctxState, supabase, userId, sessionId, conversationContext);
    }

    const { intent, state_abbr, species: intentSpecies, query } = toolUse.input as {
      intent: string;
      state_abbr?: string;
      species?: string;
      query: string;
    };

    const resolvedState = state_abbr || ctxState;
    const resolvedSpecies = intentSpecies || ctxSpecies || 'duck';

    let result: { response: string; cards: unknown[]; mapAction?: unknown };

    // Intercept comparison queries BEFORE intent routing
    const compareMatch = message.match(/compare\s+(\w{2})\s+(?:vs?\.?|and|or|versus)\s+(\w{2})/i)
      || message.match(/(\w{2})\s+vs\.?\s+(\w{2})/i);
    if (compareMatch) {
      const s1 = compareMatch[1].toUpperCase();
      const s2 = compareMatch[2].toUpperCase();
      // Validate they look like state abbreviations
      if (s1.length === 2 && s2.length === 2 && s1 !== s2) {
        result = await handleCompare(s1, s2, message, resolvedSpecies);

        if (userId && sessionId) {
          await supabase.from('hunt_conversations').insert([
            { user_id: userId, session_id: sessionId, role: 'user', content: message },
            { user_id: userId, session_id: sessionId, role: 'assistant', content: result.response, metadata: { cards: result.cards, intent: 'compare' } },
          ]);
        }
        return new Response(JSON.stringify(result), { status: 200, headers });
      }
    }

    switch (intent) {
      case 'weather':
        if (!resolvedState) {
          // No state specified — handle as search (may be a comparative question)
          result = await handleSearch(query, resolvedSpecies, null);
        } else {
          result = await handleWeather(supabase, resolvedState, query, resolvedSpecies);
        }
        break;
      case 'solunar':
        result = await handleSolunar(supabase, resolvedState, query);
        break;
      case 'season_info':
        result = await handleSeasonInfo(supabase, resolvedSpecies, resolvedState, query);
        break;
      case 'search':
        result = await handleSearch(query, resolvedSpecies, resolvedState);
        break;
      default:
        result = await handleGeneral(message, resolvedSpecies, resolvedState, conversationContext);
        break;
    }

    // Store conversation
    if (userId && sessionId) {
      await supabase.from('hunt_conversations').insert([
        { user_id: userId, session_id: sessionId, role: 'user', content: message },
        { user_id: userId, session_id: sessionId, role: 'assistant', content: result.response, metadata: { cards: result.cards, intent } },
      ]);
    }

    // Record task
    const cost = calculateCost(CLAUDE_MODELS.haiku, classifyResponse.usage);
    await supabase.from('hunt_tasks').insert({
      user_id: userId,
      type: intent,
      input: { message, species: resolvedSpecies, state: resolvedState },
      output: { response: result.response.substring(0, 500) },
      cost_usd: cost,
      tokens_in: classifyResponse.usage.input_tokens,
      tokens_out: classifyResponse.usage.output_tokens,
    }).then(() => {}).catch(e => console.warn('Task record failed:', e));

    return new Response(JSON.stringify(result), { status: 200, headers });

  } catch (error) {
    console.error('[hunt-dispatcher]', error);
    return new Response(JSON.stringify({
      response: 'Sorry, I hit an error. Try again in a moment.',
      cards: [],
    }), { status: 500, headers });
  }
});

async function handleWeather(supabase: ReturnType<typeof createSupabaseClient>, stateAbbr: string | null, query: string, species: string = 'duck') {
  if (!stateAbbr) {
    return { response: 'Which state are you interested in? Select one on the map or tell me.', cards: [] };
  }

  const { data: state } = await supabase
    .from('hunt_states')
    .select('centroid_lat, centroid_lng, name')
    .eq('abbreviation', stateAbbr)
    .maybeSingle();

  if (!state?.centroid_lat) {
    return { response: `I don't have location data for ${stateAbbr} yet.`, cards: [] };
  }

  // Fetch weather + convergence + brain search in parallel
  const weatherUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/hunt-weather`;
  const [weatherRes, convergenceResult, brainResults, patternLinks, seasonStatus] = await Promise.all([
    fetch(weatherUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({ lat: state.centroid_lat, lng: state.centroid_lng, state_abbr: stateAbbr }),
    }),
    supabase
      .from('hunt_convergence_scores')
      .select('*')
      .eq('state_abbr', stateAbbr)
      .order('date', { ascending: false })
      .limit(1)
      .single(),
    searchBrain({
      query: `${state.name} duck hunting weather conditions ${query}`,
      content_types: ['weather-event', 'weather-insight', 'weather-daily', 'weather-pattern'],
      state_abbr: stateAbbr,
      recency_weight: 0.5,
      exclude_du_report: true,
      limit: 5,
      min_similarity: 0.4,
    }),
    getRecentPatternLinks(stateAbbr),
    getSeasonStatus(species, stateAbbr),
  ]);

  if (!weatherRes.ok) {
    return { response: `Couldn't fetch weather for ${state.name}. Try again later.`, cards: [] };
  }

  const forecast = await weatherRes.json();
  const convData = convergenceResult.data;

  const hourly = forecast.hourly;
  const now = new Date();
  const currentHour = now.getUTCHours();
  const temp = hourly?.temperature_2m?.[currentHour];
  const wind = hourly?.wind_speed_10m?.[currentHour];
  const precip = hourly?.precipitation?.[currentHour];

  // Build pattern insight from brain results
  let patternInsight = '';
  if (brainResults.length > 0) {
    patternInsight = `\n\nHistorical patterns from the brain (${brainResults.length} matches):\n${brainResults.map(v => v.content).join('\n')}`;
  }

  let linksInsight = '';
  if (patternLinks.length > 0) {
    linksInsight = `\n\nLive pattern connections (last 72h):\n${patternLinks.map(l => `${l.source_title} → ${l.matched_title} (${(l.similarity * 100).toFixed(0)}% match)`).join('\n')}`;
  }

  const weatherSummary = await callClaude({
    model: CLAUDE_MODELS.haiku,
    system: `You are an environmental weather analyst. Give a brief, practical weather intelligence summary. Focus on wind shifts, temperature changes, pressure systems, and precipitation patterns that signal environmental changes. If historical pattern data is provided, reference it to give data-backed insights. 2-3 sentences max.
Never include external URLs, links, or website references in your response. Never recommend external websites or apps. All information comes from Duck Countdown's data.

CRITICAL RULES:
1. ONLY state facts that come from the provided context data. Never invent data.
2. When you reference brain data, prefix it with "📊 From our data:" or "📊 Based on [N] brain entries:"
3. When the brain has NO relevant data, say clearly: "The brain doesn't have specific data on this yet."
4. NEVER fill in with general knowledge when brain data is missing — acknowledge the gap instead.
5. If you must add general context beyond the data, clearly label it: "General hunting knowledge (not from brain data):"`,
    messages: [{ role: 'user', content: `Live weather data:\nTemp: ${temp}°F, Wind: ${wind} mph, Precip: ${precip}mm\n\nSeason status: ${seasonStatus.status}${seasonStatus.isOpen ? '' : ' — SEASON IS CLOSED. Note this in your response.'}\n\nBrain historical patterns (${brainResults.length} matches):\n${patternInsight || 'No brain matches found.'}\n${linksInsight}\n\nQuery: ${query}` }],
    max_tokens: 200,
  });

  const cards: unknown[] = [{
    type: 'weather',
    data: {
      temp,
      wind_speed: wind,
      precipitation: precip,
      description: `${state.name} conditions`,
    },
  }];

  if (convData) {
    cards.push({
      type: 'convergence',
      data: {
        stateAbbr: convData.state_abbr,
        score: convData.score,
        weatherComponent: convData.weather_component,
        solunarComponent: convData.solunar_component,
        migrationComponent: convData.migration_component,
        birdcastComponent: convData.birdcast_component,
        patternComponent: convData.pattern_component,
        nationalRank: convData.national_rank,
        reasoning: convData.reasoning,
      },
    });
  }

  if (brainResults.length > 0) {
    cards.push({
      type: 'pattern',
      data: {
        patterns: brainResults.slice(0, 5).map(v => ({
          title: v.title,
          content: v.content.length > 200 ? v.content.substring(0, 200) + '...' : v.content,
          similarity: v.similarity,
          content_type: v.content_type,
        })),
      },
    });
  }

  if (patternLinks.length > 0) {
    cards.push({
      type: 'pattern-links',
      data: {
        links: patternLinks.slice(0, 5).map(l => ({
          source: l.source_title,
          sourceType: l.source_content_type,
          matched: l.matched_title,
          matchedType: l.matched_content_type,
          similarity: l.similarity,
          when: l.created_at,
        })),
      },
    });
  }

  return {
    response: parseTextContent(weatherSummary),
    cards,
    mapAction: { type: 'flyTo', target: stateAbbr },
  };
}

async function handleSolunar(supabase: ReturnType<typeof createSupabaseClient>, stateAbbr: string | null, query: string) {
  if (!stateAbbr) {
    return { response: 'Which state? Select one on the map or tell me.', cards: [] };
  }

  const { data: state } = await supabase
    .from('hunt_states')
    .select('centroid_lat, centroid_lng, name')
    .eq('abbreviation', stateAbbr)
    .maybeSingle();

  if (!state?.centroid_lat) {
    return { response: `I don't have location data for ${stateAbbr}.`, cards: [] };
  }

  const today = new Date().toISOString().split('T')[0];

  // Fetch solunar + brain search in parallel
  const solunarUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/hunt-solunar`;
  const [solunarRes, brainResults] = await Promise.all([
    fetch(solunarUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({ lat: state.centroid_lat, lng: state.centroid_lng, date: today }),
    }),
    searchBrain({
      query: `${state.name} solunar moon phase feeding times hunting ${query}`,
      content_types: ['solunar-weekly', 'convergence-score', 'weather-pattern'],
      state_abbr: stateAbbr,
      recency_weight: 0.3,
      exclude_du_report: true,
      limit: 3,
      min_similarity: 0.35,
    }),
  ]);

  if (!solunarRes.ok) {
    return { response: `Couldn't fetch solunar data for ${state.name}.`, cards: [] };
  }

  const data = await solunarRes.json();
  const solunar = data.solunar || {};
  const sunrise = data.sunrise || {};

  let brainContext = '';
  if (brainResults.length > 0) {
    brainContext = ` Based on historical patterns: ${brainResults.map(v => v.content).join('; ').substring(0, 300)}`;
  }

  return {
    response: `Here's the solunar forecast for ${state.name} today. ${solunar.dayRating ? `Overall rating: ${solunar.dayRating}/5.` : ''} ${solunar.moonPhase ? `Moon phase: ${solunar.moonPhase}.` : ''}${brainContext}`,
    cards: [{
      type: 'solunar',
      data: {
        moon_phase: solunar.moonPhase,
        moon_illumination: solunar.moonIllumination,
        major_times: [solunar.major1Start, solunar.major2Start].filter(Boolean),
        minor_times: [solunar.minor1Start, solunar.minor2Start].filter(Boolean),
        sunrise: sunrise.sunrise ? new Date(sunrise.sunrise).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : undefined,
        sunset: sunrise.sunset ? new Date(sunrise.sunset).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : undefined,
        rating: solunar.dayRating,
      },
    }],
    mapAction: { type: 'flyTo', target: stateAbbr },
  };
}

async function handleSeasonInfo(supabase: ReturnType<typeof createSupabaseClient>, species: string, stateAbbr: string | null, query: string) {
  if (!stateAbbr) {
    return { response: 'Which state are you asking about? Select one on the map or tell me.', cards: [] };
  }

  // Fetch seasons + convergence + brain search in parallel
  const [seasonsResult, convergenceResult, brainResults] = await Promise.all([
    supabase
      .from('hunt_seasons')
      .select('*')
      .eq('species_id', species)
      .eq('state_abbr', stateAbbr),
    supabase
      .from('hunt_convergence_scores')
      .select('*')
      .eq('state_abbr', stateAbbr)
      .order('date', { ascending: false })
      .limit(1)
      .single(),
    searchBrain({
      query: `${species} hunting season regulations ${stateAbbr} ${query}`,
      content_types: ['regulation', 'fact', 'usfws_hip', 'usfws_breeding', 'species-behavior', 'hunting-knowledge'],
      species: species,
      state_abbr: stateAbbr,
      recency_weight: 0.0,
      exclude_du_report: false,
      limit: 3,
      min_similarity: 0.35,
    }),
  ]);

  const seasons = seasonsResult.data;
  const convData = convergenceResult.data;

  if (!seasons || seasons.length === 0) {
    return { response: `No ${species} season data found for ${stateAbbr}.`, cards: [] };
  }

  const now = new Date();
  const cards = seasons.map((s: Record<string, unknown>) => {
    const dates = s.dates as Array<{ start: string; end: string }>;
    let status = 'closed';
    for (const d of dates) {
      const start = new Date(d.start);
      const end = new Date(d.end);
      if (now >= start && now <= end) { status = 'open'; break; }
      if (now < start) {
        const daysUntil = Math.ceil((start.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (daysUntil <= 30) status = 'soon';
        else if (daysUntil <= 90) status = 'upcoming';
      }
    }
    return {
      type: 'season',
      data: {
        species,
        state: stateAbbr,
        season_type: s.season_type,
        zone: s.zone,
        status,
        dates,
        bag_limit: s.bag_limit,
      },
    };
  });

  let brainContext = '';
  if (brainResults.length > 0) {
    brainContext = `\n\nAdditional knowledge from the brain:\n${brainResults.map(v => `[${v.title}] ${v.content}`).join('\n')}`;
  }

  const seasonSummary = await callClaude({
    model: CLAUDE_MODELS.haiku,
    system: `You are a hunting season expert. Summarize the season information briefly. Include key dates and bag limits. 2-3 sentences.
ONLY state facts directly from the provided JSON data. Never invent or assume zone names, dates, bag limits, or details not present in the data. If information is missing or incomplete, explicitly say "I don't have that specific data" rather than guessing.
Never include external URLs, links, or website references in your response. Never recommend external websites or apps. All information comes from Duck Countdown's data.

CRITICAL RULES:
1. ONLY state facts that come from the provided context data. Never invent data.
2. When you reference brain data, prefix it with "📊 From our data:" or "📊 Based on [N] brain entries:"
3. When the brain has NO relevant data, say clearly: "The brain doesn't have specific data on this yet."
4. NEVER fill in with general knowledge when brain data is missing — acknowledge the gap instead.
5. If you must add general context beyond the data, clearly label it: "General hunting knowledge (not from brain data):"`,
    messages: [{ role: 'user', content: `${species} seasons in ${stateAbbr}: ${JSON.stringify(seasons.map((s: Record<string, unknown>) => ({ type: s.season_type, zone: s.zone, dates: s.dates, bag: s.bag_limit })))}. User asked: ${query}${brainContext}` }],
    max_tokens: 200,
  });

  if (convData) {
    cards.push({
      type: 'convergence',
      data: {
        stateAbbr: convData.state_abbr,
        score: convData.score,
        weatherComponent: convData.weather_component,
        solunarComponent: convData.solunar_component,
        migrationComponent: convData.migration_component,
        birdcastComponent: convData.birdcast_component,
        patternComponent: convData.pattern_component,
        nationalRank: convData.national_rank,
        reasoning: convData.reasoning,
      },
    });
  }

  return {
    response: parseTextContent(seasonSummary),
    cards,
    mapAction: { type: 'flyTo', target: stateAbbr },
  };
}

async function handleCompare(state1: string, state2: string, query: string, species: string) {
  const supabase = createSupabaseClient();

  const [conv1, conv2, s1Status, s2Status] = await Promise.all([
    supabase.from('hunt_convergence_scores').select('*').eq('state_abbr', state1).order('date', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('hunt_convergence_scores').select('*').eq('state_abbr', state2).order('date', { ascending: false }).limit(1).maybeSingle(),
    getSeasonStatus(species, state1),
    getSeasonStatus(species, state2),
  ]);

  const c1 = conv1.data;
  const c2 = conv2.data;

  let context = `Comparing ${state1} vs ${state2} for ${species} hunting:\n`;
  if (c1) context += `\n${state1}: Score ${c1.score}/100 (rank #${c1.national_rank}). Weather: ${c1.weather_component}/25, Solunar: ${c1.solunar_component}/15, Migration: ${c1.migration_component}/25, BirdCast: ${c1.birdcast_component}/20, Pattern: ${c1.pattern_component}/15. ${c1.reasoning}`;
  if (c2) context += `\n${state2}: Score ${c2.score}/100 (rank #${c2.national_rank}). Weather: ${c2.weather_component}/25, Solunar: ${c2.solunar_component}/15, Migration: ${c2.migration_component}/25, BirdCast: ${c2.birdcast_component}/20, Pattern: ${c2.pattern_component}/15. ${c2.reasoning}`;
  context += `\n\nSeason status: ${state1}: ${s1Status.status} | ${state2}: ${s2Status.status}`;

  const response = await callClaude({
    model: CLAUDE_MODELS.haiku,
    system: `You are an environmental analyst comparing two states. Use the provided convergence scores and brain data to give a clear recommendation. Format as a side-by-side comparison with a verdict. Be specific — cite scores, bird counts, and conditions. Never include external URLs.
ONLY reference data provided in the context. If data is missing for a state, say so.

CRITICAL RULES:
1. ONLY state facts that come from the provided context data. Never invent data.
2. When you reference brain data, prefix it with "📊 From our data:" or "📊 Based on [N] brain entries:"
3. When the brain has NO relevant data, say clearly: "The brain doesn't have specific data on this yet."
4. NEVER fill in with general knowledge when brain data is missing — acknowledge the gap instead.
5. If you must add general context beyond the data, clearly label it: "General hunting knowledge (not from brain data):"`,
    messages: [{ role: 'user', content: `${context}\n\nQuestion: ${query}` }],
    max_tokens: 400,
  });

  const cards: unknown[] = [];
  if (c1) cards.push({ type: 'convergence', data: { stateAbbr: c1.state_abbr, score: c1.score, weatherComponent: c1.weather_component, solunarComponent: c1.solunar_component, migrationComponent: c1.migration_component, birdcastComponent: c1.birdcast_component, patternComponent: c1.pattern_component, nationalRank: c1.national_rank, reasoning: c1.reasoning } });
  if (c2) cards.push({ type: 'convergence', data: { stateAbbr: c2.state_abbr, score: c2.score, weatherComponent: c2.weather_component, solunarComponent: c2.solunar_component, migrationComponent: c2.migration_component, birdcastComponent: c2.birdcast_component, patternComponent: c2.pattern_component, nationalRank: c2.national_rank, reasoning: c2.reasoning } });

  return {
    response: parseTextContent(response),
    cards,
    mapAction: { type: 'flyTo', target: c1 && c2 ? (c1.score >= c2.score ? state1 : state2) : state1 },
  };
}

async function handleSearch(query: string, species: string = 'duck', stateAbbr?: string | null) {
  // Check for comparison pattern (e.g., "compare AR vs LA", "TX or OK")
  const compareMatch = query.match(/compare\s+(\w{2})\s+(?:vs?\.?|and|or|versus)\s+(\w{2})/i)
    || query.match(/(\w{2})\s+(?:vs?\.?|or|versus)\s+(\w{2})/i);

  if (compareMatch) {
    const s1 = compareMatch[1].toUpperCase();
    const s2 = compareMatch[2].toUpperCase();
    return handleCompare(s1, s2, query, species);
  }

  // Determine if DU reports should be included
  const mentionsDU = /\b(du|ducks unlimited|migration map)\b/i.test(query);
  const searchQuery = species !== 'duck' ? `${species} ${query}` : query;

  // Check if this is a comparative query (no state, asking about "best" or "where")
  const isComparative = !stateAbbr && /\b(best|top|where|which state|compare|recommend)\b/i.test(query);

  const supabase = createSupabaseClient();
  const [brainResults, patternLinks, topStatesResult] = await Promise.all([
    searchBrain({
      query: searchQuery,
      species: species,
      state_abbr: stateAbbr || undefined,
      recency_weight: 0.3,
      exclude_du_report: !mentionsDU,
      limit: 8,
      min_similarity: 0.3,
    }),
    getRecentPatternLinks(stateAbbr),
    isComparative
      ? supabase
          .from('hunt_convergence_scores')
          .select('state_abbr, score, reasoning, national_rank')
          .order('score', { ascending: false })
          .limit(10)
      : Promise.resolve({ data: null }),
  ]);

  const cards: unknown[] = [];
  let vectorContext = '';

  if (brainResults.length > 0) {
    vectorContext = brainResults.map(v => `[${v.title}] ${v.content}`).join('\n');

    const patternMatches = brainResults
      .filter(v => v.similarity > 0.4)
      .slice(0, 5)
      .map(v => ({
        title: v.title,
        content: v.content.length > 200 ? v.content.substring(0, 200) + '...' : v.content,
        similarity: v.similarity,
        content_type: v.content_type,
      }));
    if (patternMatches.length > 0) {
      cards.push({ type: 'pattern', data: { patterns: patternMatches } });
    }

    const contentTypes = [...new Set(brainResults.map(v => v.content_type))];
    const similarities = brainResults.map(v => v.similarity);
    cards.push({
      type: 'source',
      data: {
        vectorCount: brainResults.length,
        keywordCount: 0,
        contentTypes,
        similarityRange: [Math.min(...similarities), Math.max(...similarities)],
      },
    });
  }

  // Keyword fallback if brain returned nothing
  if (!vectorContext) {
    try {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.84.0');
      const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const escapedQuery = query.replace(/[%_\\]/g, '\\$&');
      const [seasonsResult, factsResult] = await Promise.all([
        supabase.from('hunt_seasons')
          .select('species_id, state_abbr, state_name, season_type, zone, notes')
          .or(`notes.ilike.%${escapedQuery}%,state_name.ilike.%${escapedQuery}%`)
          .limit(5),
        supabase.from('hunt_state_facts')
          .select('species_id, state_name, facts')
          .limit(5),
      ]);
      vectorContext = [
        ...(seasonsResult.data || []).map((s: Record<string, unknown>) => `${s.species_id} ${s.state_name} ${s.season_type}: ${s.notes || 'No notes'}`),
        ...(factsResult.data || []).map((f: Record<string, unknown>) => `${f.species_id} ${f.state_name}: ${(f.facts as string[]).join('; ')}`),
      ].join('\n');
    } catch { /* keyword search is best-effort */ }
  }

  let linksContext = '';
  if (patternLinks.length > 0) {
    linksContext = `\n\nLive pattern connections (last 72h):\n${patternLinks.map(l => `${l.source_title} → ${l.matched_title} (${(l.similarity * 100).toFixed(0)}% match)`).join('\n')}`;
  }

  let topStatesContext = '';
  if (topStatesResult.data && topStatesResult.data.length > 0) {
    topStatesContext = `\n\nTop states by convergence score right now:\n${topStatesResult.data.map((s: { state_abbr: string; score: number; reasoning: string; national_rank: number }) => `#${s.national_rank} ${s.state_abbr}: ${s.score}/100 — ${s.reasoning}`).join('\n')}`;
    topStatesContext += `\n\nNote: Check season dates before recommending — some of these states may have closed seasons right now.`;
  }

  const searchResponse = await callClaude({
    model: CLAUDE_MODELS.haiku,
    system: `You are an environmental intelligence analyst. Answer based on the provided context. Be concise but informative.
Never include external URLs, links, or website references in your response. Never recommend external websites or apps. All information comes from Duck Countdown's data.

CRITICAL RULES:
1. ONLY state facts that come from the provided context data. Never invent data.
2. When you reference brain data, prefix it with "📊 From our data:" or "📊 Based on [N] brain entries:"
3. When the brain has NO relevant data, say clearly: "The brain doesn't have specific data on this yet."
4. NEVER fill in with general knowledge when brain data is missing — acknowledge the gap instead.
5. If you must add general context beyond the data, clearly label it: "General hunting knowledge (not from brain data):"`,
    messages: [{ role: 'user', content: (() => {
      const similarities = brainResults.map(v => v.similarity);
      const minSim = similarities.length > 0 ? Math.min(...similarities).toFixed(2) : '0';
      const maxSim = similarities.length > 0 ? Math.max(...similarities).toFixed(2) : '0';
      return `Brain data (${brainResults.length} entries found${brainResults.length > 0 ? `, confidence ${minSim}-${maxSim}` : ''}):\n${vectorContext || 'No brain matches found.'}\n\nIMPORTANT: Only reference the brain data above. If the data doesn't answer the question, say "The brain doesn't have data on this yet."${linksContext}${topStatesContext}\n\nQuestion: ${query}`;
    })() }],
    max_tokens: 300,
  });

  if (patternLinks.length > 0) {
    cards.push({
      type: 'pattern-links',
      data: {
        links: patternLinks.slice(0, 5).map(l => ({
          source: l.source_title,
          sourceType: l.source_content_type,
          matched: l.matched_title,
          matchedType: l.matched_content_type,
          similarity: l.similarity,
          when: l.created_at,
        })),
      },
    });
  }

  return {
    response: parseTextContent(searchResponse),
    cards,
  };
}

async function handleGeneral(message: string, species: string, stateAbbr: string | null, conversationContext: string) {
  // Light brain search — only include if high-similarity matches exist
  const brainResults = await searchBrain({
    query: message,
    recency_weight: 0.2,
    exclude_du_report: true,
    limit: 3,
    min_similarity: 0.5,
  });

  let brainContext = '';
  if (brainResults.length > 0) {
    brainContext = `\n\nRelevant knowledge (cite if useful):\n${brainResults.map(v => `[${v.title}] ${v.content}`).join('\n')}`;
  }

  const response = await callClaude({
    model: CLAUDE_MODELS.haiku,
    system: `You are the Duck Countdown Brain — an environmental intelligence assistant. You help with US environmental patterns, weather intelligence, wildlife signals, solunar data, and hunting season information when asked.
Current context: species=${species}, state=${stateAbbr || 'none'}.${species !== 'duck' ? `\nThe user is asking about ${species} hunting. You have species-specific knowledge including ${species === 'deer' ? 'rut timing, moon phase correlations, cold snap triggers, barometric pressure effects, and wind patterns' : species === 'turkey' ? 'gobble peak timing, weather sensitivity, roosting behavior, and calling strategies' : species === 'dove' ? 'migration timing, field rotation patterns, weather windows, and wind thresholds' : `${species}-specific patterns and behavior`} for their state and region.` : ''}
${conversationContext}${brainContext}
Be concise and helpful. 2-3 sentences max for casual chat.
Never include external URLs, links, or website references in your response. Never recommend external websites or apps. All information comes from Duck Countdown's data.

CRITICAL RULES:
1. ONLY state facts that come from the provided context data. Never invent data.
2. When you reference brain data, prefix it with "📊 From our data:" or "📊 Based on [N] brain entries:"
3. When the brain has NO relevant data, say clearly: "The brain doesn't have specific data on this yet."
4. NEVER fill in with general knowledge when brain data is missing — acknowledge the gap instead.
5. If you must add general context beyond the data, clearly label it: "General hunting knowledge (not from brain data):"`,
    messages: [{ role: 'user', content: message }],
    max_tokens: 300,
  });

  return {
    response: parseTextContent(response),
    cards: [],
  };
}

async function respondGeneral(req: Request, headers: Record<string, string>, message: string, species: string, stateAbbr: string | null, supabase: ReturnType<typeof createSupabaseClient>, userId: string | null, sessionId: string | null, conversationContext: string) {
  const result = await handleGeneral(message, species, stateAbbr, conversationContext);

  if (userId && sessionId) {
    await supabase.from('hunt_conversations').insert([
      { user_id: userId, session_id: sessionId, role: 'user', content: message },
      { user_id: userId, session_id: sessionId, role: 'assistant', content: result.response },
    ]);
  }

  return new Response(JSON.stringify(result), { status: 200, headers });
}
