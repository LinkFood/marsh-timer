import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors, getCorsHeaders } from '../_shared/cors.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { callClaude, callClaudeStream, parseToolUse, parseTextContent, calculateCost, CLAUDE_MODELS } from '../_shared/anthropic.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { searchWeb } from '../_shared/tavily.ts';
import type { TavilyResult } from '../_shared/tavily.ts';

interface HandlerResult {
  cards: unknown[];
  systemPrompt: string;
  userContent: string;
  mapAction?: { type: string; target: string };
}

const INTENT_TOOLS = [
  {
    name: 'route_intent',
    description: 'Route the user message to the appropriate handler based on intent',
    input_schema: {
      type: 'object',
      properties: {
        intent: {
          type: 'string',
          enum: ['weather', 'solunar', 'season_info', 'search', 'recent_activity', 'self_assessment', 'general'],
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
        date_from: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format if the user references a specific time period. Example: "February 2021" → "2021-02-01". Leave null if no time reference.',
        },
        date_to: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format. Example: "February 2021" → "2021-02-28". Leave null if no time reference.',
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
  date_from?: string | null;
  date_to?: string | null;
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
        content_types: null,  // Search full brain — tags organize output, never restrict input
        state_abbr: opts.state_abbr,
        species: opts.species,
        recency_weight: opts.recency_weight ?? 0.0,
        exclude_du_report: opts.exclude_du_report ?? false,
        limit: opts.limit || 5,
        date_from: opts.date_from || null,
        date_to: opts.date_to || null,
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

// The shared system prompt rules appended to every handler's system prompt
const BRAIN_RULES = `
CRITICAL RULES:
1. ONLY state facts that come from the provided context data. Never invent data.
2. When you reference brain data, prefix it with "📊 From our data:" or "📊 Based on [N] brain entries:"
3. When the brain has NO relevant data, say clearly: "The brain doesn't have specific data on this yet."
4. NEVER fill in with general knowledge when brain data is missing — acknowledge the gap instead.
5. If you must add general context beyond the data, clearly label it: "General context (not from brain data):"
6. Never include external URLs, links, or website references in your response. All information comes from the brain's embedded data.
7. You are an environmental intelligence system, not a chatbot. Lead with data. Be specific — state names, numbers, dates, signal types.
8. When suggesting follow-up questions, frame them around environmental signals and patterns, not hunting.
   Good: "What patterns are converging in Idaho right now?" / "How do current conditions compare to last year?" / "What usually follows when these conditions align?"
   Bad: "What patterns should I watch for duck hunting in Idaho?" / "Best spots for deer in Texas?"
`;

function createStreamingResponse(request: Request, handlerResult: HandlerResult, supabase: ReturnType<typeof createSupabaseClient>, userId: string | null, sessionId: string | null, originalMessage: string, intent: string): Response {
  const { cards, systemPrompt, userContent, mapAction } = handlerResult;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      // Send cards first
      send({ type: 'cards', cards });

      let fullText = '';

      try {
        const anthropicResponse = await callClaudeStream({
          model: CLAUDE_MODELS.sonnet,
          system: systemPrompt,
          messages: [{ role: 'user', content: userContent }],
        });

        const reader = anthropicResponse.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            if (line === 'data: [DONE]') continue;
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                const chunk = event.delta.text;
                fullText += chunk;
                send({ type: 'text', chunk });
              }
            } catch { /* skip malformed */ }
          }
        }

        send({ type: 'done', mapAction: mapAction || null });
      } catch (err) {
        const errMsg = `\n\nError: ${err instanceof Error ? err.message : 'Unknown error'}`;
        fullText += errMsg;
        send({ type: 'text', chunk: errMsg });
        send({ type: 'done', mapAction: null });
      } finally {
        // Store conversation after stream completes
        if (userId && sessionId && fullText) {
          supabase.from('hunt_conversations').insert([
            { user_id: userId, session_id: sessionId, role: 'user', content: originalMessage },
            { user_id: userId, session_id: sessionId, role: 'assistant', content: fullText, metadata: { cards, intent } },
          ]).then(() => {}).catch(e => console.warn('Conversation store failed:', e));
        }
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      ...getCorsHeaders(request),
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

// Execute a HandlerResult through the legacy non-streaming path (Sonnet)
async function executeLegacy(handlerResult: HandlerResult): Promise<{ response: string; cards: unknown[]; mapAction?: unknown }> {
  const response = await callClaude({
    model: CLAUDE_MODELS.sonnet,
    system: handlerResult.systemPrompt,
    messages: [{ role: 'user', content: handlerResult.userContent }],
    max_tokens: 4096,
  });
  return {
    response: parseTextContent(response),
    cards: handlerResult.cards,
    mapAction: handlerResult.mapAction,
  };
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
    const { message, species: ctxSpecies, stateAbbr: ctxState, sessionId, stream: useStreaming } = body;

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

    // Step 1: Intent classification (STAYS AS HAIKU)
    const classifySystemPrompt = `You are the Duck Countdown Brain — an environmental intelligence system monitoring patterns across 21 data sources for all 50 US states.
You analyze convergence signals from weather, wildlife migration, lunar cycles, satellite data, water levels, drought conditions, and more.
You can answer questions about environmental patterns, weather intelligence, wildlife movement, species activity, conditions, and season dates.

Current context:
- Selected species: ${ctxSpecies || 'all'}
- Selected state: ${ctxState || 'none'}
${conversationContext}

Classify the user's intent into one of: weather, solunar, season_info, search, recent_activity, self_assessment, general.

Use "weather" for questions about weather, wind, temperature, pressure, fronts, environmental conditions.
Use "solunar" for moon phase, tidal influence, activity cycles, solunar.
Use "season_info" for when does season open/close, seasonal transitions, regulatory dates.
Use "search" for searching for environmental knowledge, ecological patterns, historical data, general research.

Use "recent_activity" when the user asks:
- What's happening / what's going on / what's new
- What is the brain detecting / seeing / tracking
- Show me recent activity / recent data
- Any broad "status update" or "overview" questions
- "What should I know about right now?"

Use "self_assessment" when the user asks:
- How accurate are you / your predictions
- Have you been right / wrong / show me your track record
- How reliable are your alerts / what have you gotten wrong

Use "general" for greetings, casual chat, meta questions about the app.`;

    const classifyResponse = await callClaude({
      model: CLAUDE_MODELS.haiku,
      system: classifySystemPrompt,
      messages: [{ role: 'user', content: message }],
      tools: INTENT_TOOLS,
      tool_choice: { type: 'tool', name: 'route_intent' },
      max_tokens: 256,
      temperature: 0,
    });

    const toolUse = parseToolUse(classifyResponse);
    if (!toolUse) {
      // Fallback: general handler
      const handlerResult = await handleGeneral(message, ctxSpecies || 'all', ctxState, conversationContext);
      // Stage web discoveries (fire-and-forget)
      const fallbackWebResults = handlerResult._webResults;
      if (fallbackWebResults && fallbackWebResults.length > 0) {
        supabase.from('hunt_web_discoveries').insert(
          fallbackWebResults.map(r => ({
            query: message,
            source_url: r.url,
            title: r.title,
            content: r.content,
            state_abbr: ctxState,
            species: ctxSpecies || 'all',
          }))
        ).then(() => {}).catch(err => console.error('[Dispatcher] Failed to stage discoveries:', err));
      }
      if (useStreaming) {
        return createStreamingResponse(req, handlerResult, supabase, userId, sessionId, message, 'general');
      }
      const result = await executeLegacy(handlerResult);
      if (userId && sessionId) {
        await supabase.from('hunt_conversations').insert([
          { user_id: userId, session_id: sessionId, role: 'user', content: message },
          { user_id: userId, session_id: sessionId, role: 'assistant', content: result.response },
        ]);
      }
      return new Response(JSON.stringify(result), { status: 200, headers });
    }

    const { intent, state_abbr, species: intentSpecies, query, date_from: extractedDateFrom, date_to: extractedDateTo } = toolUse.input as {
      intent: string;
      state_abbr?: string;
      species?: string;
      query: string;
      date_from?: string;
      date_to?: string;
    };
    const dateFrom = extractedDateFrom || null;
    const dateTo = extractedDateTo || null;

    const resolvedState = state_abbr || ctxState;
    const resolvedSpecies = intentSpecies || ctxSpecies || 'all';

    // Intercept comparison queries BEFORE intent routing
    const compareMatch = message.match(/compare\s+(\w{2})\s+(?:vs?\.?|and|or|versus)\s+(\w{2})/i)
      || message.match(/(\w{2})\s+vs\.?\s+(\w{2})/i);
    if (compareMatch) {
      const s1 = compareMatch[1].toUpperCase();
      const s2 = compareMatch[2].toUpperCase();
      if (s1.length === 2 && s2.length === 2 && s1 !== s2) {
        const handlerResult = await handleCompare(s1, s2, message, resolvedSpecies);
        if (useStreaming) {
          return createStreamingResponse(req, handlerResult, supabase, userId, sessionId, message, 'compare');
        }
        const result = await executeLegacy(handlerResult);
        if (userId && sessionId) {
          await supabase.from('hunt_conversations').insert([
            { user_id: userId, session_id: sessionId, role: 'user', content: message },
            { user_id: userId, session_id: sessionId, role: 'assistant', content: result.response, metadata: { cards: result.cards, intent: 'compare' } },
          ]);
        }
        return new Response(JSON.stringify(result), { status: 200, headers });
      }
    }

    let handlerResult: HandlerResult;

    switch (intent) {
      case 'weather':
        if (!resolvedState) {
          handlerResult = await handleSearch(query, resolvedSpecies, null, dateFrom, dateTo);
        } else {
          handlerResult = await handleWeather(supabase, resolvedState, query, resolvedSpecies);
        }
        break;
      case 'solunar':
        handlerResult = await handleSolunar(supabase, resolvedState, query);
        break;
      case 'season_info':
        handlerResult = await handleSeasonInfo(supabase, resolvedSpecies, resolvedState, query);
        break;
      case 'search':
        handlerResult = await handleSearch(query, resolvedSpecies, resolvedState, dateFrom, dateTo);
        break;
      case 'recent_activity':
        handlerResult = await handleRecentActivity(supabase, resolvedSpecies, resolvedState, message);
        break;
      case 'self_assessment':
        handlerResult = await handleSelfAssessment(supabase, resolvedSpecies, resolvedState, message);
        break;
      default:
        handlerResult = await handleGeneral(message, resolvedSpecies, resolvedState, conversationContext, dateFrom, dateTo);
        break;
    }

    // Stage web discoveries (fire-and-forget, don't block response)
    const webResults = (handlerResult as HandlerResult & { _webResults?: TavilyResult[] })._webResults;
    if (webResults && webResults.length > 0) {
      supabase.from('hunt_web_discoveries').insert(
        webResults.map(r => ({
          query: message,
          source_url: r.url,
          title: r.title,
          content: r.content,
          state_abbr: resolvedState,
          species: resolvedSpecies,
        }))
      ).then(() => {}).catch(err => console.error('[Dispatcher] Failed to stage discoveries:', err));
    }

    if (useStreaming) {
      return createStreamingResponse(req, handlerResult, supabase, userId, sessionId, message, intent);
    }

    // Legacy non-streaming path (now uses Sonnet)
    const result = await executeLegacy(handlerResult);

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

async function handleRecentActivity(
  supabase: any, species: string | null, stateAbbr: string | null, userMessage: string
): Promise<HandlerResult> {
  const cards: any[] = [];
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  // 1. Count recent entries by content_type
  let recentQuery = supabase
    .from('hunt_knowledge')
    .select('content_type')
    .gte('created_at', twentyFourHoursAgo.toISOString())
    .limit(1000);
  if (stateAbbr) recentQuery = recentQuery.eq('state_abbr', stateAbbr);
  const { data: recentCounts } = await recentQuery;

  const typeCounts: Record<string, number> = {};
  (recentCounts || []).forEach((r: any) => {
    typeCounts[r.content_type] = (typeCounts[r.content_type] || 0) + 1;
  });

  // 2. High-signal entries (last 48h)
  const highSignalTypes = ['nws-alert','weather-event','migration-spike-extreme','migration-spike-significant','anomaly-alert','disaster-watch','convergence-score','correlation-discovery'];
  let highQuery = supabase
    .from('hunt_knowledge')
    .select('id, title, content_type, state_abbr, metadata, created_at')
    .in('content_type', highSignalTypes)
    .gte('created_at', fortyEightHoursAgo.toISOString())
    .order('created_at', { ascending: false })
    .limit(30);
  if (stateAbbr) highQuery = highQuery.eq('state_abbr', stateAbbr);
  const { data: highSignals } = await highQuery;

  // 3. Most active states
  const stateCounts: Record<string, number> = {};
  (highSignals || []).forEach((s: any) => {
    if (s.state_abbr) stateCounts[s.state_abbr] = (stateCounts[s.state_abbr] || 0) + 1;
  });
  const topStates = Object.entries(stateCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // 4. Latest cron activity
  const { data: recentCrons } = await supabase
    .from('hunt_cron_log')
    .select('function_name, status, summary, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  // 5. Activity card
  cards.push({
    type: 'activity',
    data: {
      total_24h: recentCounts?.length || 0,
      by_type: typeCounts,
      high_signal_count: highSignals?.length || 0,
      top_states: topStates,
      latest_cron: recentCrons?.[0]?.function_name || 'unknown',
      latest_cron_ago: recentCrons?.[0]?.created_at || null,
    }
  });

  // 6. Top signals as pattern cards
  const topSignals = (highSignals || []).slice(0, 8);
  if (topSignals.length > 0) {
    cards.push({
      type: 'pattern',
      data: {
        patterns: topSignals.map((s: any) => ({
          title: s.title,
          content: s.title,
          content_type: s.content_type,
          state_abbr: s.state_abbr,
          similarity: 1.0,
        })),
      }
    });
    cards.push({
      type: 'source',
      data: {
        vectorCount: highSignals.length,
        keywordCount: 0,
        contentTypes: [...new Set(topSignals.map((s: any) => s.content_type))],
        similarityRange: [1.0, 1.0],
      }
    });
  }

  // 7. Build context for Sonnet
  const contextLines = [
    `## Brain Activity Summary (last 24 hours)`,
    `Total new entries: ${recentCounts?.length || 0}`,
    `### Entries by type:`,
    ...Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).map(([type, count]) => `- ${type}: ${count}`),
    `### High-signal events (last 48 hours):`,
    ...topSignals.map((s: any) => `- [${s.content_type}] ${s.state_abbr || 'National'}: ${s.title} (${s.created_at})`),
    `### Most active states:`,
    ...topStates.map(([st, count]) => `- ${st}: ${count} high-signal events`),
    `### Latest pipeline activity:`,
    ...(recentCrons || []).slice(0, 5).map((c: any) => `- ${c.function_name}: ${c.status} at ${c.created_at}`),
  ];

  return {
    cards,
    systemPrompt: `You are the environmental intelligence brain. The user is asking what's happening right now.${stateAbbr ? ` Focus on ${stateAbbr}.` : ''} Synthesize the data into a clear situational briefing. Lead with the most interesting signals. Group by theme (weather, alerts, migration, anomalies). Be specific — use state names, event types, counts. End with 1-2 suggested follow-up questions.\n\n${BRAIN_RULES}`,
    userContent: `${userMessage}\n\n---\n\n${contextLines.join('\n')}`,
  };
}

async function handleSelfAssessment(
  supabase: any, species: string | null, stateAbbr: string | null, userMessage: string
): Promise<HandlerResult> {
  const cards: any[] = [];

  const { data: calibrations } = await supabase
    .from('hunt_alert_calibration')
    .select('*')
    .eq('window_days', 90)
    .order('accuracy_rate', { ascending: false });

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentGrades } = await supabase
    .from('hunt_knowledge')
    .select('title, content, content_type, state_abbr, metadata, created_at')
    .in('content_type', ['alert-grade','alert-calibration','forecast-accuracy','migration-report-card','convergence-report-card'])
    .gte('created_at', thirtyDaysAgo)
    .order('created_at', { ascending: false })
    .limit(20);

  if (recentGrades?.length > 0) {
    cards.push({
      type: 'pattern',
      data: {
        patterns: recentGrades.map((g: any) => ({
          title: g.title, content: g.content?.slice(0, 200) || '', content_type: g.content_type,
          state_abbr: g.state_abbr, similarity: 1.0,
        })),
      }
    });
    cards.push({
      type: 'source',
      data: {
        vectorCount: recentGrades.length, keywordCount: 0,
        contentTypes: [...new Set(recentGrades.map((g: any) => g.content_type))],
        similarityRange: [1.0, 1.0],
      }
    });
  }

  const contextLines = [
    `## Brain Self-Assessment Data`,
    `### Alert Calibration (90-day rolling):`,
    ...(calibrations || []).map((c: any) =>
      `- ${c.alert_source}${c.state_abbr ? ` (${c.state_abbr})` : ' (national)'}: ${(Number(c.accuracy_rate) * 100).toFixed(0)}% accuracy over ${c.total_alerts} alerts`
    ),
    `### Recent Grades (last 30 days):`,
    ...(recentGrades || []).map((g: any) => `- [${g.content_type}] ${g.title}`),
  ];

  return {
    cards,
    systemPrompt: `You are reporting on your own prediction accuracy. Be honest and specific. Show numbers. If accuracy is low, say so. If no calibration data exists yet, say honestly: "The self-grading system just started — check back in a week."\n\n${BRAIN_RULES}`,
    userContent: `${userMessage}\n\n---\n\n${contextLines.join('\n')}`,
  };
}

async function handleWeather(supabase: ReturnType<typeof createSupabaseClient>, stateAbbr: string | null, query: string, species: string = 'all'): Promise<HandlerResult> {
  if (!stateAbbr) {
    return {
      cards: [],
      systemPrompt: 'You are a helpful assistant.',
      userContent: 'Which state are you interested in? Select one on the map or tell me.',
    };
  }

  const { data: state } = await supabase
    .from('hunt_states')
    .select('centroid_lat, centroid_lng, name')
    .eq('abbreviation', stateAbbr)
    .maybeSingle();

  if (!state?.centroid_lat) {
    return {
      cards: [],
      systemPrompt: 'You are a helpful assistant.',
      userContent: `I don't have location data for ${stateAbbr} yet.`,
    };
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
      query: `${state.name} environmental weather conditions ${query}`,
      content_types: undefined,  // Search full brain — cross-domain discovery
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
    return {
      cards: [],
      systemPrompt: 'You are a helpful assistant.',
      userContent: `Couldn't fetch weather for ${state.name}. Try again later.`,
    };
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
    cards,
    systemPrompt: `You are an environmental weather analyst. Synthesize weather data into a situational intelligence briefing. Lead with what's unusual — front passages, pressure anomalies, temperature shifts. Connect weather events to downstream effects: migration, wildlife behavior, historical pattern matches. Be specific with numbers and states.
${BRAIN_RULES}`,
    userContent: `Live weather data:\nTemp: ${temp}°F, Wind: ${wind} mph, Precip: ${precip}mm\n\nSeason status: ${seasonStatus.status}${seasonStatus.isOpen ? '' : ' — SEASON IS CLOSED. Note this in your response.'}\n\nBrain historical patterns (${brainResults.length} matches):\n${patternInsight || 'No brain matches found.'}\n${linksInsight}\n\nQuery: ${query}`,
    mapAction: { type: 'flyTo', target: stateAbbr },
  };
}

async function handleSolunar(supabase: ReturnType<typeof createSupabaseClient>, stateAbbr: string | null, query: string): Promise<HandlerResult> {
  if (!stateAbbr) {
    return {
      cards: [],
      systemPrompt: 'You are a helpful assistant.',
      userContent: 'Which state? Select one on the map or tell me.',
    };
  }

  const { data: state } = await supabase
    .from('hunt_states')
    .select('centroid_lat, centroid_lng, name')
    .eq('abbreviation', stateAbbr)
    .maybeSingle();

  if (!state?.centroid_lat) {
    return {
      cards: [],
      systemPrompt: 'You are a helpful assistant.',
      userContent: `I don't have location data for ${stateAbbr}.`,
    };
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
      query: `${state.name} solunar moon phase activity patterns ${query}`,
      content_types: undefined,  // Search full brain — cross-domain discovery
      state_abbr: stateAbbr,
      recency_weight: 0.3,
      exclude_du_report: true,
      limit: 3,
      min_similarity: 0.35,
    }),
  ]);

  if (!solunarRes.ok) {
    return {
      cards: [],
      systemPrompt: 'You are a helpful assistant.',
      userContent: `Couldn't fetch solunar data for ${state.name}.`,
    };
  }

  const data = await solunarRes.json();
  const solunar = data.solunar || {};
  const sunrise = data.sunrise || {};

  let brainContext = '';
  if (brainResults.length > 0) {
    brainContext = `\n\nBrain data (${brainResults.length} entries):\n${brainResults.map(v => `[${v.title}] ${v.content}`).join('\n')}`;
  }

  return {
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
    systemPrompt: `You are a solunar and lunar phase analyst for environmental pattern analysis. Summarize the solunar forecast briefly, noting key activity windows and moon phase. 2-3 sentences max.
${BRAIN_RULES}`,
    userContent: `Solunar forecast for ${state.name} today:\nRating: ${solunar.dayRating || 'N/A'}/5\nMoon phase: ${solunar.moonPhase || 'N/A'}\nMajor periods: ${[solunar.major1Start, solunar.major2Start].filter(Boolean).join(', ') || 'N/A'}\nMinor periods: ${[solunar.minor1Start, solunar.minor2Start].filter(Boolean).join(', ') || 'N/A'}\nSunrise: ${sunrise.sunrise || 'N/A'}\nSunset: ${sunrise.sunset || 'N/A'}${brainContext}\n\nQuery: ${query}`,
    mapAction: { type: 'flyTo', target: stateAbbr },
  };
}

