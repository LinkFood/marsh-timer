# BUILD SPEC: Chat Intelligence Overhaul

**Purpose:** Complete build spec for Claude Code. The Brain Chat mostly works — the architecture is sound, the FROM THE BRAIN / AI INTERPRETATION split is correct, streaming works, cards render. But broad/exploratory queries return empty brains, the suggested prompts are species-locked instead of data-driven, and the system prompts still reference hunting as the primary identity. These seven changes make the chat feel like a living intelligence system instead of a search box.

**Repo:** `/sessions/happy-determined-rubin/mnt/marsh-timer`
**Supabase project:** `rvhyotvklfowklzjahdd`

---

## WHAT EXISTS NOW (read this first)

### Frontend Files
- `src/components/HuntChat.tsx` — Chat panel UI, suggested prompts via `getSuggestedPrompts()`, "+ New", history, status bar
- `src/components/ChatMessage.tsx` — Renders FROM THE BRAIN (pattern + source cards) and AI INTERPRETATION (markdown text + other cards)
- `src/hooks/useChat.ts` — SSE streaming handler, posts to hunt-dispatcher, parses cards then text chunks, infers map mode

### Backend Files
- `supabase/functions/hunt-dispatcher/index.ts` (~1046 lines) — Intent classification (Haiku) → 5 handlers: `handleWeather`, `handleSolunar`, `handleSeasonInfo`, `handleSearch`, `handleGeneral`, plus `handleCompare`
- `supabase/functions/hunt-search/index.ts` (95 lines) — Vector search via `search_hunt_knowledge_v2` RPC, threshold 0.3, fallback keyword search on state_facts + seasons
- `supabase/functions/_shared/brainScan.ts` (171 lines) — Query-on-write pattern matching, enrichWithPatternScan, writePatternLinks

### Current Intent Types
`weather | solunar | season_info | search | general`

### Card Types Emitted
`weather | season | solunar | convergence | pattern | source | pattern-links | alert`

### Critical Constants
```typescript
const BRAIN_RULES = `
CRITICAL RULES:
1. ONLY state facts that come from the provided context data. Never invent data.
2. When you reference brain data, prefix it with "📊 From our data:" or "📊 Based on [N] brain entries:"
3. When the brain has NO relevant data, say clearly: "The brain doesn't have specific data on this yet."
4. NEVER fill in with general knowledge when brain data is missing — acknowledge the gap instead.
5. If you must add general context beyond the data, clearly label it: "General hunting knowledge (not from brain data):"
Never include external URLs, links, or website references in your response. Never recommend external websites or apps. All information comes from Duck Countdown's data.
`;
```

---

## IMPROVEMENT 1: Add `recent_activity` Intent

**Problem:** When users ask "What's happening?", "What is the brain detecting?", or "Show me recent activity," the dispatcher classifies it as `search` or `general`. The vector search embeds a meta-question and looks for cosine similarity against weather/migration/alert entries. It finds nothing because the question is *about* the data, not *like* the data.

**Solution:** Add a 6th intent type: `recent_activity`. This handler does NOT vector-search. It does direct SQL queries to pull the last 24-48 hours of brain activity and summarizes it.

### 1A: Update intent classification prompt in `hunt-dispatcher/index.ts`

Find the classification prompt (the system message sent to Haiku for intent routing). Add `recent_activity` to the list:

```
Classify the user's intent into one of: weather, solunar, season_info, search, recent_activity, general.

Use "recent_activity" when the user asks:
- What's happening / what's going on
- What is the brain detecting / seeing / tracking
- Show me recent activity / recent data / what's new
- Any broad "status update" or "overview" questions
- "What should I know about right now?"
- Questions about current conditions without a specific state
```

### 1B: Build `handleRecentActivity()` in `hunt-dispatcher/index.ts`

