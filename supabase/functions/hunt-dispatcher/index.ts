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
  /** Provenance chips — the receipts law (blueprint §3): which real tables/lanes the answer's numbers came from. */
  receipts?: string[];
  /** Typed deep-links — every answer carries at least one door deeper into the site. */
  doors?: Array<{ label: string; href: string }>;
}

/** "Today" as an American day (US Eastern), mirroring hunt-morning-line. */
function isoTodayEt(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

// THE RECEIPTS LAW (blueprint §3, enforced in the pipe): every answer ends
// with provenance chips + at least one door deeper. Handlers set their own
// precise receipts/doors; this fills honest defaults for any path that didn't,
// so no intent can ship an answer without them.
function withReceipts<T extends HandlerResult>(
  result: T,
  intent: string,
  stateAbbr?: string | null,
  dateIso?: string | null,
): T {
  if (!result.doors || result.doors.length === 0) {
    const atlas = { label: 'The Atlas →', href: stateAbbr ? `/atlas?state=${stateAbbr}` : '/atlas' };
    const museum = { label: 'The museum, any date →', href: `/date/${dateIso || isoTodayEt()}` };
    switch (intent) {
      case 'planting':
        result.doors = [{ label: 'The full planting table →', href: stateAbbr ? `/plant?state=${stateAbbr}` : '/plant' }];
        break;
      case 'forming':
        result.doors = [{ label: 'The live board →', href: '/' }, { label: 'The Morning Line →', href: '/morning' }];
        break;
      case 'self_assessment':
      case 'docket':
        result.doors = [{ label: 'The Court →', href: '/court' }];
        break;
      case 'day_read':
      case 'date_compare':
      case 'date_portrait':
        result.doors = [museum, atlas];
        break;
      case 'weather':
      case 'recent_activity':
      case 'compare':
        result.doors = [{ label: "Today's board →", href: '/' }, atlas];
        break;
      case 'solunar':
        result.doors = [{ label: "Today's board →", href: '/' }];
        break;
      case 'season_info':
        result.doors = [atlas];
        break;
      default:
        result.doors = [museum, atlas];
        break;
    }
  }
  if (!result.receipts || result.receipts.length === 0) {
    const RECEIPTS: Record<string, string[]> = {
      planting: ['planting_climatology · ghcn-daily (NOAA ACIS)'],
      forming: ['formation_watches (live)', 'hunt_nws_alerts'],
      day_read: ['atlas dossier · that-day rows'],
      weather: ['open-meteo live', 'hunt_knowledge archive'],
      solunar: ['computed astronomy (hunt-solunar)'],
      season_info: ['hunt_seasons'],
      recent_activity: ['hunt_knowledge · last 24–48h', 'hunt_cron_log'],
      self_assessment: ['hunt_alert_outcomes · v2 matched-control grades'],
      docket: ['hunt_claims · hunt_claim_fires'],
      date_compare: ['hunt_knowledge · effective_date query'],
      date_portrait: ['hunt_knowledge · effective_date query'],
      compare: ['hunt_knowledge · effective_date query'],
    };
    result.receipts = RECEIPTS[intent] ?? ['hunt_knowledge · vector search (7.6M rows)'];
  }
  return result;
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
          enum: ['weather', 'solunar', 'season_info', 'search', 'pattern_query', 'recent_activity', 'self_assessment', 'docket', 'planting', 'forming', 'day_read', 'general'],
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

// Fetch recent pattern links for a state via RPC (or top national links when no state)
async function getRecentPatternLinks(stateAbbr: string | null, limit = 5): Promise<Array<{
  source_title: string;
  source_content_type: string;
  matched_title: string;
  matched_content_type: string;
  matched_content: string;
  similarity: number;
  created_at: string;
}>> {
  try {
    const supabase = createSupabaseClient();
    if (stateAbbr) {
      const { data } = await supabase.rpc('get_recent_pattern_links', {
        p_state_abbr: stateAbbr,
        p_limit: limit,
        p_hours_back: 72,
      });
      return data || [];
    }
    // National: fetch top links across all states, ordered by similarity
    const { data } = await supabase
      .from('hunt_pattern_links')
      .select('source_title, source_content_type, matched_title, matched_content_type, matched_content, similarity, created_at')
      .gte('created_at', new Date(Date.now() - 72 * 3600000).toISOString())
      .order('similarity', { ascending: false })
      .limit(limit);
    return data || [];
  } catch {
    return [];
  }
}

// Fetch national-level context: moon, space weather, drought
async function getNationalContext(): Promise<string> {
  try {
    const supabase = createSupabaseClient();
    const today = new Date().toISOString().split('T')[0];

    const [moonRes, spaceRes, droughtRes] = await Promise.all([
      // Moon phase from solunar calendar
      supabase
        .from('hunt_solunar_calendar')
        .select('moon_phase, illumination_pct, is_prime')
        .eq('date', today)
        .limit(1)
        .maybeSingle(),
      // Latest space weather
      supabase
        .from('hunt_knowledge')
        .select('title, content')
        .eq('content_type', 'space-weather')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      // Latest drought summary
      supabase
        .from('hunt_knowledge')
        .select('title, content')
        .eq('content_type', 'drought-monitor')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const parts: string[] = [];
    if (moonRes.data) {
      parts.push(`Moon: ${moonRes.data.moon_phase}, ${moonRes.data.illumination_pct}% illumination${moonRes.data.is_prime ? ' (PRIME day)' : ''}`);
    }
    if (spaceRes.data) {
      parts.push(`Space weather: ${spaceRes.data.content?.slice(0, 200) || spaceRes.data.title}`);
    }
    if (droughtRes.data) {
      parts.push(`Drought: ${droughtRes.data.content?.slice(0, 200) || droughtRes.data.title}`);
    }

    return parts.length > 0
      ? `\n\nNational context (today):\n${parts.join('\n')}`
      : '';
  } catch {
    return '';
  }
}

// Real-event context — bounded, indexed counts of recent high-signal events.
// This replaces the retired convergence score everywhere: the score was proven
// to be a seasonal index with no predictive signal and must never be presented
// as meaning. Counts of real archive events are honest; a 0-100 score is not.
async function getRecentEventContext(stateAbbr: string | null): Promise<string> {
  try {
    const supabase = createSupabaseClient();
    const since = new Date(Date.now() - 48 * 3600000).toISOString();
    const CAP = 50;
    const fetchGroup = async (types: string[]) => {
      let q = supabase
        .from('hunt_knowledge')
        .select('title, state_abbr, created_at')
        .in('content_type', types)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(CAP);
      if (stateAbbr) q = q.eq('state_abbr', stateAbbr);
      const { data } = await q;
      return data || [];
    };
    const [anomalies, migrationSpikes, nwsAlerts] = await Promise.all([
      fetchGroup(['anomaly-alert']),
      fetchGroup(['migration-spike', 'migration-spike-extreme', 'migration-spike-significant']),
      fetchGroup(['nws-alert']),
    ]);
    const fmt = (label: string, rows: Array<{ title: string; state_abbr?: string | null }>) => {
      const count = rows.length >= CAP ? `${CAP}+` : String(rows.length);
      const samples = rows.slice(0, 3).map(r => `${r.state_abbr || 'national'}: ${r.title}`).join(' | ');
      return `- ${label}: ${count} entries${samples ? ` (e.g. ${samples})` : ''}`;
    };
    return `\n\nReal events in the archive${stateAbbr ? ` for ${stateAbbr}` : ' (national)'} — last 48 hours:\n${fmt('Anomaly alerts', anomalies)}\n${fmt('Migration spikes', migrationSpikes)}\n${fmt('NWS alerts', nwsAlerts)}`;
  } catch {
    return '';
  }
}

// Check if a season is currently open for a species/state
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
SYSTEM CAPABILITY: You have access to 7.6M+ environmental data entries across 83+ content types, covering all 50 US states from 1950 to present. Sources include NOAA storm events, USGS water levels, earthquake data, BirdCast radar migration, photoperiod, tidal, geomagnetic, fire activity, drought, crop data, and more. 88 automated crons continuously ingest new data.

TODAY'S DATE: ${new Date().toISOString().split('T')[0]}. Any date on or before today is a PAST date with potential data. Do NOT say a date is "in the future" if it is today or earlier.

CRITICAL RULES:
1. ANSWER THE QUESTION FIRST in 2-3 clear, direct sentences. Be opinionated. Lead with what matters most. State your assessment before showing evidence.
2. THEN provide supporting evidence organized by theme, not as a data dump. Use short paragraphs, not exhaustive lists.
3. ONLY state facts that come from the provided context data. Never invent data.
4. When you reference brain data, prefix it with "From our data:" or "Based on [N] brain entries:"
5. When the brain has NO relevant data, say clearly: "The brain doesn't have specific data on this yet."
6. NEVER fill in with general knowledge when brain data is missing — acknowledge the gap instead.
7. If you must add general context beyond the data, clearly label it: "General context (not from brain data):"
8. Never include external URLs, links, or website references in your response. All information comes from the brain's embedded data.
9. You are an environmental intelligence system, not a chatbot. Lead with data. Be specific — state names, numbers, dates, signal types.
10. When suggesting follow-up questions, frame them around what the archive can actually show, not hunting.
   Good: "What does the archive show for Idaho this week?" / "How do current conditions compare to last year?" / "What usually followed when these conditions aligned — and how often?"
   Bad: "What patterns should I watch for duck hunting in Idaho?" / "Best spots for deer in Texas?"
11. Never present convergence scores as prediction or signal — the metric was retired after failing validation. When citing patterns, include denominators (appeared N times, outcome followed K). Prefer "the archive shows" over "the brain predicts".
12. Web results are NOT archive data. If you use a provided web result, you MUST attribute it explicitly as "(from the web, not the archive)". Never blend web content into "From our data:" claims.
13. THE HONESTY RAIL: you never forecast and never register claims. You narrate rows the handlers already fetched and claims the court already holds. Never say what WILL happen — only what is recorded, with denominators. The system attaches provenance receipts and door links under your answer automatically — do not fabricate your own citations or append a sources list of your own.
`;

function createStreamingResponse(request: Request, handlerResult: HandlerResult, supabase: ReturnType<typeof createSupabaseClient>, userId: string | null, sessionId: string | null, originalMessage: string, intent: string): Response {
  const { cards, systemPrompt, userContent, mapAction, receipts, doors } = handlerResult;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      // Send cards first, then the receipts contract (provenance chips + doors)
      send({ type: 'cards', cards });
      send({ type: 'receipts', receipts: receipts ?? [], doors: doors ?? [] });

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
          ]).then(() => {}, (e: unknown) => console.warn('Conversation store failed:', e));
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
async function executeLegacy(handlerResult: HandlerResult): Promise<{ response: string; cards: unknown[]; mapAction?: unknown; receipts: string[]; doors: Array<{ label: string; href: string }> }> {
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
    receipts: handlerResult.receipts ?? [],
    doors: handlerResult.doors ?? [],
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
You analyze cross-domain patterns from weather, wildlife migration, lunar cycles, satellite data, water levels, drought conditions, and more.
You can answer questions about environmental patterns, weather intelligence, wildlife movement, species activity, conditions, and season dates.

Current context:
- Today's date: ${isoTodayEt()}
- Selected species: ${ctxSpecies || 'all'}
- Selected state: ${ctxState || 'none'}
${conversationContext}

Classify the user's intent into one of: weather, solunar, season_info, search, pattern_query, recent_activity, self_assessment, docket, planting, forming, day_read, general.

Use "planting" for planting and frost questions — when to plant (tomatoes, a garden, any crop), last/first frost or freeze dates, growing-season length, "is it safe to plant yet". Examples: "when do I plant tomatoes?" → planting. "When's the last frost in Maryland?" → planting. "How long is the growing season in Vermont?" → planting. (Regulatory hunting-season dates stay "season_info".)

Use "forming" when the user asks what is forming, brewing, or developing right now: "what's forming?" → forming. "Any watches?" → forming. "Is anything coming?" → forming. "Anything developing I should know about?" → forming.

Use "day_read" when the user asks what a SINGLE specific calendar date was like or what happened on it: "what happened on July 4 1990 in Maryland?" → day_read (date_from 1990-07-04). "What was today like?" → day_read with date_from null (the system fills in today's date — NEVER guess a date the user didn't name). "Tell me about March 13, 1993 in Virginia" → day_read (date_from 1993-03-13). Extract the named date into date_from and leave date_to null. Prefer day_read over search or general for any single-date "what happened / what was it like" question.

Use "weather" for questions about weather, wind, temperature, pressure, fronts, environmental conditions.
Use "solunar" for moon phase, tidal influence, activity cycles, solunar.
Use "season_info" for when does season open/close, seasonal transitions, regulatory dates.
Use "search" for searching for environmental knowledge, ecological patterns, historical data, general research.

Use "pattern_query" when the user asks cross-domain conditional questions like:
- "Every time X happened, what followed?"
- "When has AO been below -2 during La Nina?"
- "Find dates where drought and earthquakes coincided"
- "What storms followed when climate indices looked like this?"
- Any question asking to cross-reference multiple data types by date to find patterns
- Questions with "every time", "when has", "find dates where", "what happened when X and Y"

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

Use "docket" when the user asks about the claim court, the docket, or standing claims:
- What's on the docket / what claims are open / any verdicts
- Has a claim fired / been confirmed / beaten its controls
- Show me the court's receipts / claim track record / lift numbers

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
      const handlerResult = withReceipts(
        await handleGeneral(message, ctxSpecies || 'all', ctxState, conversationContext),
        'general', ctxState);
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
        ).then(() => {}, (err: unknown) => console.error('[Dispatcher] Failed to stage discoveries:', err));
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

    // Intercept date comparison queries BEFORE state comparison
    const dateCompareMatch = message.match(
      /compare.*?(\d{4}-\d{2}-\d{2}).*?(?:vs\.?|versus|and|to|with).*?(\d{4}-\d{2}-\d{2})/i
    );
    if (dateCompareMatch) {
      const handlerResult = withReceipts(
        await handleDateCompare(dateCompareMatch[1], dateCompareMatch[2], message, resolvedState),
        'date_compare', resolvedState, dateCompareMatch[1]);
      if (useStreaming) {
        return createStreamingResponse(req, handlerResult, supabase, userId, sessionId, message, 'date_compare');
      }
      const result = await executeLegacy(handlerResult);
      if (userId && sessionId) {
        await supabase.from('hunt_conversations').insert([
          { user_id: userId, session_id: sessionId, role: 'user', content: message },
          { user_id: userId, session_id: sessionId, role: 'assistant', content: result.response, metadata: { cards: result.cards, intent: 'date_compare' } },
        ]);
      }
      return new Response(JSON.stringify(result), { status: 200, headers });
    }

    // Also detect date comparisons via Haiku's extracted dates (far-apart ranges + comparison language)
    if (dateFrom && dateTo) {
      const daysBetween = Math.abs(new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000;
      if (daysBetween > 30 && /compare|vs\.?|versus|difference|same|similar/i.test(message)) {
        const handlerResult = withReceipts(
          await handleDateCompare(dateFrom, dateTo, message, resolvedState),
          'date_compare', resolvedState, dateFrom);
        if (useStreaming) {
          return createStreamingResponse(req, handlerResult, supabase, userId, sessionId, message, 'date_compare');
        }
        const result = await executeLegacy(handlerResult);
        if (userId && sessionId) {
          await supabase.from('hunt_conversations').insert([
            { user_id: userId, session_id: sessionId, role: 'user', content: message },
            { user_id: userId, session_id: sessionId, role: 'assistant', content: result.response, metadata: { cards: result.cards, intent: 'date_compare' } },
          ]);
        }
        return new Response(JSON.stringify(result), { status: 200, headers });
      }
    }

    // Intercept single-date portrait queries — "what happened on [date]?"
    // Uses direct data retrieval (not vector search) because vectors can't find dates.
    // day_read-classified questions skip this: the museum's own day-read
    // (hunt-atlas-spot that_day) is the answer for state+date questions.
    const isSingleDate = dateFrom && (!dateTo || dateTo === dateFrom);
    const isPortraitQuery = /what.*happen|show.*everything|full.*picture|portrait|environmental.*on|conditions.*on|what.*going.*on|everything.*on/i.test(message);
    if (isSingleDate && isPortraitQuery && intent !== 'day_read') {
      const handlerResult = withReceipts(
        await handleDatePortrait(dateFrom, message, resolvedState),
        'date_portrait', resolvedState, dateFrom);
      if (useStreaming) {
        return createStreamingResponse(req, handlerResult, supabase, userId, sessionId, message, 'date_portrait');
      }
      const result = await executeLegacy(handlerResult);
      if (userId && sessionId) {
        await supabase.from('hunt_conversations').insert([
          { user_id: userId, session_id: sessionId, role: 'user', content: message },
          { user_id: userId, session_id: sessionId, role: 'assistant', content: result.response, metadata: { cards: result.cards, intent: 'date_portrait' } },
        ]);
      }
      return new Response(JSON.stringify(result), { status: 200, headers });
    }

    // Intercept state comparison queries BEFORE intent routing
    const compareMatch = message.match(/compare\s+(\w{2})\s+(?:vs?\.?|and|or|versus)\s+(\w{2})/i)
      || message.match(/(\w{2})\s+vs\.?\s+(\w{2})/i);
    if (compareMatch) {
      const s1 = compareMatch[1].toUpperCase();
      const s2 = compareMatch[2].toUpperCase();
      if (s1.length === 2 && s2.length === 2 && s1 !== s2) {
        const handlerResult = withReceipts(
          await handleCompare(s1, s2, message, resolvedSpecies),
          'compare', s1);
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
      case 'pattern_query':
        handlerResult = await handlePatternQuery(query, resolvedState, message);
        break;
      case 'recent_activity':
        handlerResult = await handleRecentActivity(supabase, resolvedSpecies, resolvedState, message);
        break;
      case 'self_assessment':
        handlerResult = await handleSelfAssessment(supabase, resolvedSpecies, resolvedState, message);
        break;
      case 'docket':
        handlerResult = await handleDocket(supabase, resolvedState, message);
        break;
      case 'planting':
        handlerResult = await handlePlanting(supabase, resolvedState, query);
        break;
      case 'forming':
        handlerResult = await handleForming(supabase, resolvedState, query);
        break;
      case 'day_read': {
        const dayIso = dateFrom || isoTodayEt();
        handlerResult = resolvedState
          ? await handleDayRead(dayIso, resolvedState, query)
          : await handleDatePortrait(dayIso, message, null); // no state: the national portrait is the honest read
        break;
      }
      default:
        handlerResult = await handleGeneral(message, resolvedSpecies, resolvedState, conversationContext, dateFrom, dateTo);
        break;
    }

    // The receipts law — no intent ships an answer without provenance chips + a door
    handlerResult = withReceipts(handlerResult, intent, resolvedState, dateFrom);

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
      ).then(() => {}, (err: unknown) => console.error('[Dispatcher] Failed to stage discoveries:', err));
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
    }).then(() => {}, (e: unknown) => console.warn('Task record failed:', e));

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
  // limit(1000) is a hard row cap — at 1000 rows the sample is truncated, not complete
  const recentTruncated = (recentCounts?.length || 0) >= 1000;

  const typeCounts: Record<string, number> = {};
  (recentCounts || []).forEach((r: any) => {
    typeCounts[r.content_type] = (typeCounts[r.content_type] || 0) + 1;
  });

  // 2. High-signal entries (last 48h)
  const highSignalTypes = ['nws-alert','weather-event','migration-spike-extreme','migration-spike-significant','anomaly-alert','disaster-watch','correlation-discovery'];
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
      total_24h_truncated: recentTruncated,
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

  // 7. Fetch pattern links for state context
  const patternLinks = await getRecentPatternLinks(stateAbbr);

  // 8. Build context for Sonnet
  const contextLines = [
    `## Brain Activity Summary (last 24 hours)`,
    recentTruncated
      ? `New entries: at least 1000 — this summary covers only the most recent 1000 entries; the true 24-hour total is higher. Say "the most recent 1000 entries", never a complete total.`
      : `Total new entries: ${recentCounts?.length || 0}`,
    `### Entries by type:`,
    ...Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).map(([type, count]) => `- ${type}: ${count}`),
    `### High-signal events (last 48 hours):`,
    ...topSignals.map((s: any) => `- [${s.content_type}] ${s.state_abbr || 'National'}: ${s.title} (${s.created_at})`),
    `### Most active states:`,
    ...topStates.map(([st, count]) => `- ${st}: ${count} high-signal events`),
    `### Latest pipeline activity:`,
    ...(recentCrons || []).slice(0, 5).map((c: any) => `- ${c.function_name}: ${c.status} at ${c.created_at}`),
  ];

  // Pattern links
  if (patternLinks.length > 0) {
    contextLines.push(`### Live pattern connections (last 72h):`);
    patternLinks.forEach(l => {
      contextLines.push(`- ${l.source_title} → ${l.matched_title} (${(l.similarity * 100).toFixed(0)}% match)`);
    });
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
    cards.push({
      type: 'cross-domain-pattern',
      data: {
        connections: patternLinks.slice(0, 3).map((l: Record<string, unknown>) => ({
          source: l.source_title || 'Unknown',
          sourceType: l.source_content_type || '',
          matched: l.matched_title || 'Unknown',
          matchedType: l.matched_content_type || '',
          similarity: l.similarity || 0,
        })),
      },
    });
  }

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

  // v2 matched-control grades ONLY. The old hunt_alert_calibration numbers are
  // never cited — pre-v2 "accuracy" was tautological (alerts confirmed by the
  // same domains that fired them). v2 grades score each claim against random
  // matched control windows; the court block lives inside outcome_signals_found.
  let v2Rows: any[] = [];
  try {
    let q = supabase
      .from('hunt_alert_outcomes')
      .select('alert_source, state_abbr, alert_date, outcome_grade, outcome_signals_found, graded_at')
      .eq('outcome_checked', true)
      .eq('outcome_signals_found->court->>grade_version', '2')
      .order('graded_at', { ascending: false })
      .limit(200);
    if (stateAbbr) q = q.eq('state_abbr', stateAbbr);
    const { data, error } = await q;
    if (!error && Array.isArray(data)) v2Rows = data;
  } catch { /* defensive — re-scoring may still be in progress */ }

  const withCourt = v2Rows
    .map((r: any) => ({ ...r, court: r.outcome_signals_found?.court }))
    .filter((r: any) => r.court && r.court.grade_version === 2);

  const isConfirmedWithLift = (r: any) =>
    r.outcome_grade === 'confirmed' && typeof r.court.lift === 'number' && r.court.lift > 1;

  const total = withCourt.length;
  const beatBaseRate = withCourt.filter(isConfirmedWithLift).length;

  // Per-source breakdown with denominators
  const bySource: Record<string, { total: number; beat: number }> = {};
  for (const r of withCourt) {
    const src = r.alert_source || 'unknown';
    if (!bySource[src]) bySource[src] = { total: 0, beat: 0 };
    bySource[src].total++;
    if (isConfirmedWithLift(r)) bySource[src].beat++;
  }

  const contextLines = [
    `## Track Record — matched-control grades (grade_version 2)`,
    `Scope: ${stateAbbr || 'all states'} | ${total} claims graded against matched controls (most recent 200 max)`,
    total > 0
      ? `Headline: ${beatBaseRate} of ${total} claims confirmed against matched controls — the outcome occurred AND beat the base rate of random same-length windows (lift > 1).`
      : `No matched-control grades available yet${stateAbbr ? ` for ${stateAbbr}` : ''} — the claim court opens tonight; grades so far are being re-scored against matched controls.`,
  ];

  if (total > 0) {
    contextLines.push(`### By source (confirmed-with-lift / graded):`);
    contextLines.push(...Object.entries(bySource).map(([src, s]) =>
      `- ${src}: ${s.beat} of ${s.total} beat matched controls`
    ));
    contextLines.push(`### Most recent verdicts:`);
    contextLines.push(...withCourt.slice(0, 8).map((r: any) =>
      `- ${r.alert_date} ${r.alert_source} (${r.state_abbr || 'national'}): ${r.outcome_grade}, controls ${r.court.control_hits}/${r.court.control_n}, lift ${r.court.lift ?? 'n/a'}`
    ));

    cards.push({
      type: 'source',
      data: {
        vectorCount: total, keywordCount: 0,
        contentTypes: ['alert-grade-v2'],
        label: `${beatBaseRate} of ${total} claims confirmed against matched controls`,
      }
    });
  }

  // Claim court docket — tables land tonight; fully defensive
  const docket = await getDocketSummary(supabase);
  contextLines.push(docket.context);

  return {
    cards,
    systemPrompt: `You are reporting the system's honest track record. RULES:
- Report accuracy ONLY as "X of N claims confirmed against matched controls" — a claim counts only when the outcome occurred AND beat the base rate of random matched windows (lift > 1). Always include denominators.
- Explain lift plainly: lift > 1 means the trigger beat random chance; lift <= 1 means the outcome fires just as often on random windows (base rate, not skill); lift = 0 means the claim missed.
- NEVER cite any older calibration accuracy percentages — pre-v2 grading was tautological and was retired.
- The retired convergence score was proven to be a seasonal index with no predictive signal; if asked about it, say exactly that.
- If there are no v2 grades yet, say: the claim court opens tonight; grades so far are being re-scored against matched controls.
\n${BRAIN_RULES}`,
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

  // Fetch weather + real-event context + brain search + historical in parallel
  const weatherUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/hunt-weather`;
  const [weatherRes, realEventContext, brainResults, patternLinks, seasonStatus, historicalResults] = await Promise.all([
    fetch(weatherUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({ lat: state.centroid_lat, lng: state.centroid_lng, state_abbr: stateAbbr }),
    }),
    getRecentEventContext(stateAbbr),
    searchBrain({
      query: `${state.name} environmental weather conditions ${query}`,
      content_types: undefined,  // Search full brain — cross-domain discovery
      state_abbr: stateAbbr,
      recency_weight: 0.5,
      exclude_du_report: true,
      limit: 12,
      min_similarity: 0.4,
    }),
    getRecentPatternLinks(stateAbbr),
    getSeasonStatus(species, stateAbbr),
    // Historical: what happened last time conditions looked like this?
    searchBrain({
      query: `historical pattern ${stateAbbr} ${state.name} weather precedent similar conditions`,
      state_abbr: stateAbbr,
      recency_weight: 0.0,
      limit: 5,
      min_similarity: 0.35,
    }),
  ]);

  if (!weatherRes.ok) {
    return {
      cards: [],
      systemPrompt: 'You are a helpful assistant.',
      userContent: `Couldn't fetch weather for ${state.name}. Try again later.`,
    };
  }

  const forecast = await weatherRes.json();

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

  // Historical precedent context
  let historicalInsight = '';
  if (Array.isArray(historicalResults) && historicalResults.length > 0) {
    historicalInsight = `\n\nHistorical precedents (what happened when similar conditions aligned in ${stateAbbr}):\n${historicalResults.map(v => `- [${v.content_type}] ${v.title}: ${v.content.length > 300 ? v.content.substring(0, 300) + '...' : v.content}`).join('\n')}`;
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
    cards.push({
      type: 'cross-domain-pattern',
      data: {
        connections: patternLinks.slice(0, 3).map((l: Record<string, unknown>) => ({
          source: l.source_title || 'Unknown',
          sourceType: l.source_content_type || '',
          matched: l.matched_title || 'Unknown',
          matchedType: l.matched_content_type || '',
          similarity: l.similarity || 0,
        })),
      },
    });
  }

  return {
    cards,
    systemPrompt: `Start with a 2-3 sentence assessment of current conditions and what they mean. You are an environmental weather analyst. Synthesize weather data into a situational intelligence briefing. Lead with what's unusual — front passages, pressure anomalies, temperature shifts. Connect weather events to downstream effects: migration, wildlife behavior, historical pattern matches. When historical precedents are provided, explain what happened last time these conditions aligned. Be specific with numbers and states.
${BRAIN_RULES}`,
    userContent: `Live weather data:\nTemp: ${temp}°F, Wind: ${wind} mph, Precip: ${precip}mm\n\nSeason status: ${seasonStatus.status}${seasonStatus.isOpen ? '' : ' — SEASON IS CLOSED. Note this in your response.'}${realEventContext}\n\nBrain data (${brainResults.length} matches):\n${patternInsight || 'No brain matches found.'}\n${linksInsight}${historicalInsight}\n\nQuery: ${query}`,
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

  // Fetch seasons + brain search in parallel
  const [seasonsResult, brainResults] = await Promise.all([
    supabase
      .from('hunt_seasons')
      .select('*')
      .eq('species_id', species)
      .eq('state_abbr', stateAbbr),
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

  // Enumerate real per-domain events for each state over the last 7 days —
  // no convergence score, no winner. The archive shows differences; it does
  // not rank states.
  const COMPARE_DOMAINS = [
    'weather-event', 'nws-alert', 'birdcast-daily',
    'migration-spike', 'migration-spike-extreme', 'migration-spike-significant',
    'anomaly-alert', 'ocean-buoy', 'space-weather',
  ];
  const since = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

  type Entry = { title: string; content_type: string; effective_date?: string };
  const fetchState = async (st: string): Promise<Entry[]> => {
    // One bounded indexed query per content type (avoids IN-scans on 7.6M rows)
    const perType = await Promise.all(
      COMPARE_DOMAINS.map(async (ct) => {
        const { data } = await supabase
          .from('hunt_knowledge')
          .select('title, content_type, effective_date')
          .eq('content_type', ct)
          .eq('state_abbr', st)
          .gte('effective_date', since)
          .limit(6);
        return data || [];
      })
    );
    return perType.flat();
  };

  const [rows1, rows2, s1Status, s2Status] = await Promise.all([
    fetchState(state1),
    fetchState(state2),
    getSeasonStatus(species, state1),
    getSeasonStatus(species, state2),
  ]);

  const groupByDomain = (rows: Entry[]) => {
    const groups: Record<string, Entry[]> = {};
    for (const r of rows) {
      if (!groups[r.content_type]) groups[r.content_type] = [];
      groups[r.content_type].push(r);
    }
    return groups;
  };
  const g1 = groupByDomain(rows1);
  const g2 = groupByDomain(rows2);
  const allDomains = [...new Set([...Object.keys(g1), ...Object.keys(g2)])];

  let context = `## ${state1} vs ${state2} — real archive events, last 7 days (since ${since})\n`;
  context += `${state1}: ${rows1.length} entries | ${state2}: ${rows2.length} entries\n\n`;
  for (const domain of allDomains) {
    const d1 = g1[domain] || [];
    const d2 = g2[domain] || [];
    context += `### ${domain}\n`;
    context += `${state1} (${d1.length}): ${d1.slice(0, 3).map(r => r.title).join('; ') || 'No entries'}\n`;
    context += `${state2} (${d2.length}): ${d2.slice(0, 3).map(r => r.title).join('; ') || 'No entries'}\n\n`;
  }
  if (allDomains.length === 0) {
    context += `No high-signal entries in the archive for either state in the last 7 days.\n`;
  }
  context += `\nSeason status: ${state1}: ${s1Status.status} | ${state2}: ${s2Status.status}`;

  const cards: unknown[] = [];
  if (rows1.length > 0 || rows2.length > 0) {
    cards.push({
      type: 'source',
      data: {
        vectorCount: rows1.length + rows2.length,
        keywordCount: 0,
        contentTypes: allDomains,
        label: `${rows1.length} entries for ${state1}, ${rows2.length} for ${state2} (last 7 days, direct query)`,
      },
    });
  }

  return {
    cards,
    systemPrompt: `You are an environmental analyst comparing two states using real archive events. Narrate the DIFFERENCES domain by domain — event counts and notable events — with denominators. Do NOT declare a winner, do NOT score or rank the states, and do NOT say one state is "stronger". If the user asks which state is better or stronger, explain that the archive shows events, not rankings, and describe what actually differs. If a domain has no entries for a state, say "no entries" — an absent entry is not evidence of calm conditions.
ONLY reference data provided in the context.
${BRAIN_RULES}`,
    userContent: `${context}\n\nQuestion: ${query}`,
    mapAction: { type: 'flyTo', target: state1 },
  };
}

async function handleDatePortrait(dateStr: string, query: string, stateAbbr: string | null): Promise<HandlerResult> {
  const supabase = createSupabaseClient();
  const d = new Date(dateStr);
  const from = new Date(d.getTime() - 3 * 86400000).toISOString().split('T')[0];
  const to = new Date(d.getTime() + 3 * 86400000).toISOString().split('T')[0];

  const PORTRAIT_DOMAINS = [
    'weather-event', 'nws-alert', 'birdcast-daily',
    'migration-spike', 'ocean-buoy', 'space-weather', 'anomaly-alert',
    // Historical-era types — the pre-2020 archive lives here; without these,
    // date portraits/compares falsely report gaps for dates the archive covers
    'storm-event', 'ghcn-daily', 'climate-index',
  ];

  // Per-type parallel queries (same pattern as date compare)
  const perType = await Promise.all(
    PORTRAIT_DOMAINS.map(async (ct) => {
      let q = supabase
        .from('hunt_knowledge')
        .select('title, content, content_type, state_abbr, effective_date')
        .eq('content_type', ct)
        .is('metadata->superseded', null)
        .gte('effective_date', from)
        .lte('effective_date', to)
        .limit(8);
      if (stateAbbr) q = q.eq('state_abbr', stateAbbr);
      const { data } = await q;
      return data || [];
    })
  );
  const results = perType.flat();

  const [nationalCtx] = await Promise.all([getNationalContext()]);

  // Group by domain
  const groups: Record<string, typeof results> = {};
  for (const r of results) {
    if (!groups[r.content_type]) groups[r.content_type] = [];
    groups[r.content_type].push(r);
  }

  let context = `## Environmental Portrait: ${dateStr}\n`;
  context += `Window: ${from} to ${to} | ${results.length} entries found\n`;
  if (stateAbbr) context += `Focus: ${stateAbbr}\n`;
  context += `\n`;

  for (const [domain, entries] of Object.entries(groups)) {
    context += `### ${domain} (${entries.length} entries)\n`;
    for (const e of entries.slice(0, 5)) {
      context += `[${e.state_abbr || 'national'}] ${e.title}: ${(e.content || '').slice(0, 200)}\n`;
    }
    context += '\n';
  }

  context += nationalCtx;

  const cards: unknown[] = [];
  if (results.length > 0) {
    cards.push({
      type: 'source',
      data: {
        vectorCount: results.length,
        keywordCount: 0,
        contentTypes: Object.keys(groups),
        label: `${results.length} entries for ${dateStr} (±3 days)`,
      },
    });
  }

  return {
    cards,
    systemPrompt: `You are an environmental intelligence analyst creating a comprehensive portrait of a single date. Show EVERYTHING the brain has for this date window across all domains. Structure by domain, cite specific data values, and highlight anything unusual or notable.

If data is missing for a domain, say so — don't fill in with general knowledge.

End with: "What stands out about this date" — the 1-2 most notable or unusual findings.
${BRAIN_RULES}`,
    userContent: `${context}\n\nUser question: ${query}`,
  };
}

async function handleDateCompare(date1: string, date2: string, query: string, stateAbbr: string | null): Promise<HandlerResult> {
  // Create +/-3 day windows around each date
  const window = (dateStr: string) => {
    const d = new Date(dateStr);
    const from = new Date(d.getTime() - 3 * 86400000).toISOString().split('T')[0];
    const to = new Date(d.getTime() + 3 * 86400000).toISOString().split('T')[0];
    return { from, to };
  };

  const w1 = window(date1);
  const w2 = window(date2);

  // Direct data retrieval — vector search doesn't work for date comparison
  // because 600 nearest vectors out of 7M won't hit a specific week.
  // Instead, query hunt_knowledge directly by effective_date + content_type.
  const supabase = createSupabaseClient();
  // 8 key domains — keeps parallel queries under 150s edge function limit
  const COMPARE_DOMAINS = [
    'weather-event', 'nws-alert', 'birdcast-daily',
    'migration-spike', 'ocean-buoy', 'space-weather', 'anomaly-alert',
    // Historical-era types — the pre-2020 archive lives here; without these,
    // date portraits/compares falsely report gaps for dates the archive covers
    'storm-event', 'ghcn-daily', 'climate-index',
  ];

  const fetchWindow = async (from: string, to: string) => {
    // Query per content type to avoid expensive IN-clause scans on 7M rows
    const perType = await Promise.all(
      COMPARE_DOMAINS.map(async (ct) => {
        let q = supabase
          .from('hunt_knowledge')
          .select('title, content, content_type, state_abbr, effective_date')
          .eq('content_type', ct)
          .is('metadata->superseded', null)
          .gte('effective_date', from)
          .lte('effective_date', to)
          .limit(5);
        if (stateAbbr) q = q.eq('state_abbr', stateAbbr);
        const { data, error } = await q;
        if (error) console.warn(`[handleDateCompare] ${ct} query error:`, error.message);
        return data || [];
      })
    );
    return perType.flat();
  };

  const [results1, results2, nationalCtx] = await Promise.all([
    fetchWindow(w1.from, w1.to),
    fetchWindow(w2.from, w2.to),
    getNationalContext(),
  ]);

  // Group results by domain
  type Entry = { title: string; content: string; content_type: string; state_abbr?: string; effective_date?: string };
  const groupByDomain = (results: Entry[]) => {
    const groups: Record<string, Entry[]> = {};
    for (const r of results) {
      const domain = r.content_type;
      if (!groups[domain]) groups[domain] = [];
      groups[domain].push(r);
    }
    return groups;
  };

  const domains1 = groupByDomain(results1);
  const domains2 = groupByDomain(results2);
  const allDomains = new Set([...Object.keys(domains1), ...Object.keys(domains2)]);

  // Build structured comparison context
  let context = `## Date Comparison: ${date1} vs ${date2}\n`;
  if (stateAbbr) context += `Geographic focus: ${stateAbbr}\n`;
  context += `Search windows: ${w1.from} to ${w1.to} | ${w2.from} to ${w2.to}\n`;
  context += `Data found: ${results1.length} entries for ${date1}, ${results2.length} for ${date2}\n\n`;

  for (const domain of allDomains) {
    const d1 = domains1[domain] || [];
    const d2 = domains2[domain] || [];
    context += `### ${domain}\n`;
    context += `${date1} (${d1.length} entries): ${d1.slice(0, 3).map(r => r.title).join('; ') || 'No data'}\n`;
    context += `${date2} (${d2.length} entries): ${d2.slice(0, 3).map(r => r.title).join('; ') || 'No data'}\n\n`;
  }

  context += `\n### RAW DATA — ${date1}\n`;
  for (const r of results1.slice(0, 15)) {
    context += `[${r.content_type}] ${r.title}: ${(r.content || '').slice(0, 200)}\n`;
  }
  context += `\n### RAW DATA — ${date2}\n`;
  for (const r of results2.slice(0, 15)) {
    context += `[${r.content_type}] ${r.title}: ${(r.content || '').slice(0, 200)}\n`;
  }

  context += nationalCtx;

  // Build cards
  const cards: unknown[] = [];
  if (results1.length > 0 || results2.length > 0) {
    cards.push({
      type: 'source',
      data: {
        vectorCount: results1.length + results2.length,
        keywordCount: 0,
        contentTypes: [...allDomains],
        label: `${results1.length} entries for ${date1}, ${results2.length} for ${date2} (direct query)`,
      },
    });
  }

  return {
    cards,
    systemPrompt: `You are an environmental intelligence analyst performing a date-vs-date comparison. You have brain data for two date windows. For EACH domain present, compare what happened on each date. Be specific — cite actual data values, event types, and conditions.

Structure your response as:
1. VERDICT FIRST: Overall similarity percentage and 2-sentence summary of key differences
2. DOMAIN-BY-DOMAIN: For each domain with data, side-by-side comparison
3. GAPS: What domains are missing data for one or both dates
4. If one date has significantly more data than the other, note this honestly

CRITICAL: If the brain has NO data for a domain on a date, say "No data" — never fabricate conditions. Never assign a similarity percentage based on missing data.
${BRAIN_RULES}`,
    userContent: `${context}\n\nUser question: ${query}`,
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

  const supabase = createSupabaseClient();
  const [brainResults, patternLinks, realEventContext, historicalResults, nationalContext] = await Promise.all([
    searchBrain({
      query: searchQuery,
      species: species,
      state_abbr: stateAbbr || undefined,
      recency_weight: (dateFrom || dateTo) ? 0.0 : 0.3,  // No recency bias when searching historical dates
      exclude_du_report: !mentionsDU,
      limit: 15,
      min_similarity: 0.3,
      date_from: dateFrom,
      date_to: dateTo,
    }),
    getRecentPatternLinks(stateAbbr || null),
    // Real-event counts (state-filtered or national) — replaces the retired convergence score
    getRecentEventContext(stateAbbr || null),
    // Historical pattern search: always run, with or without state
    searchBrain({
        query: stateAbbr
          ? `historical pattern ${stateAbbr} similar conditions precedent`
          : `historical environmental pattern notable conditions precedent`,
        state_abbr: stateAbbr || undefined,
        recency_weight: 0.0,
        limit: 5,
        min_similarity: 0.35,
      }),
    getNationalContext(),
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
      webContext = '\n\nWEB RESULTS — these came from a live web search, NOT the brain archive. If you use any of them, you MUST attribute them as "(from the web, not the archive)":\n' +
        webResults.map(r => `[${r.title}] (${r.url})\n${r.content}`).join('\n\n');
    }
  }

  const cards: unknown[] = [];
  if (webResults.length > 0) {
    cards.push({
      type: 'source',
      data: {
        vectorCount: 0,
        keywordCount: webResults.length,
        contentTypes: ['web'],
        label: `${webResults.length} web result${webResults.length === 1 ? '' : 's'} (from the web, not the archive)`,
      },
    });
  }
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

  // Keyword fallback if brain returned nothing — bounded and filtered,
  // never an unfiltered table dump.
  if (!vectorContext) {
    try {
      const escapedQuery = query.replace(/[%_\\]/g, '\\$&');

      // hunt_state_facts only enters context with a real filter: the resolved
      // state's name, or a query match on state_name — plus species when set.
      let factsQuery = supabase.from('hunt_state_facts')
        .select('species_id, state_name, facts')
        .limit(3);
      if (species && species !== 'all') factsQuery = factsQuery.eq('species_id', species);
      if (stateAbbr) {
        const { data: st } = await supabase.from('hunt_states').select('name').eq('abbreviation', stateAbbr).maybeSingle();
        factsQuery = st?.name
          ? factsQuery.eq('state_name', st.name)
          : factsQuery.ilike('state_name', `%${escapedQuery}%`);
      } else {
        factsQuery = factsQuery.ilike('state_name', `%${escapedQuery}%`);
      }

      const [seasonsResult, factsResult] = await Promise.all([
        supabase.from('hunt_seasons')
          .select('species_id, state_abbr, state_name, season_type, zone, notes')
          .or(`notes.ilike.%${escapedQuery}%,state_name.ilike.%${escapedQuery}%`)
          .limit(5),
        factsQuery,
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
    cards.push({
      type: 'cross-domain-pattern',
      data: {
        connections: patternLinks.slice(0, 3).map((l: Record<string, unknown>) => ({
          source: l.source_title || 'Unknown',
          sourceType: l.source_content_type || '',
          matched: l.matched_title || 'Unknown',
          matchedType: l.matched_content_type || '',
          similarity: l.similarity || 0,
        })),
      },
    });
  }

  // Historical pattern matches
  let historicalContext = '';
  if (Array.isArray(historicalResults) && historicalResults.length > 0) {
    historicalContext = `\n\nHistorical precedents (what happened when similar conditions aligned):\n${historicalResults.map(v => `- [${v.content_type}] ${v.title}: ${v.content.length > 300 ? v.content.substring(0, 300) + '...' : v.content}`).join('\n')}`;
  }

  const similarities = brainResults.map(v => v.similarity);
  const minSim = similarities.length > 0 ? Math.min(...similarities).toFixed(2) : '0';
  const maxSim = similarities.length > 0 ? Math.max(...similarities).toFixed(2) : '0';

  return {
    cards,
    systemPrompt: `Lead with a 2-3 sentence direct answer to the user's question. Then organize supporting evidence by theme. You are an environmental intelligence analyst with access to a brain containing 7.6M+ embedded data entries across 83+ content types including weather, migration, water, drought, NWS alerts, solunar, and historical patterns. Synthesize the provided context. When patterns match, explain what happened historically when these conditions aligned — with denominators. Cite brain entry counts and content types. If web results are provided and you use one, attribute it as "(from the web, not the archive)".
${BRAIN_RULES}`,
    userContent: `Brain data (${brainResults.length} entries found${brainResults.length > 0 ? `, confidence ${minSim}-${maxSim}` : ''}):\n${vectorContext || 'No brain matches found.'}\n\nIMPORTANT: Only reference the brain data above. If the data doesn't answer the question, say "The brain doesn't have data on this yet."${linksContext}${realEventContext}${historicalContext}${nationalContext}${webContext}\n\nQuestion: ${query}`,
    _webResults: webResults,
  } as HandlerResult & { _webResults: TavilyResult[] };
}

async function handleGeneral(message: string, species: string, stateAbbr: string | null, conversationContext: string = '', dateFrom?: string | null, dateTo?: string | null): Promise<HandlerResult & { _webResults?: TavilyResult[] }> {
  const supabase = createSupabaseClient();

  // Brain search + real-event context + pattern links + historical + national context in parallel
  const [brainResults, realEventContext, patternLinks, historicalResults, nationalContext] = await Promise.all([
    searchBrain({
      query: message,
      state_abbr: stateAbbr || undefined,
      recency_weight: (dateFrom || dateTo) ? 0.0 : 0.2,
      exclude_du_report: true,
      limit: (dateFrom || dateTo) ? 12 : 8,
      min_similarity: (dateFrom || dateTo) ? 0.3 : 0.4,
      date_from: dateFrom,
      date_to: dateTo,
    }),
    // Real-event counts — replaces the retired convergence score
    getRecentEventContext(stateAbbr),
    getRecentPatternLinks(stateAbbr),
    // Historical: always run, with or without state
    searchBrain({
        query: stateAbbr
          ? `historical pattern ${stateAbbr} similar conditions precedent`
          : `historical environmental pattern notable conditions precedent`,
        state_abbr: stateAbbr || undefined,
        recency_weight: 0.0,
        limit: 5,
        min_similarity: 0.35,
      }),
    getNationalContext(),
  ]);

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
      webContext = '\n\nWEB RESULTS — these came from a live web search, NOT the brain archive. If you use any of them, you MUST attribute them as "(from the web, not the archive)":\n' +
        webResults.map(r => `[${r.title}] (${r.url})\n${r.content}`).join('\n\n');
    }
  }

  let brainContext = '';
  if (brainResults.length > 0) {
    brainContext = `\n\nRelevant knowledge (${brainResults.length} entries, cite if useful):\n${brainResults.map(v => `[${v.content_type}] ${v.title}: ${v.content}`).join('\n')}`;
  }

  // Pattern links
  let linksContext = '';
  if (patternLinks.length > 0) {
    linksContext = `\n\nLive pattern connections (last 72h):\n${patternLinks.map(l => `${l.source_title} → ${l.matched_title} (${(l.similarity * 100).toFixed(0)}% match)`).join('\n')}`;
  }

  // Historical precedents
  let historicalContext = '';
  if (Array.isArray(historicalResults) && historicalResults.length > 0) {
    historicalContext = `\n\nHistorical precedents:\n${historicalResults.map(v => `- [${v.content_type}] ${v.title}: ${v.content.length > 300 ? v.content.substring(0, 300) + '...' : v.content}`).join('\n')}`;
  }

  const cards: unknown[] = [];
  if (webResults.length > 0) {
    cards.push({
      type: 'source',
      data: {
        vectorCount: 0,
        keywordCount: webResults.length,
        contentTypes: ['web'],
        label: `${webResults.length} web result${webResults.length === 1 ? '' : 's'} (from the web, not the archive)`,
      },
    });
  }

  return {
    cards,
    systemPrompt: `You are an environmental intelligence engine tracking patterns across weather, migration, water levels, pressure, solunar cycles, drought, and wildlife behavior across all 50 US states. You synthesize data from 21+ sources. Adapt your framing to the user's context — environmental research, agriculture, ecology, weather, or general awareness. Your core function is environmental pattern recognition. If web results are provided and you use one, attribute it as "(from the web, not the archive)".${species && species !== 'all' ? `\nCurrent species context: ${species}. State: ${stateAbbr || 'none'}.` : ''}
${conversationContext}${brainContext}${realEventContext}${linksContext}${historicalContext}${nationalContext}${webContext}
Be concise and helpful. 2-3 sentences max for casual chat.
${BRAIN_RULES}`,
    userContent: message,
    _webResults: webResults,
  };
}

// --- Pattern Query Handler ---
// Cross-domain conditional queries that Google can't answer

async function handlePatternQuery(query: string, stateAbbr: string | null | undefined, originalMessage: string): Promise<HandlerResult> {
  // Call hunt-pattern-query edge function
  const patternUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/hunt-pattern-query`;
  let patternData: any = null;

  try {
    const res = await fetch(patternUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({
        query: originalMessage,
        state_abbr: stateAbbr || null,
      }),
    });
    if (res.ok) {
      patternData = await res.json();
    }
  } catch (err) {
    console.error('[dispatcher] pattern query failed:', err);
  }

  // Build context from pattern results
  let patternContext = '';
  if (patternData) {
    patternContext = `\n\nPATTERN QUERY RESULTS:
Conditions searched: ${(patternData.conditions || []).join(' AND ')}
Per-condition matches: ${JSON.stringify(patternData.per_condition_matches || {})}
Dates matching ALL conditions: ${patternData.total_intersected || 0}
All matched dates: ${(patternData.all_matched_dates || []).join(', ')}

Detailed matches (date + what followed within ${patternData.followup_window_days || 30} days):
${(patternData.matches || []).map((m: any) =>
  `\n--- ${m.date} ---\n${m.followup_events?.length ? m.followup_events.map((e: any) =>
    `  [${e.content_type}] ${e.state_abbr || ''} ${e.effective_date}: ${e.content?.slice(0, 200)}`
  ).join('\n') : '  No followup events found in the brain for this window.'}`
).join('\n')}`;
  } else {
    patternContext = '\n\nPattern query engine returned no results. The brain may not have enough data for this specific cross-reference yet.';
  }

  return {
    cards: [],
    systemPrompt: `You are an environmental intelligence engine that answers cross-domain pattern queries — questions that CANNOT be answered by Google because they require cross-referencing multiple independent datasets by date.

The user asked a pattern query and the brain searched for dates matching specific conditions across different domains, then checked what happened within a followup window.

YOUR JOB:
1. Lead with the finding — how many dates matched, what's the pattern.
2. For each matched date, summarize what followed (storms, weather events, etc).
3. If the current date or recent months also match the pattern, FLAG IT prominently.
4. Note what data gaps exist (if followup events are sparse, explain the brain may not have that data yet).
5. Suggest what additional data would strengthen or weaken the pattern.
6. This is the kind of analysis that literally cannot be done anywhere else. The cross-reference between these datasets does not exist on the internet.

${patternContext}
${BRAIN_RULES}`,
    userContent: originalMessage,
  };
}

// --- Claim Court (docket) ---
// hunt_claims / hunt_claim_fires land tonight — every query here is defensive
// against missing tables and empty dockets.

async function getDocketSummary(supabase: any): Promise<{ context: string; claims: any[]; fires: any[] }> {
  const opening = `\n\n## Claim Court\nThe claim court opens tonight; grades so far are being re-scored against matched controls. No docket entries to cite yet.`;
  try {
    const [claimsRes, firesRes] = await Promise.all([
      supabase
        .from('hunt_claims')
        .select('id, name, status, created_at')
        .limit(100),
      supabase
        .from('hunt_claim_fires')
        .select('claim_id, state_abbr, fired_at, window_end, evaluated, hit, control_hits, control_n, lift, graded_at')
        .order('fired_at', { ascending: false })
        .limit(200),
    ]);

    if (claimsRes.error || !Array.isArray(claimsRes.data) || claimsRes.data.length === 0) {
      return { context: opening, claims: [], fires: [] };
    }

    const claims = claimsRes.data;
    const fires: any[] = (firesRes.error ? [] : firesRes.data) || [];
    const nameById = new Map<string, string>(claims.map((c: any) => [String(c.id), String(c.name)]));

    const perClaim: Record<string, { fires: number; graded: number; hits: number; beatBase: number }> = {};
    for (const f of fires) {
      const name = nameById.get(String(f.claim_id)) || String(f.claim_id);
      if (!perClaim[name]) perClaim[name] = { fires: 0, graded: 0, hits: 0, beatBase: 0 };
      const p = perClaim[name];
      p.fires++;
      if (f.evaluated) {
        p.graded++;
        if (f.hit) p.hits++;
        if (typeof f.lift === 'number' && f.lift > 1) p.beatBase++;
      }
    }

    const lines = [
      `\n\n## Claim Court Docket`,
      `Standing claims: ${claims.length} (${claims.filter((c: any) => c.status === 'active').length} active) | fires on record: ${fires.length} (most recent 200 max)`,
      ...claims.slice(0, 20).map((c: any) => {
        const p = perClaim[c.name];
        if (!p || p.fires === 0) return `- "${c.name}" (${c.status}): no fires recorded yet`;
        const pending = p.fires - p.graded;
        let line = `- "${c.name}" (${c.status}): fired ${p.fires} time(s)`;
        if (p.graded > 0) line += `; ${p.hits} of ${p.graded} graded fires hit, ${p.beatBase} of ${p.graded} beat matched controls (lift > 1)`;
        if (pending > 0) line += `; ${pending} awaiting verdict`;
        return line;
      }),
    ];

    const verdicts = fires.filter((f: any) => f.evaluated);
    if (verdicts.length > 0) {
      lines.push(`### Most recent verdicts:`);
      lines.push(...verdicts.slice(0, 10).map((f: any) =>
        `- "${nameById.get(String(f.claim_id)) || 'claim'}" / ${f.state_abbr} fired ${f.fired_at}: ${f.hit ? 'HIT' : 'MISS'}, controls ${f.control_hits}/${f.control_n}, lift ${f.lift ?? 'n/a'}`
      ));
    } else {
      lines.push(`(No verdicts yet — the first grades land after the first outcome windows close.)`);
    }

    return { context: lines.join('\n'), claims, fires };
  } catch {
    return { context: opening, claims: [], fires: [] };
  }
}

async function handleDocket(supabase: any, stateAbbr: string | null, userMessage: string): Promise<HandlerResult> {
  const docket = await getDocketSummary(supabase);

  const cards: unknown[] = [];
  const verdicts = docket.fires.filter((f: any) => f.evaluated);
  if (docket.claims.length > 0) {
    cards.push({
      type: 'source',
      data: {
        vectorCount: docket.claims.length,
        keywordCount: verdicts.length,
        contentTypes: ['claim', 'claim-fire'],
        label: `${docket.claims.length} standing claims, ${verdicts.length} graded fires`,
      },
    });
  }

  return {
    cards,
    systemPrompt: `You are the clerk of the claim court — the honest docket. The court holds standing claims ("when trigger X fires in a state, outcome Y follows within N days"), records every fire, and grades each fire against matched random control windows in the same state.

RULES:
- Answer with literal receipts: for each claim, report fires, hits, control fractions (control hits / control n), and lift — exactly as given in the context.
- Explain lift plainly: lift > 1 means the trigger beat the base rate of random matched windows; lift <= 1 means the outcome fires just as often at random (base rate, not skill); lift = 0 means the fire missed its outcome.
- Never soften a bad verdict and never inflate a good one. Denominators always.
- If the docket is empty, say plainly: the claim court opens tonight; grades so far are being re-scored against matched controls.
${stateAbbr ? `- The user's selected state is ${stateAbbr}; highlight fires in that state when present.` : ''}
${BRAIN_RULES}`,
    userContent: `${userMessage}\n\n---\n${docket.context}`,
  };
}

// --- ASK v1 handlers (blueprint §3 / Wave 4) --------------------------------
// Three deterministic handlers: each is a bounded read of real tables — the
// same data paths the /plant page, the formation layer, and the museum's
// day-read already use. The LLM narrates the fetched rows; it never invents
// a number. Every result carries its own receipts + doors (the receipts law).

// planting — "when do I plant tomatoes?" / "last frost?" Reads the SAME rows
// /plant renders: planting_climatology (one-time ghcn-daily distributions) +
// this spring's live status from hunt_weather_history.
async function handlePlanting(
  supabase: ReturnType<typeof createSupabaseClient>,
  stateAbbr: string | null,
  query: string,
): Promise<HandlerResult> {
  if (!stateAbbr) {
    return {
      cards: [],
      systemPrompt: 'You are a helpful assistant.',
      userContent: 'Which state is your ground? Name a state and I can read its frost record — 76 recorded years of state-day minima.',
      receipts: ['planting_climatology · ghcn-daily (NOAA ACIS)'],
      doors: [{ label: 'The full planting table →', href: '/plant' }],
    };
  }

  const currentYear = new Date().getFullYear();
  const [climRes, stRes, freezeRes, latestRes] = await Promise.all([
    supabase.from('planting_climatology').select('*').eq('state_abbr', stateAbbr).maybeSingle(),
    supabase.from('hunt_states').select('name').eq('abbreviation', stateAbbr).maybeSingle(),
    // This spring's last freeze-cold reading in the live lane (same query /plant runs)
    supabase.from('hunt_weather_history')
      .select('date,temp_low_f')
      .eq('state_abbr', stateAbbr)
      .gte('date', `${currentYear}-01-01`)
      .lte('date', `${currentYear}-06-30`)
      .lte('temp_low_f', 32)
      .order('date', { ascending: false })
      .limit(1),
    supabase.from('hunt_weather_history')
      .select('date')
      .eq('state_abbr', stateAbbr)
      .order('date', { ascending: false })
      .limit(1),
  ]);

  const stateName = (stRes.data?.name as string) || stateAbbr;
  const row = climRes.data as Record<string, any> | null;
  const doors = [{ label: 'The full planting table →', href: `/plant?state=${stateAbbr}` }];

  if (!row?.spring) {
    return {
      cards: [],
      systemPrompt: `You are the almanac's planting table. Say plainly what the context says — never invent dates.\n${BRAIN_RULES}`,
      userContent: `The planting table holds no frost distribution for ${stateName} — the station record was too thin to publish honestly. Tell the user exactly that. User asked: ${query}`,
      receipts: ['planting_climatology · ghcn-daily (NOAA ACIS)'],
      doors,
    };
  }

  const spring = row.spring as Record<string, any>;
  const fall = row.fall as Record<string, any>;
  const season = row.season as Record<string, any>;
  const heroN = (spring.pct_passed_by_p90 ?? 0) + (spring.no_freeze_years ?? 0);
  const f = freezeRes.data?.[0] as { date: string; temp_low_f: number } | undefined;
  const l = latestRes.data?.[0] as { date: string } | undefined;

  const contextLines = [
    `## The frost record for ${stateName} — planting_climatology (ghcn-daily state-day minima, ${row.n_years} recorded years, 1950–2025)`,
    `### Last spring freeze (the last day at or below 32°F before July 1, each recorded year):`,
    `- THE HEADLINE: In ${heroN} of ${row.n_years} recorded years, ${stateName}'s last freeze had passed by ${spring.p90_date}.`,
    `- In the earliest tenth of years, passed by: ${spring.p10_date}`,
    `- Median year: ${spring.median_date}`,
    `- Earliest ever: ${spring.earliest_date} (${spring.earliest_year})`,
    `- Latest ever: ${spring.latest_date} (${spring.latest_year}) — the cruelest spring on file`,
    (spring.no_freeze_years ?? 0) > 0 ? `- Years with no spring freeze at all: ${spring.no_freeze_years}` : null,
    `### First fall freeze (first day at or below 32°F from July 1 on):`,
    `- Median year: ${fall.median_date} | earliest ever ${fall.earliest_date} (${fall.earliest_year}) | latest ever ${fall.latest_date} (${fall.latest_year})`,
    `### The growing season (days between the two):`,
    `- Median ${season.median_days} days | shortest ${season.shortest_days} days (${season.shortest_year}) | longest ${season.longest_days} days (${season.longest_year})`,
    `### This spring's live status (live lane, one representative station point per state${l ? `, current through ${l.date}` : ''}):`,
    f
      ? `- Last freeze-cold reading this spring: ${f.date} (${f.temp_low_f}°F)`
      : `- No freeze-cold reading this spring in the live lane.`,
    `### DISCLOSURE (must be stated in the answer): state-level minima — a freeze in this table means somewhere in ${stateName} froze; a single backyard varies. County-level is coming.`,
  ].filter(Boolean);

  return {
    cards: [{
      type: 'source',
      data: {
        vectorCount: 1,
        keywordCount: 0,
        contentTypes: ['planting-climatology', 'weather-history'],
        label: `${row.n_years} recorded years of ghcn-daily state-day minima (direct query)`,
      },
    }],
    systemPrompt: `You are the almanac's planting table speaking. Answer "when do I plant" with the DISTRIBUTION — never a single made-up frost date, never a forecast.
RULES:
- Lead with the headline sentence exactly as computed: "In ${heroN} of ${row.n_years} recorded years, ${stateName}'s last freeze had passed by ${spring.p90_date}."
- Then the median year and the cruelest year, by name and date.
- Include this spring's live status from the context.
- ALWAYS include the state-level disclosure from the context — it is house law, not a footnote.
- Every date and count must come from the context verbatim. Never invent, shift, or round a date.
${BRAIN_RULES}`,
    userContent: `${query}\n\n---\n\n${contextLines.join('\n')}`,
    receipts: [
      'planting_climatology · ghcn-daily (NOAA ACIS)',
      `${row.n_years} yrs (1950–2025)`,
      'state-level minima',
      'live lane: hunt_weather_history',
    ],
    doors,
  };
}

// forming — "what's forming?" / "any watches?" Reads formation_watches
// (status=forming — the Formation Layer's own prebuilt fact-only copy) +
// active Severe/Extreme NWS alerts (the same read the live board makes).
async function handleForming(
  supabase: ReturnType<typeof createSupabaseClient>,
  stateAbbr: string | null,
  query: string,
): Promise<HandlerResult> {
  const [watchesRes, alertsRes] = await Promise.all([
    supabase.from('formation_watches')
      .select('lead_id,states,status,opened_at,last_seen,evidence,precedents,copy')
      .eq('status', 'forming')
      .order('opened_at', { ascending: false })
      .limit(60),
    supabase.from('hunt_nws_alerts')
      .select('states,event_type,severity')
      .in('severity', ['Severe', 'Extreme'])
      .gt('expires', new Date().toISOString())
      .limit(1000),
  ]);

  const watches = (watchesRes.data ?? []) as Array<{
    lead_id: string; states: string[]; opened_at: string; last_seen: string;
    evidence: Record<string, unknown> | null; copy: string;
  }>;
  const alertRows = (alertsRes.data ?? []) as Array<{ states: string[] | null; event_type: string | null; severity: string | null }>;

  // Tally active alerts by event type (state list attached)
  const alertTally = new Map<string, { severity: string; states: Set<string> }>();
  for (const a of alertRows) {
    if (!a.event_type) continue;
    const cur = alertTally.get(a.event_type) ?? { severity: a.severity ?? 'Severe', states: new Set<string>() };
    if (a.severity === 'Extreme') cur.severity = 'Extreme';
    for (const st of a.states ?? []) cur.states.add(st);
    alertTally.set(a.event_type, cur);
  }

  const contextLines = [
    `## Forming now — formation_watches (live, status=forming): ${watches.length} open watch${watches.length === 1 ? '' : 'es'}`,
    ...(watches.length > 0
      ? watches.map(w => {
          const leadTime = (w.evidence as Record<string, unknown> | null)?.lead_time;
          return `- [${w.lead_id}] over ${w.states.join(', ')} — opened ${w.opened_at}, still live as of ${w.last_seen}${leadTime ? ` · registered lead time: ${leadTime}` : ''}\n  The watch's own copy (fact-only, prebuilt): "${w.copy}"`;
        })
      : ['- No watch is open. The formation layer\'s leads are quiet right now — that is the honest answer.']),
    stateAbbr
      ? (() => {
          const covering = watches.filter(w => w.states.includes(stateAbbr));
          return covering.length > 0
            ? `### Watches covering ${stateAbbr}: ${covering.map(w => w.lead_id).join(', ')}`
            : `### No open watch covers ${stateAbbr}.`;
        })()
      : null,
    `## Active NWS alerts on file (official, Severe/Extreme, unexpired): ${alertTally.size} alert type${alertTally.size === 1 ? '' : 's'}`,
    ...Array.from(alertTally.entries()).slice(0, 15).map(([ev, t]) =>
      `- ${ev} (${t.severity}) covering ${Array.from(t.states).sort().join(', ') || 'unspecified'}`),
  ].filter(Boolean);

  return {
    cards: [{
      type: 'source',
      data: {
        vectorCount: watches.length,
        keywordCount: alertRows.length,
        contentTypes: ['formation-watch', 'nws-alert'],
        label: `${watches.length} open formation watch${watches.length === 1 ? '' : 'es'}, ${alertRows.length} active Severe/Extreme NWS alerts (direct query)`,
      },
    }],
    systemPrompt: `You are the Formation Layer speaking — the map's account of what is FORMING, by known-physics leads fired by live data. RULES:
- Lead with what is forming: name each open watch, its ground (states), and its registered lead time ("this lead runs 1-3 days ahead", "weeks, never a date").
- Quote or faithfully paraphrase each watch's own prebuilt copy — it is fact-only and pre-verified. NEVER extend it, add odds, or forecast beyond it.
- Active NWS alerts are official rows on file — report them as what is already declared, distinct from what is forming.
- If no watch is open, say so plainly: the formation layer's leads are quiet. Do not fill silence with speculation.
- Never say what WILL happen. Lead times are the registered historical behavior of the lead, not a promise.
${BRAIN_RULES}`,
    userContent: `${query}\n\n---\n\n${contextLines.join('\n')}`,
    receipts: [
      'formation_watches (live)',
      'hunt_nws_alerts · unexpired Severe/Extreme',
      'leads registry: VALIDATED-LEADS-2026-07-17',
    ],
    doors: [
      { label: 'The live board →', href: '/' },
      { label: 'The Morning Line →', href: '/morning' },
    ],
  };
}

// day_read — "what happened on July 4 1990 in Maryland?" The museum IS the
// answer: one internal fetch to hunt-atlas-spot (the same call the morning
// line makes) and the that_day block — the date's OWN recorded rows — plus
// its era notes, narrated.
async function handleDayRead(dateIso: string, stateAbbr: string, query: string): Promise<HandlerResult> {
  const doors = [
    { label: `The museum's full record for ${dateIso} →`, href: `/date/${dateIso}` },
    { label: 'The Atlas →', href: `/atlas?state=${stateAbbr}` },
  ];
  const todayIso = isoTodayEt();
  if (dateIso > todayIso) {
    return {
      cards: [],
      systemPrompt: `You are the museum's day-read. Say what the context says — plainly.\n${BRAIN_RULES}`,
      userContent: `The user asked about ${dateIso}, which hasn't happened yet. Tell them: the archive is a record, never a forecast — there is no recorded day to read until the day exists. User asked: ${query}`,
      receipts: ['the archive records; it never forecasts'],
      doors: [{ label: 'The museum, any date →', href: `/date/${todayIso}` }],
    };
  }

  const base = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  let spot: Record<string, any> | null = null;
  try {
    const res = await fetch(
      `${base}/functions/v1/hunt-atlas-spot?state=${stateAbbr}&date=${dateIso}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (res.ok) spot = await res.json();
  } catch (err) {
    console.error('[handleDayRead] hunt-atlas-spot fetch failed:', err);
  }

  const thatDay = (spot?.that_day ?? null) as Record<string, any> | null;
  const stateName = (spot?.spot?.name as string) || stateAbbr;

  if (!thatDay) {
    return {
      cards: [],
      systemPrompt: `You are the museum's day-read. Say what the context says — plainly, never inventing.\n${BRAIN_RULES}`,
      userContent: `The day-read for ${stateName} on ${dateIso} could not be fetched from the archive right now. Tell the user plainly and point them to the museum page for the date. User asked: ${query}`,
      receipts: ['atlas dossier · that-day (fetch failed)'],
      doors,
    };
  }

  const w = thatDay.weather as Record<string, any> | null;
  const events = (thatDay.events ?? []) as Array<Record<string, any>>;
  const quakes = (thatDay.quakes ?? []) as Array<Record<string, any>>;
  const tide = (thatDay.tide ?? []) as Array<Record<string, any>>;
  const world = (thatDay.world ?? []) as Array<Record<string, any>>;

  const money = (n: number | null | undefined) =>
    typeof n === 'number' && n > 0 ? `$${n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n.toLocaleString()}` : null;

  const contextLines = [
    `## The record for ${stateName}, ${dateIso} — the date's OWN rows (museum day-read)`,
    `### Weather (ghcn-daily state rollup):`,
    w
      ? [
          `- Avg high ${w.avg_high_f ?? 'n/a'}°F, avg low ${w.avg_low_f ?? 'n/a'}°F${w.precip_in != null ? `, precip ${w.precip_in}"` : ''}${w.stations != null ? ` (${w.stations} stations)` : ''}`,
          w.max_f != null || w.min_f != null ? `- Recorded extremes: max ${w.max_f ?? 'n/a'}°F, min ${w.min_f ?? 'n/a'}°F` : null,
          w.narrative ? `- Narrative: ${w.narrative}` : null,
        ].filter(Boolean).join('\n')
      : `- No ghcn-daily row on file for this date.`,
    `### Storm events on file (${events.length}):`,
    ...(events.length > 0
      ? events.map(e => {
          const tolls = [
            e.deaths ? `${e.deaths} death${e.deaths === 1 ? '' : 's'}` : null,
            e.injuries ? `${e.injuries} injur${e.injuries === 1 ? 'y' : 'ies'}` : null,
            money(e.damage_usd) ? `${money(e.damage_usd)} damage` : null,
          ].filter(Boolean).join(', ');
          const narrative = typeof e.narrative === 'string' && e.narrative
            ? ` — ${e.narrative.length > 400 ? e.narrative.slice(0, 400) + '…' : e.narrative}`
            : '';
          return `- ${e.title}${e.county ? ` (${e.county})` : ''}${e.span_note ? ` [${e.span_note}]` : ''}${tolls ? ` — ${tolls}` : ''}${narrative}`;
        })
      : ['- None on file.']),
    quakes.length > 0
      ? `### Earthquakes (ComCat, M4.5+):\n${quakes.map(q => `- M${q.magnitude} ${q.place}${q.event_time_utc ? ` at ${q.event_time_utc}` : ''}`).join('\n')}`
      : null,
    tide.length > 0
      ? `### Tide gauges that day:\n${tide.map(t => `- ${t.station_name ?? 'station'}: ${t.residual_max_ft != null ? `max residual ${t.residual_max_ft} ft` : t.residual_mean_ft != null ? `mean residual ${t.residual_mean_ft} ft (daily-mean basis)` : t.daily_max_ft != null ? `daily max ${t.daily_max_ft} ft` : 'reading on file'}`).join('\n')}`
      : null,
    world.length > 0
      ? `### The wider world that day (onthisday):\n${world.map(o => `- ${o.title}`).join('\n')}`
      : null,
    thatDay.era_note ? `### ERA NOTE (quote or faithfully convey this): ${thatDay.era_note}` : null,
    `### Archive basis: ${thatDay.honest_note ?? 'every line traces to a stored row; blank fields mean no row on file.'}`,
  ].filter(Boolean);

  const sources = Array.isArray(spot?.sources) ? (spot!.sources as string[]) : ['ghcn-daily', 'storm-event', 'tide-gauge', 'onthisday-event'];

  return {
    cards: [{
      type: 'source',
      data: {
        vectorCount: events.length + quakes.length + tide.length + world.length + (w ? 1 : 0),
        keywordCount: 0,
        contentTypes: sources,
        label: `${stateName} · ${dateIso} — the date's own rows (direct archive query via the atlas dossier)`,
      },
    }],
    systemPrompt: `You are the museum's day-read — narrating one recorded day in one state from the archive's own rows. RULES:
- Lead with the day's character in 2-3 sentences: the weather numbers and the most severe event, if any.
- Then the record by section: storm events (with deaths/injuries/damage where recorded), quakes, tides, the wider world.
- If an ERA NOTE is present, convey it — absence in an old ledger is the ledger's limit, not the day's calm. Never fill a gap with general knowledge.
- Every number and event must come from the context verbatim. Blank sections mean no row on file — say that plainly.
- This is a record, never a forecast.
${BRAIN_RULES}`,
    userContent: `${query}\n\n---\n\n${contextLines.join('\n')}`,
    receipts: [...sources, 'that-day: the date\'s own rows'],
    doors,
  };
}
