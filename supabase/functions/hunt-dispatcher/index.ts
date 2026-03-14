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
      }), { status: 200, headers }); // 200 so frontend shows the message
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
    const systemPrompt = `You are the DuckCountdown AI assistant — a hunting season expert for the US.
You help hunters with season dates, weather conditions, solunar forecasts, and general hunting questions.

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
      // Fallback: general response
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

    switch (intent) {
      case 'weather':
        result = await handleWeather(supabase, resolvedState, query);
        break;
      case 'solunar':
        result = await handleSolunar(supabase, resolvedState, query);
        break;
      case 'season_info':
        result = await handleSeasonInfo(supabase, resolvedSpecies, resolvedState, query);
        break;
      case 'search':
        result = await handleSearch(supabase, query, resolvedSpecies);
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
    }), { status: 200, headers }); // 200 so frontend can show error message
  }
});

async function handleWeather(supabase: ReturnType<typeof createSupabaseClient>, stateAbbr: string | null, query: string) {
  if (!stateAbbr) {
    return { response: 'Which state are you interested in? Select one on the map or tell me.', cards: [] };
  }

  // Get state centroid
  const { data: state } = await supabase
    .from('hunt_states')
    .select('centroid_lat, centroid_lng, name')
    .eq('abbreviation', stateAbbr)
    .maybeSingle();

  if (!state?.centroid_lat) {
    return { response: `I don't have location data for ${stateAbbr} yet.`, cards: [] };
  }

  // Call hunt-weather function + fetch convergence in parallel
  const weatherUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/hunt-weather`;
  const [weatherRes, convergenceResult] = await Promise.all([
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
  ]);

  if (!weatherRes.ok) {
    return { response: `Couldn't fetch weather for ${state.name}. Try again later.`, cards: [] };
  }

  const forecast = await weatherRes.json();
  const convData = convergenceResult.data;

  // Parse current conditions from hourly data
  const hourly = forecast.hourly;
  const now = new Date();
  const currentHour = now.getUTCHours();
  const temp = hourly?.temperature_2m?.[currentHour];
  const wind = hourly?.wind_speed_10m?.[currentHour];
  const precip = hourly?.precipitation?.[currentHour];

  // Search hunt_knowledge for weather-migration pattern insights
  let patternInsight = '';
  let weatherPatternMatches: Array<{ title: string; content: string; similarity: number; content_type: string }> = [];
  try {
    const conditionStr = `${state.name} duck hunting weather: ${temp}°F, wind ${wind} mph, precipitation ${precip}mm`;
    const searchUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/hunt-search`;
    const searchRes = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({ query: conditionStr, state_abbr: stateAbbr, limit: 3 }),
    });
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      const allPatterns = (searchData.vector || [])
        .filter((v: { similarity: number }) => v.similarity > 0.5) as Array<{ title: string; content: string; similarity: number; content_type?: string }>;
      const patternContents = allPatterns.map((v) => v.content);
      if (patternContents.length > 0) {
        patternInsight = `\n\nHistorical patterns:\n${patternContents.join('\n')}`;
      }
      // Build pattern card for weather response
      if (allPatterns.length > 0) {
        weatherPatternMatches = allPatterns.slice(0, 5).map((v) => ({
          title: v.title,
          content: v.content.length > 200 ? v.content.substring(0, 200) + '...' : v.content,
          similarity: v.similarity,
          content_type: v.content_type || 'pattern',
        }));
      }
    }
  } catch { /* pattern matching is best-effort */ }

  // Build 3-day summary via Claude
  const weatherSummary = await callClaude({
    model: CLAUDE_MODELS.haiku,
    system: 'You are a hunting weather expert. Give a brief, practical hunting weather summary. Focus on wind, temperature changes, and precipitation that affect hunting. If historical pattern data is provided, reference it to give data-backed insights. 2-3 sentences max.\nNever include external URLs, links, or website references in your response. Never recommend external websites or apps. All information comes from DuckCountdown\'s own data.',
    messages: [{ role: 'user', content: `Weather data for ${state.name}: Current temp ${temp}°F, wind ${wind} mph, precip ${precip}mm. Full hourly data available for 3 days.${patternInsight}\n\nQuery: ${query}` }],
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

  if (weatherPatternMatches.length > 0) {
    cards.push({ type: 'pattern', data: { patterns: weatherPatternMatches } });
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
  const solunarUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/hunt-solunar`;
  const solunarRes = await fetch(solunarUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
    },
    body: JSON.stringify({ lat: state.centroid_lat, lng: state.centroid_lng, date: today }),
  });

  if (!solunarRes.ok) {
    return { response: `Couldn't fetch solunar data for ${state.name}.`, cards: [] };
  }

  const data = await solunarRes.json();
  const solunar = data.solunar || {};
  const sunrise = data.sunrise || {};

  return {
    response: `Here's the solunar forecast for ${state.name} today. ${solunar.dayRating ? `Overall rating: ${solunar.dayRating}/5.` : ''} ${solunar.moonPhase ? `Moon phase: ${solunar.moonPhase}.` : ''}`,
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

  const [seasonsResult, convergenceResult] = await Promise.all([
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
  ]);

  const seasons = seasonsResult.data;
  const convData = convergenceResult.data;

  if (!seasons || seasons.length === 0) {
    return { response: `No ${species} season data found for ${stateAbbr}.`, cards: [] };
  }

  // Build cards for each season
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

  // Generate summary via Claude
  const seasonSummary = await callClaude({
    model: CLAUDE_MODELS.haiku,
    system: 'You are a hunting season expert. Summarize the season information briefly. Include key dates and bag limits. 2-3 sentences.\nONLY state facts directly from the provided JSON data. Never invent or assume zone names, dates, bag limits, or details not present in the data. If information is missing or incomplete, explicitly say "I don\'t have that specific data" rather than guessing.\nNever include external URLs, links, or website references in your response. Never recommend external websites or apps. All information comes from DuckCountdown\'s own data.',
    messages: [{ role: 'user', content: `${species} seasons in ${stateAbbr}: ${JSON.stringify(seasons.map((s: Record<string, unknown>) => ({ type: s.season_type, zone: s.zone, dates: s.dates, bag: s.bag_limit })))}. User asked: ${query}` }],
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

async function handleSearch(supabase: ReturnType<typeof createSupabaseClient>, query: string, species: string = 'duck') {
  // Hybrid search: vector via hunt-search + keyword fallback
  // Prepend species to query for better vector match on species-specific knowledge
  const searchQuery = species !== 'duck' ? `${species} ${query}` : query;
  let vectorContext = '';
  const cards: unknown[] = [];
  try {
    const searchUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/hunt-search`;
    const searchRes = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({ query: searchQuery, limit: 8 }),
    });
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      const allVector = (searchData.vector || []) as Array<{ title: string; content: string; similarity: number; content_type?: string }>;
      const filteredVector = allVector.filter((v) => v.similarity > 0.3);
      const vectorHits = filteredVector
        .map((v) => `[${v.title}] ${v.content}`);
      const factHits = (searchData.keywords?.facts || [])
        .map((f: { species_id: string; state_name: string; facts: string[] }) => `${f.species_id} ${f.state_name}: ${f.facts.join('; ')}`);
      const seasonHits = (searchData.keywords?.seasons || [])
        .map((s: { species_id: string; state_name: string; season_type: string; notes: string }) => `${s.species_id} ${s.state_name} ${s.season_type}: ${s.notes || ''}`);
      vectorContext = [...vectorHits, ...factHits, ...seasonHits].join('\n');

      // Build pattern card from top vector matches
      const patternMatches = filteredVector
        .filter((v) => v.similarity > 0.4)
        .slice(0, 5)
        .map((v) => ({
          title: v.title,
          content: v.content.length > 200 ? v.content.substring(0, 200) + '...' : v.content,
          similarity: v.similarity,
          content_type: v.content_type || 'unknown',
        }));
      if (patternMatches.length > 0) {
        cards.push({ type: 'pattern', data: { patterns: patternMatches } });
      }

      // Build source card
      const keywordCount = (searchData.keywords?.facts?.length || 0) + (searchData.keywords?.seasons?.length || 0);
      const contentTypes = [...new Set(filteredVector.map((v) => v.content_type || 'unknown'))];
      const similarities = filteredVector.map((v) => v.similarity);
      if (filteredVector.length > 0) {
        cards.push({
          type: 'source',
          data: {
            vectorCount: filteredVector.length,
            keywordCount,
            contentTypes,
            similarityRange: [Math.min(...similarities), Math.max(...similarities)],
          },
        });
      }
    }
  } catch { /* fall through to keyword only */ }

  // Keyword fallback if vector search failed
  if (!vectorContext) {
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
  }

  const searchResponse = await callClaude({
    model: CLAUDE_MODELS.haiku,
    system: `You are a hunting knowledge expert. Answer based on the provided context. Reference specific data and patterns when available. If the context doesn't have enough info, give your best general hunting knowledge answer. Be concise but informative.\nNever include external URLs, links, or website references in your response. Never recommend external websites or apps. All information comes from DuckCountdown's own data.`,
    messages: [{ role: 'user', content: `Context:\n${vectorContext}\n\nQuestion: ${query}` }],
    max_tokens: 300,
  });

  return {
    response: parseTextContent(searchResponse),
    cards,
  };
}

async function handleGeneral(message: string, species: string, stateAbbr: string | null, conversationContext: string) {
  const response = await callClaude({
    model: CLAUDE_MODELS.haiku,
    system: `You are the DuckCountdown AI — a friendly hunting season assistant. You help with US hunting seasons, weather, solunar data, and general hunting questions.
Current context: species=${species}, state=${stateAbbr || 'none'}.${species !== 'duck' ? `\nThe user is asking about ${species} hunting. You have species-specific knowledge including ${species === 'deer' ? 'rut timing, moon phase correlations, cold snap triggers, barometric pressure effects, and wind patterns' : species === 'turkey' ? 'gobble peak timing, weather sensitivity, roosting behavior, and calling strategies' : species === 'dove' ? 'migration timing, field rotation patterns, weather windows, and wind thresholds' : `${species}-specific patterns and behavior`} for their state and region.` : ''}
${conversationContext}
Be concise and helpful. 2-3 sentences max for casual chat.\nNever include external URLs, links, or website references in your response. Never recommend external websites or apps. All information comes from DuckCountdown's own data.`,
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