```typescript
async function handleRecentActivity(
  supabase: any,
  species: string | null,
  stateAbbr: string | null,
  userMessage: string,
): Promise<HandlerResult> {
  const cards: any[] = [];
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  // 1. Count recent entries by content_type (last 24h)
  const { data: recentCounts } = await supabase
    .from('hunt_knowledge')
    .select('content_type')
    .gte('created_at', twentyFourHoursAgo.toISOString())
    .order('created_at', { ascending: false })
    .limit(1000);

  const typeCounts: Record<string, number> = {};
  (recentCounts || []).forEach((r: any) => {
    typeCounts[r.content_type] = (typeCounts[r.content_type] || 0) + 1;
  });

  // 2. Get high-signal entries (NWS alerts, weather events, migration spikes, anomalies)
  const highSignalTypes = [
    'nws-alert', 'weather-event', 'migration-spike-extreme',
    'migration-spike-significant', 'anomaly-alert', 'disaster-watch',
    'convergence-score', 'correlation-discovery'
  ];

  const { data: highSignals } = await supabase
    .from('hunt_knowledge')
    .select('id, title, content_type, state_abbr, metadata, created_at')
    .in('content_type', highSignalTypes)
    .gte('created_at', fortyEightHoursAgo.toISOString())
    .order('created_at', { ascending: false })
    .limit(30);

  // 3. Get active states (most activity in last 24h)
  const stateCounts: Record<string, number> = {};
  (highSignals || []).forEach((s: any) => {
    if (s.state_abbr) {
      stateCounts[s.state_abbr] = (stateCounts[s.state_abbr] || 0) + 1;
    }
  });
  const topStates = Object.entries(stateCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // 4. Get latest cron activity
  const { data: recentCrons } = await supabase
    .from('hunt_cron_log')
    .select('function_name, status, summary, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  // 5. Build activity summary card
  const activitySummary = {
    type: 'activity',
    total_24h: recentCounts?.length || 0,
    by_type: typeCounts,
    high_signal_count: highSignals?.length || 0,
    top_states: topStates,
    latest_cron: recentCrons?.[0]?.function_name || 'unknown',
    latest_cron_ago: recentCrons?.[0]?.created_at || null,
  };
  cards.push(activitySummary);

  // 6. Build high-signal entries as pattern cards
  const topSignals = (highSignals || []).slice(0, 8);
  if (topSignals.length > 0) {
    cards.push({
      type: 'pattern',
      results: topSignals.map((s: any) => ({
        title: s.title,
        content_type: s.content_type,
        state_abbr: s.state_abbr,
        similarity: 1.0, // direct match, not vector
        metadata: s.metadata,
        created_at: s.created_at,
      })),
    });

    cards.push({
      type: 'source',
      searched: highSignals.length,
      types: [...new Set(topSignals.map((s: any) => s.content_type))],
      similarity_range: 'direct query (last 48h)',
    });
  }

  // 7. Build context for Sonnet
  const contextLines = [
    `## Brain Activity Summary (last 24 hours)`,
    `Total new entries: ${recentCounts?.length || 0}`,
    ``,
    `### Entries by type:`,
    ...Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `- ${type}: ${count}`),
    ``,
    `### High-signal events (last 48 hours):`,
    ...topSignals.map((s: any) =>
      `- [${s.content_type}] ${s.state_abbr || 'National'}: ${s.title} (${s.created_at})`
    ),
    ``,
    `### Most active states:`,
    ...topStates.map(([st, count]) => `- ${st}: ${count} high-signal events`),
    ``,
    `### Latest data pipeline activity:`,
    ...(recentCrons || []).slice(0, 5).map((c: any) =>
      `- ${c.function_name}: ${c.status} at ${c.created_at}`
    ),
  ];

  const systemPrompt = `You are the environmental intelligence brain for Duck Countdown. The user is asking what's happening right now. You have a real-time activity summary from the last 24-48 hours.

Synthesize the data into a clear situational briefing. Lead with the most interesting signals — what's unusual, what's active, what should someone pay attention to. Group by theme (weather events, alerts, migration, anomalies) not by content_type.

If there are flood warnings or severe weather, lead with those. If migration spikes are happening, call them out by state. If anomalies were detected, explain what's anomalous.

Be specific — use state names, event types, and counts. Don't be generic.

End with 1-2 suggested follow-up questions the user could ask to dig deeper into the most interesting signals.

${BRAIN_RULES}`;

  return {
    cards,
    systemPrompt,
    userContent: `${userMessage}\n\n---\n\n${contextLines.join('\n')}`,
  };
}
```

### 1C: Wire into the intent router

In the main handler switch/if block:

```typescript
case 'recent_activity':
  result = await handleRecentActivity(supabase, species, stateAbbr, userMessage);
  break;