async function handleSeasonInfo(supabase: ReturnType<typeof createSupabaseClient>, species: string, stateAbbr: string | null, query: string): Promise<HandlerResult> {
  if (!stateAbbr) {
    return {
      cards: [],
      systemPrompt: 'You are a helpful assistant.',
      userContent: 'Which state are you asking about? Select one on the map or tell me.',
    };
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
      query: `${species} seasonal patterns regulations ${stateAbbr} ${query}`,
      content_types: undefined,  // Search full brain — cross-domain discovery
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
    return {
      cards: [],
      systemPrompt: 'You are a helpful assistant.',
      userContent: `No ${species} season data found for ${stateAbbr}.`,
    };
  }

  const now = new Date();
  const cards: unknown[] = seasons.map((s: Record<string, unknown>) => {
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
    cards,
    systemPrompt: `You are a species behavior and regulatory expert. Summarize the season information briefly. Include key dates and bag limits. 2-3 sentences.
ONLY state facts directly from the provided JSON data. Never invent or assume zone names, dates, bag limits, or details not present in the data. If information is missing or incomplete, explicitly say "I don't have that specific data" rather than guessing.
${BRAIN_RULES}`,
    userContent: `${species} seasons in ${stateAbbr}: ${JSON.stringify(seasons.map((s: Record<string, unknown>) => ({ type: s.season_type, zone: s.zone, dates: s.dates, bag: s.bag_limit })))}. User asked: ${query}${brainContext}`,
    mapAction: { type: 'flyTo', target: stateAbbr },
  };
}

async function handleCompare(state1: string, state2: string, query: string, species: string): Promise<HandlerResult> {
  const supabase = createSupabaseClient();

  const [conv1, conv2, s1Status, s2Status] = await Promise.all([
    supabase.from('hunt_convergence_scores').select('*').eq('state_abbr', state1).order('date', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('hunt_convergence_scores').select('*').eq('state_abbr', state2).order('date', { ascending: false }).limit(1).maybeSingle(),
    getSeasonStatus(species, state1),
    getSeasonStatus(species, state2),
  ]);

  const c1 = conv1.data;
  const c2 = conv2.data;

  let context = `Comparing ${state1} vs ${state2} for ${species} environmental conditions:\n`;
  if (c1) context += `\n${state1}: Score ${c1.score}/100 (rank #${c1.national_rank}). Weather: ${c1.weather_component}/25, Solunar: ${c1.solunar_component}/15, Migration: ${c1.migration_component}/25, BirdCast: ${c1.birdcast_component}/20, Pattern: ${c1.pattern_component}/15. ${c1.reasoning}`;
  if (c2) context += `\n${state2}: Score ${c2.score}/100 (rank #${c2.national_rank}). Weather: ${c2.weather_component}/25, Solunar: ${c2.solunar_component}/15, Migration: ${c2.migration_component}/25, BirdCast: ${c2.birdcast_component}/20, Pattern: ${c2.pattern_component}/15. ${c2.reasoning}`;
  context += `\n\nSeason status: ${state1}: ${s1Status.status} | ${state2}: ${s2Status.status}`;

  const cards: unknown[] = [];
  if (c1) cards.push({ type: 'convergence', data: { stateAbbr: c1.state_abbr, score: c1.score, weatherComponent: c1.weather_component, solunarComponent: c1.solunar_component, migrationComponent: c1.migration_component, birdcastComponent: c1.birdcast_component, patternComponent: c1.pattern_component, nationalRank: c1.national_rank, reasoning: c1.reasoning } });
  if (c2) cards.push({ type: 'convergence', data: { stateAbbr: c2.state_abbr, score: c2.score, weatherComponent: c2.weather_component, solunarComponent: c2.solunar_component, migrationComponent: c2.migration_component, birdcastComponent: c2.birdcast_component, patternComponent: c2.pattern_component, nationalRank: c2.national_rank, reasoning: c2.reasoning } });

  return {
    cards,
    systemPrompt: `You are an environmental analyst comparing two states. Use the provided convergence scores and brain data to give a clear recommendation. Format as a side-by-side comparison with a verdict. Be specific — cite scores, bird counts, and conditions.
ONLY reference data provided in the context. If data is missing for a state, say so.
${BRAIN_RULES}`,
    userContent: `${context}\n\nQuestion: ${query}`,
    mapAction: { type: 'flyTo', target: c1 && c2 ? (c1.score >= c2.score ? state1 : state2) : state1 },
  };
}

async function handleSearch(query: string, species: string = 'all', stateAbbr?: string | null, dateFrom?: string | null, dateTo?: string | null): Promise<HandlerResult> {
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
  const searchQuery = species && species !== 'all' ? `${species} ${query}` : query;

  // Check if this is a comparative query (no state, asking about "best" or "where")
  const isComparative = !stateAbbr && /\b(best|top|where|which state|compare|recommend)\b/i.test(query);

  const supabase = createSupabaseClient();
  const [brainResults, patternLinks, topStatesResult] = await Promise.all([
    searchBrain({
      query: searchQuery,
      species: species,
      state_abbr: stateAbbr || undefined,
      recency_weight: (dateFrom || dateTo) ? 0.0 : 0.3,  // No recency bias when searching historical dates
      exclude_du_report: !mentionsDU,
      limit: 8,
      min_similarity: 0.3,
      date_from: dateFrom,
      date_to: dateTo,
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

  // Web search if brain is thin
  let webContext = '';
  let webResults: TavilyResult[] = [];
  const brainIsThin = !brainResults || brainResults.length < 3;
  if (brainIsThin) {
    webResults = await searchWeb(query, {
      maxResults: 5,
      searchDepth: 'advanced',
      includeDomains: ['noaa.gov', 'usgs.gov', 'ebird.org', 'weather.gov', 'nasa.gov', 'drought.gov'],
    });
    if (webResults.length > 0) {
      webContext = '\n\nWEB RESEARCH (cite source if used):\n' +
        webResults.map(r => `[${r.title}] (${r.url})\n${r.content}`).join('\n\n');
    }
  }

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

  let topStatesContext = '';
  if (topStatesResult.data && topStatesResult.data.length > 0) {
    topStatesContext = `\n\nTop states by convergence score right now:\n${topStatesResult.data.map((s: { state_abbr: string; score: number; reasoning: string; national_rank: number }) => `#${s.national_rank} ${s.state_abbr}: ${s.score}/100 — ${s.reasoning}`).join('\n')}`;
    topStatesContext += `\n\nNote: Check season dates before recommending — some of these states may have closed seasons right now.`;
  }

  const similarities = brainResults.map(v => v.similarity);
  const minSim = similarities.length > 0 ? Math.min(...similarities).toFixed(2) : '0';
  const maxSim = similarities.length > 0 ? Math.max(...similarities).toFixed(2) : '0';

  return {
    cards,
    systemPrompt: `You are an environmental intelligence analyst with access to a brain containing 591K+ embedded data entries across weather, migration, water, drought, NWS alerts, solunar, convergence scores, and historical patterns. Synthesize the provided context. When patterns match, explain what happened historically when these conditions aligned. Cite brain entry counts and content types.
${BRAIN_RULES}`,
    userContent: `Brain data (${brainResults.length} entries found${brainResults.length > 0 ? `, confidence ${minSim}-${maxSim}` : ''}):\n${vectorContext || 'No brain matches found.'}\n\nIMPORTANT: Only reference the brain data above. If the data doesn't answer the question, say "The brain doesn't have data on this yet."${linksContext}${topStatesContext}${webContext}\n\nQuestion: ${query}`,
    _webResults: webResults,
  } as HandlerResult & { _webResults: TavilyResult[] };
}

async function handleGeneral(message: string, species: string, stateAbbr: string | null, conversationContext: string = '', dateFrom?: string | null, dateTo?: string | null): Promise<HandlerResult & { _webResults?: TavilyResult[] }> {
  // Light brain search — only include if high-similarity matches exist
  const brainResults = await searchBrain({
    query: message,
    recency_weight: (dateFrom || dateTo) ? 0.0 : 0.2,  // No recency bias when searching historical dates
    exclude_du_report: true,
    limit: (dateFrom || dateTo) ? 8 : 3,  // More results for historical queries
    min_similarity: (dateFrom || dateTo) ? 0.3 : 0.5,  // Lower threshold for historical queries
    date_from: dateFrom,
    date_to: dateTo,
  });

  // Web search if brain is thin
  let webContext = '';
  let webResults: TavilyResult[] = [];
  const brainIsThin = !brainResults || brainResults.length < 3;
  if (brainIsThin) {
    webResults = await searchWeb(message, {
      maxResults: 5,
      searchDepth: 'advanced',
      includeDomains: ['noaa.gov', 'usgs.gov', 'ebird.org', 'weather.gov', 'nasa.gov', 'drought.gov'],
    });
    if (webResults.length > 0) {
      webContext = '\n\nWEB RESEARCH (cite source if used):\n' +
        webResults.map(r => `[${r.title}] (${r.url})\n${r.content}`).join('\n\n');
    }
  }

  let brainContext = '';
  if (brainResults.length > 0) {
    brainContext = `\n\nRelevant knowledge (cite if useful):\n${brainResults.map(v => `[${v.title}] ${v.content}`).join('\n')}`;
  }

  return {
    cards: [],
    systemPrompt: `You are an environmental intelligence engine tracking patterns across weather, migration, water levels, pressure, solunar cycles, drought, and wildlife behavior across all 50 US states. You synthesize data from 21+ sources. Adapt your framing to the user's context — environmental research, agriculture, ecology, weather, or general awareness. Your core function is environmental pattern recognition.${species && species !== 'all' ? `\nCurrent species context: ${species}. State: ${stateAbbr || 'none'}.` : ''}
${conversationContext}${brainContext}${webContext}
Be concise and helpful. 2-3 sentences max for casual chat.
${BRAIN_RULES}`,
    userContent: message,
    _webResults: webResults,
  };
}