```

### 1D: Update ChatMessage.tsx to render `activity` card type

In the FROM THE BRAIN section, add rendering for the new `activity` card:

```tsx
{cards.filter(c => c.type === 'activity').map((card, i) => (
  <div key={`activity-${i}`} className="space-y-1 text-sm">
    <div className="text-cyan-300 font-mono text-xs uppercase tracking-wider">Brain Activity — Last 24h</div>
    <div className="text-white/90">{card.total_24h} new entries embedded</div>
    <div className="text-white/70">{card.high_signal_count} high-signal events</div>
    {card.top_states?.length > 0 && (
      <div className="text-white/70">
        Most active: {card.top_states.map(([st, ct]: [string, number]) => `${st} (${ct})`).join(', ')}
      </div>
    )}
  </div>
))}
```

---

## IMPROVEMENT 2: Fix Empty Brain / Specific Answer Disconnect

**Problem:** In testing, "What's happening in Arkansas?" returned FROM THE BRAIN: "no matching data found" — but then the AI Interpretation included specific Arkansas data with dates and temperatures. The brain search returned empty, but `handleWeather` or `handleGeneral` pulled convergence scores, season data, and web results separately. The FROM THE BRAIN section only displays `pattern` and `source` cards. Other data sources (convergence, weather, season) display in the AI INTERPRETATION section, making it look like the AI made up data the brain didn't have.

**Solution:** Expand what counts as "FROM THE BRAIN" data. If ANY structured data was fetched (convergence scores, weather, season status), show it in the brain section.

### 2A: Modify `ChatMessage.tsx`

Currently, the FROM THE BRAIN section filters for `type === 'pattern'` or `type === 'source'`. Change it to include `convergence`, `weather`, and `season` cards:

```typescript
// BEFORE:
const brainCards = cards.filter(c => c.type === 'pattern' || c.type === 'source');
const aiCards = cards.filter(c => c.type !== 'pattern' && c.type !== 'source');

// AFTER:
const BRAIN_CARD_TYPES = ['pattern', 'source', 'convergence', 'weather', 'activity', 'pattern-links', 'alert'];
const brainCards = cards.filter(c => BRAIN_CARD_TYPES.includes(c.type));
const aiCards = cards.filter(c => !BRAIN_CARD_TYPES.includes(c.type));
```

### 2B: Update the "no data" message logic

```typescript
// BEFORE: Shows "no matching data found" if no pattern cards
// AFTER: Shows "no matching data found" ONLY if ALL brain card types are empty
const hasBrainData = brainCards.length > 0;
```

This way, if convergence scores were fetched for Arkansas (score: 45, components, reasoning), that shows up under FROM THE BRAIN as real data — because it IS real data. The user sees "here's what we have" instead of "nothing found" followed by the AI magically knowing things.

### 2C: Add rendering for convergence/weather cards in the brain section

The convergence and weather cards may already render — check if the existing card renderers are inside the brain section or the AI section. Move them to the brain section. Each card type should have a small cyan-accented renderer:

```tsx
{brainCards.filter(c => c.type === 'convergence').map((card, i) => (
  <div key={`conv-${i}`} className="space-y-1 text-sm">
    <div className="text-cyan-300 font-mono text-xs uppercase tracking-wider">
      Convergence Score — {card.state_abbr}
    </div>
    <div className="text-2xl font-bold text-white">{card.score}/100</div>
    <div className="text-white/70">Rank: #{card.national_rank} nationally</div>
    {card.reasoning && <div className="text-white/60 text-xs">{card.reasoning}</div>}
  </div>
))}

{brainCards.filter(c => c.type === 'weather').map((card, i) => (
  <div key={`wx-${i}`} className="space-y-1 text-sm">
    <div className="text-cyan-300 font-mono text-xs uppercase tracking-wider">
      Current Weather — {card.state_abbr || card.location}
    </div>
    <div className="text-white/90">{card.temp}°F, Wind {card.wind_speed}mph {card.wind_dir}</div>
    {card.precip > 0 && <div className="text-white/70">Precip: {card.precip}"</div>}
  </div>
))}
```

---

## IMPROVEMENT 3: Dynamic Suggested Prompts

**Problem:** `getSuggestedPrompts()` in HuntChat.tsx returns hardcoded prompts by species. They're decent but static. A new user opening the chat with flood warnings active in WA/OR sees generic prompts like "Where are birds moving this week?" instead of "What's driving the flood warnings in Washington?"

**Solution:** On chat panel open, fetch 2-3 dynamic prompts based on the most recent high-signal entries in the brain, plus 1-2 evergreen static prompts.

### 3A: Create a new edge function `hunt-suggested-prompts`

**New file:** `supabase/functions/hunt-suggested-prompts/index.ts`
**Config:** `verify_jwt = false`

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';

serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const supabase = createSupabaseClient();
    const now = new Date();
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Get the most interesting recent entries
    const { data: recentSignals } = await supabase
      .from('hunt_knowledge')
      .select('title, content_type, state_abbr, metadata, created_at')
      .in('content_type', [
        'nws-alert', 'weather-event', 'migration-spike-extreme',
        'migration-spike-significant', 'anomaly-alert', 'disaster-watch',
        'convergence-score', 'correlation-discovery'
      ])
      .gte('created_at', twentyFourHoursAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(50);

    const prompts: string[] = [];

    // Strategy 1: NWS alerts → "What's causing the [alert type] in [state]?"
    const nwsAlerts = (recentSignals || []).filter(s => s.content_type === 'nws-alert');
    if (nwsAlerts.length > 0) {
      const states = [...new Set(nwsAlerts.map(a => a.state_abbr).filter(Boolean))];
      const alertType = nwsAlerts[0]?.title?.split(' ')[0] + ' ' + nwsAlerts[0]?.title?.split(' ')[1]; // e.g. "Flood Warning"
      if (states.length === 1) {
        prompts.push(`What's causing the ${alertType.toLowerCase()}s in ${states[0]}?`);
      } else if (states.length > 1) {
        prompts.push(`${nwsAlerts.length} weather alerts active across ${states.join(', ')} — what's happening?`);
      }
    }

    // Strategy 2: Weather events → "What does the [event type] in [state] mean?"
    const wxEvents = (recentSignals || []).filter(s => s.content_type === 'weather-event');
    if (wxEvents.length > 0) {
      const frontPassages = wxEvents.filter(e => e.title?.includes('front-passage'));
      const pressureDrops = wxEvents.filter(e => e.title?.includes('pressure'));
      if (frontPassages.length > 0) {
        const state = frontPassages[0].state_abbr;
        prompts.push(`A front just passed through ${state} — what usually follows?`);
      } else if (pressureDrops.length > 0) {
        prompts.push(`Pressure changes detected in ${pressureDrops.length} states — what patterns does this match?`);
      }
    }

    // Strategy 3: Migration spikes → "What's driving the migration spike in [state]?"
    const migSpikes = (recentSignals || []).filter(s =>
      s.content_type === 'migration-spike-extreme' || s.content_type === 'migration-spike-significant'
    );
    if (migSpikes.length > 0) {
      const state = migSpikes[0].state_abbr;
      prompts.push(`Migration spike detected in ${state} — what's driving it?`);
    }

    // Strategy 4: Anomalies → "What anomaly was just detected?"
    const anomalies = (recentSignals || []).filter(s => s.content_type === 'anomaly-alert');
    if (anomalies.length > 0) {
      prompts.push(`An anomaly was detected — what's unusual right now?`);
    }

    // Fill remaining slots with evergreen prompts (up to 4 total)
    const evergreenPrompts = [
      "What's the brain detecting right now?",
      "Which states have the strongest signals today?",
      "Show me the most interesting data from the last 24 hours",
      "How accurate have the brain's predictions been?",
      "What patterns are converging across the country?",
    ];

    let idx = 0;
    while (prompts.length < 4 && idx < evergreenPrompts.length) {
      prompts.push(evergreenPrompts[idx]);
      idx++;
    }

    return successResponse({ prompts: prompts.slice(0, 4) });
  } catch (error) {
    return errorResponse(error.message, 500);
  }
});
```

### 3B: Modify `HuntChat.tsx` to fetch dynamic prompts

Replace the static `getSuggestedPrompts()` with a fetch on mount:

```typescript
const [suggestedPrompts, setSuggestedPrompts] = useState<string[]>([
  // Fallback static prompts while loading
  "What's the brain detecting right now?",
  "Which states have the strongest signals?",
  "Any significant weather events forming?",
  "Show me the most interesting data from the last 24 hours",
]);

useEffect(() => {
  const fetchPrompts = async () => {
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hunt-suggested-prompts`,
        {
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
        }
      );
      const { prompts } = await res.json();
      if (prompts?.length > 0) setSuggestedPrompts(prompts);
    } catch (e) {
      console.warn('[HuntChat] Failed to fetch dynamic prompts, using defaults');
    }
  };
  fetchPrompts();
}, []);
```

Remove the `getSuggestedPrompts()` function and its species-specific hardcoded prompts.

---

## IMPROVEMENT 4: Context-Aware Welcome State

**Problem:** The initial chat state shows "486K+ data points from 21 sources. Ask me anything." — static, doesn't tell you the brain is alive or what it's currently tracking.

**Solution:** Replace the static subtitle with a live status line pulled from the same data as the dynamic prompts (or from the heartbeat data the frontend already has).

### 4A: Modify the welcome state in `HuntChat.tsx`

The initial state currently shows:
```
The Brain
486K+ data points from 21 sources. Ask me anything.
```

Change to include a live activity line. The heartbeat/ticker already fetches recent cron logs — reuse that data or add a lightweight fetch:

```tsx
// In the welcome/initial state JSX:
<div className="text-center space-y-3">
  <BrainIcon className="w-10 h-10 text-cyan-400 mx-auto" />
  <div className="text-lg font-semibold text-white">The Brain</div>
  <div className="text-sm text-white/50">
    {brainStats
      ? `${brainStats.total_entries} entries from ${brainStats.sources} sources. Last update: ${brainStats.last_update_ago}.`
      : '486K+ data points from 21 sources. Ask me anything.'}
  </div>
  {/* Live status line */}
  {recentActivity && (
    <div className="text-xs text-cyan-400/70 font-mono">
      {recentActivity.alerts > 0 && `${recentActivity.alerts} alerts active · `}
      {recentActivity.events_1h > 0 && `${recentActivity.events_1h} events (1h) · `}
      {recentActivity.last_embed_ago}
    </div>
  )}
</div>
```

The `brainStats` and `recentActivity` can be fetched from the same `hunt-suggested-prompts` endpoint (extend it to return stats alongside prompts) or pulled from the existing BrainHeartbeat component's data.

---

## IMPROVEMENT 5: System Prompt Rewrite for Environmental Intelligence

**Problem:** The handler system prompts still center hunting. `handleGeneral` says "You help with US environmental patterns, weather intelligence, wildlife signals, solunar data, **and hunting season information when asked**." Haiku's responses sometimes say "Duck Countdown Brain" and "hunting or wildlife patterns." The suggested follow-up example says "What patterns should I watch for duck hunting in Arkansas this week?"

**Solution:** Rewrite every handler's system prompt to lead with environmental intelligence. Hunting is one lens, not the identity.

### 5A: Replace `BRAIN_RULES`

```typescript
const BRAIN_RULES = `
CRITICAL RULES:
1. ONLY state facts that come from the provided context data. Never invent data.
2. When you reference brain data, prefix it with "📊 From our data:" or "📊 Based on [N] brain entries:"
3. When the brain has NO relevant data, say clearly: "The brain doesn't have specific data on this yet."
4. NEVER fill in with general knowledge when brain data is missing — acknowledge the gap instead.
5. If you must add general context beyond the data, clearly label it: "General context (not from brain data):"
6. Never include external URLs, links, or website references in your response. All information comes from the brain's embedded data.
7. You are an environmental intelligence system, not a chatbot. Lead with data. Be specific — state names, numbers, dates, signal types.
8. When suggesting follow-up questions, frame them around environmental signals and patterns, not just hunting.
`;
```

### 5B: Rewrite `handleGeneral` system prompt

```typescript
// BEFORE:
"You are the Duck Countdown Brain — an environmental intelligence assistant. You help with US environmental patterns, weather intelligence, wildlife signals, solunar data, and hunting season information when asked."

// AFTER:
"You are an environmental intelligence engine tracking patterns across weather, migration, water levels, atmospheric pressure, solunar cycles, drought, and wildlife behavior across all 50 US states. You synthesize data from 21+ sources into actionable intelligence. When users ask about hunting, provide that lens. But your core function is environmental pattern recognition — detecting convergences, anomalies, and historical matches that reveal what's happening in the natural world right now."
```

### 5C: Rewrite `handleWeather` system prompt

```typescript
// BEFORE:
"You are an environmental weather analyst. Give a brief, practical weather intelligence summary. Focus on wind shifts, temperature changes, pressure systems, and precipitation patterns..."

// AFTER:
"You are an environmental weather analyst. Synthesize the provided weather data into a situational intelligence briefing. Lead with what's unusual or significant — front passages, pressure anomalies, temperature shifts, severe weather. Connect weather events to their downstream effects: how does this pressure drop affect migration? How does this temperature change affect wildlife behavior? What historically happens when these conditions align? Be specific with numbers and states."
```

### 5D: Rewrite `handleSearch` system prompt

```typescript
// BEFORE:
"You are an environmental intelligence analyst. Answer based on the provided context. Be concise but informative."

// AFTER:
"You are an environmental intelligence analyst with access to a brain containing 486K+ embedded data entries across weather, migration, water, drought, NWS alerts, solunar, convergence scores, and historical patterns. Answer based on the provided context. When brain data matches the query, synthesize it into a clear answer. When patterns match, explain what they suggest — not what WILL happen, but what happened historically when these conditions aligned. Cite the number of brain entries and their content types."
```

### 5E: Remove species-specific context injection from `handleGeneral`

The current `handleGeneral` injects species-specific context about rut cycles, gobble timing, etc. Keep this data available but don't lead with it. Only inject species context if the user's query specifically mentions a species or hunting.

```typescript
// Only include species context if species was explicitly mentioned or selected
const includeSpeciesContext = species && species !== 'all';
if (includeSpeciesContext) {
  systemPrompt += `\n\nThe user is focused on ${species}. Include relevant ${species}-specific behavioral patterns where applicable.`;
}
```

---

## IMPROVEMENT 6: Fix Follow-Up Example Copy

**Problem:** The AI response ends with "What patterns should I watch for duck hunting in Arkansas this week?" — hunting-framed.

**Solution:** This comes from the BRAIN_RULES or handler system prompt. Add an explicit instruction:

### 6A: Add to BRAIN_RULES (or to each handler prompt)

```
When suggesting follow-up questions, frame them around environmental intelligence, not just hunting. Good examples:
- "What patterns are converging in [state] right now?"
- "How do current conditions compare to the same week last year?"
- "What usually follows when these conditions align?"
- "Which states are showing the most unusual activity?"
Bad examples (avoid):
- "What patterns should I watch for duck hunting in [state]?"
- "Best spots for [species] in [state]?"
```

---

## IMPROVEMENT 7: Surface Brain Self-Knowledge (Post-Alert-Grader)

**Problem:** Once the self-improving alert feedback loop is running (see BUILD-SPEC-SELF-IMPROVING-ALERTS.md), the brain will contain `alert-grade` and `alert-calibration` entries. Users should be able to ask "How accurate are your predictions?" and get the brain's own accuracy data.

**Solution:** Add a 7th intent: `self_assessment`. Routes to a handler that queries alert-grade and alert-calibration entries.

### 7A: Add to classification prompt

```
Use "self_assessment" when the user asks:
- How accurate are you / your predictions
- Have you been right / wrong
- Show me your track record / accuracy / performance
- How reliable are your alerts
- What have you gotten wrong
```

### 7B: Build `handleSelfAssessment()` handler

```typescript
async function handleSelfAssessment(
  supabase: any,
  species: string | null,
  stateAbbr: string | null,
  userMessage: string,
): Promise<HandlerResult> {
  const cards: any[] = [];

  // 1. Fetch calibration data
  const { data: calibrations } = await supabase
    .from('hunt_alert_calibration')
    .select('*')
    .eq('window_days', 90)
    .order('accuracy_rate', { ascending: false });

  // 2. Fetch recent grades
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentGrades } = await supabase
    .from('hunt_knowledge')
    .select('title, content, content_type, state_abbr, metadata, created_at')
    .in('content_type', ['alert-grade', 'alert-calibration', 'forecast-accuracy', 'migration-report-card', 'convergence-report-card'])
    .gte('created_at', thirtyDaysAgo)
    .order('created_at', { ascending: false })
    .limit(20);

  // 3. Build cards
  if (recentGrades?.length > 0) {
    cards.push({
      type: 'pattern',
      results: recentGrades.map((g: any) => ({
        title: g.title,
        content_type: g.content_type,
        state_abbr: g.state_abbr,
        similarity: 1.0,
        metadata: g.metadata,
        created_at: g.created_at,
      })),
    });

    cards.push({
      type: 'source',
      searched: recentGrades.length,
      types: [...new Set(recentGrades.map((g: any) => g.content_type))],
      similarity_range: 'direct query (last 30 days)',
    });
  }

  // 4. Build context
  const contextLines = [
    `## Brain Self-Assessment Data`,
    ``,
    `### Alert Calibration (90-day rolling):`,
    ...(calibrations || []).map((c: any) =>
      `- ${c.alert_source}${c.state_abbr ? ` (${c.state_abbr})` : ' (national)'}: ${(Number(c.accuracy_rate) * 100).toFixed(0)}% accuracy over ${c.total_alerts} alerts (${c.confirmed} confirmed, ${c.false_alarm} false alarms)`
    ),
    ``,
    `### Recent Grades (last 30 days):`,
    ...(recentGrades || []).map((g: any) =>
      `- [${g.content_type}] ${g.title} (${g.created_at})`
    ),
  ];

  const systemPrompt = `You are reporting on your own prediction accuracy. Be honest and specific. Show the numbers. If accuracy is low in some areas, say so and explain what you think went wrong. If accuracy is high, cite the evidence. Users trust transparency more than perfection.

Frame it as: "Here's how I've been performing." Not: "Here's how accurate AI is in general."

If no calibration data exists yet (the grading system is new), say so honestly: "The self-grading system just started — I don't have enough data yet to report accuracy. Check back in a week."

${BRAIN_RULES}`;

  return {
    cards,
    systemPrompt,
    userContent: `${userMessage}\n\n---\n\n${contextLines.join('\n')}`,
  };
}
```

**NOTE:** This handler depends on BUILD-SPEC-SELF-IMPROVING-ALERTS.md being implemented first. Build this last.

---

## BUILD ORDER

1. **Improvement 6** (copy fix) — 5 minutes. Just add the follow-up framing instructions to BRAIN_RULES. Deploy.
2. **Improvement 5** (system prompt rewrite) — 30 minutes. Rewrite all 6 handler system prompts + BRAIN_RULES. Deploy dispatcher.
3. **Improvement 2** (fix empty brain disconnect) — 1 hour. Modify ChatMessage.tsx card filtering. Deploy frontend.
4. **Improvement 1** (recent_activity intent) — 2-3 hours. New handler in dispatcher, new card type in ChatMessage.tsx. Deploy both.
5. **Improvement 4** (live welcome state) — 1 hour. Extend suggested-prompts endpoint to return stats, update HuntChat.tsx. Deploy both.
6. **Improvement 3** (dynamic prompts) — 2 hours. Build hunt-suggested-prompts edge function, update HuntChat.tsx. Deploy both.
7. **Improvement 7** (self-assessment) — 2 hours. New handler + intent. Depends on alert grader being live with data. Deploy last.

Total estimate: ~1-2 days of focused work.

---

## FILES TO MODIFY

| File | Changes |
|------|---------|
| `supabase/functions/hunt-dispatcher/index.ts` | Add `recent_activity` + `self_assessment` intents, rewrite all system prompts, update BRAIN_RULES, add 2 new handlers |
| `src/components/HuntChat.tsx` | Remove static getSuggestedPrompts(), add dynamic prompt fetch, update welcome state |
| `src/components/ChatMessage.tsx` | Expand brain card types, add activity/convergence/weather card renderers to FROM THE BRAIN section |
| `supabase/functions/hunt-suggested-prompts/index.ts` | NEW — dynamic prompt generation |
| `supabase/config.toml` | Add hunt-suggested-prompts function config |

---

## TESTING CHECKLIST

- [ ] "What's happening right now?" returns actual brain activity data (not empty)
- [ ] "What's happening in Arkansas?" shows convergence score in FROM THE BRAIN section
- [ ] Suggested prompts reference actual current events (NWS alerts, weather events)
- [ ] Welcome state shows live entry count and last update time
- [ ] AI responses don't say "Duck Countdown Brain" — they say "the brain" or "the system"
- [ ] Follow-up suggestions are environmental-framed, not hunting-framed
- [ ] "How accurate are your predictions?" triggers self_assessment handler (after alert grader is live)
- [ ] Species-specific context only appears when species is explicitly selected
- [ ] FROM THE BRAIN is never empty when convergence/weather cards are present
- [ ] All existing queries (flood patterns, season info, solunar) still work correctly
