# BUILD SPEC: Domain-Agnostic Refactor

The platform is an environmental intelligence system. Birds are one signal domain — not THE signal domain. The code currently injects "hunting" and "duck" into search queries, system prompts, score labels, and UI text so aggressively that the brain literally can't respond about anything else. This spec fixes that layer by layer.

**Rule of thumb:** If a farmer, emergency manager, or ecologist would feel like they opened the wrong app — it needs to change.

---

## CRITICAL: Search Query Injection (hunt-dispatcher/index.ts)

This is the #1 reason the system responds bird-heavy. The dispatcher hardcodes hunting terms into every brain search query, so the vector search always returns bird-adjacent results regardless of what the user asked.

### Fix 1: Weather handler search query
**File:** `supabase/functions/hunt-dispatcher/index.ts`
**Line ~719:**
```typescript
// CURRENT (broken)
query: `${state.name} duck hunting weather conditions ${query}`,

// FIX
query: `${state.name} weather conditions environmental patterns ${query}`,
```

### Fix 2: Solunar handler search query
**Line ~863:**
```typescript
// CURRENT (broken)
query: `${state.name} solunar moon phase feeding times hunting ${query}`,

// FIX
query: `${state.name} solunar moon phase activity patterns ${query}`,
```

### Fix 3: Season info handler search query
**Line ~934:**
```typescript
// CURRENT (broken)
query: `${species} hunting season regulations ${stateAbbr} ${query}`,

// FIX — only inject species if one is selected
query: species && species !== 'all'
  ? `${species} behavioral patterns seasonal timing ${stateAbbr} ${query}`
  : `environmental seasonal patterns ${stateAbbr} ${query}`,
```

### Fix 4: Convergence engine pattern search
**File:** `supabase/functions/hunt-convergence-engine/index.ts`
**Line ~215:**
```typescript
// CURRENT (broken) — this is the worst one
const searchText = `${stateName} hunting conditions: ${weatherDetails}, ${moonPhase}, ${migrationDetails}`;

// FIX
const searchText = `${stateName} environmental conditions: ${weatherDetails}, ${moonPhase}, ${migrationDetails}`;
```

---

## CRITICAL: Default Species Fallback

The dispatcher defaults to `'duck'` in 4+ places when no species is selected. This means every unfiltered query gets duck-biased results.

### Fix 5: Change all default species from 'duck' to 'all'
**File:** `supabase/functions/hunt-dispatcher/index.ts`
**Lines ~331, ~369, ~380, ~405:**
```typescript
// CURRENT (broken) — appears in multiple places
const resolvedSpecies = intentSpecies || ctxSpecies || 'duck';
// and
`Selected species: ${ctxSpecies || 'duck'}`

// FIX — every instance
const resolvedSpecies = intentSpecies || ctxSpecies || 'all';
// and
`Selected species: ${ctxSpecies || 'all'}`
```

### Fix 6: Search handler duck-specific logic
**Line ~1061:**
```typescript
// CURRENT
const searchQuery = species !== 'duck' ? `${species} ${query}` : query;

// FIX
const searchQuery = species && species !== 'all' ? `${species} ${query}` : query;
```

---

## HIGH: Intent Classification Prompt

The Haiku intent classifier describes itself as "Duck Countdown Brain" and uses hunting vocabulary to classify intents.

### Fix 7: Intent classification system prompt
**File:** `supabase/functions/hunt-dispatcher/index.ts`
**Lines ~326-354:**
```typescript
// CURRENT (multiple lines)
"You are the Duck Countdown Brain — an environmental intelligence system..."
"You can answer questions about environmental patterns, weather intelligence, wildlife movement, and — when asked — hunting conditions and season dates."
"Use 'weather' for questions about weather, wind, temperature, conditions for hunting."
"Use 'solunar' for moon phase, feeding times, best hunting times, solunar."
"Use 'season_info' for when does season open/close, bag limits, dates, regulations."
"Use 'search' for searching for hunting knowledge, tips, regulations, general hunting info."

// FIX
"You are an environmental intelligence engine monitoring patterns across 21+ data sources for all 50 US states."
"You can answer questions about environmental patterns, weather intelligence, wildlife movement, ecological timing, and resource conditions."
"Use 'weather' for questions about weather, wind, temperature, pressure, fronts, environmental conditions."
"Use 'solunar' for moon phase, tidal influence, activity cycles, solunar patterns."
"Use 'season_info' for species lifecycle timing, seasonal transitions, regulatory dates."
"Use 'search' for environmental knowledge, ecological patterns, historical data, general information."
```

---

## HIGH: System Prompts for Response Generation

These prompts tell Sonnet how to frame responses. Several explicitly say "hunting."

### Fix 8: Solunar handler system prompt
**Line ~903:**
```typescript
// CURRENT
"You are a solunar and lunar phase analyst for outdoor activity planning. Summarize the solunar forecast briefly, noting key feeding windows and moon phase."

// FIX
"You are a solunar and lunar phase analyst for environmental pattern analysis. Summarize the solunar data briefly, noting peak activity periods and moon phase."
```

### Fix 9: Season info handler system prompt
**Line ~1008:**
```typescript
// CURRENT
"You are a hunting season expert. Summarize the season information briefly. Include key dates and bag limits."

// FIX
"You are a species behavior and regulatory expert. Summarize the season information briefly. Include key dates and any applicable limits."
```

### Fix 10: General handler system prompt
**Line ~1228:**
```typescript
// CURRENT
"When users ask about hunting, provide that lens."

// FIX — remove entirely, or:
"Adapt your framing to the user's context — hunting, agriculture, ecology, or general environmental awareness."
```

---

## HIGH: Convergence Score Labels (UI-facing)

These are what users see when they look at scores. "Tough hunting" tells a farmer this isn't for them.

### Fix 11: Score guide labels
**File:** `src/components/cards/ConvergenceCard.tsx`
**Lines ~142-146:**
```typescript
// CURRENT
{ color: '#ef4444', label: '80-100 — Outstanding. Drop everything and go.' }
{ color: '#f97316', label: '60-79 — Strong. Solid day, worth the trip.' }
{ color: '#eab308', label: '40-59 — Fair. Average conditions.' }
{ color: '#3b82f6', label: '20-39 — Poor. Tough hunting.' }
{ color: '#6b7280', label: '0-19 — Skip it. Stay home.' }

// FIX
{ color: '#ef4444', label: '80-100 — Exceptional. Multiple signals converging.' }
{ color: '#f97316', label: '60-79 — Strong. Clear pattern alignment.' }
{ color: '#eab308', label: '40-59 — Moderate. Mixed conditions.' }
{ color: '#3b82f6', label: '20-39 — Weak. Limited convergence.' }
{ color: '#6b7280', label: '0-19 — Minimal. Insufficient signal activity.' }
```

---

## HIGH: Convergence Engine Reasoning Text

The convergence engine builds the reasoning strings that appear in alerts and panels.

### Fix 12: Reasoning labels
**File:** `supabase/functions/hunt-convergence-engine/index.ts`
**Lines ~432-440:**
```typescript
// CURRENT
"Moon favorable: ..."  // favorable for what? hunting
"Migration elevated: ..."  // implies "time to go hunting"

// FIX
"Lunar cycle: ..."
"Migration activity: ..."
```

---

## HIGH: Alert Branding

Every alert notification says "DUCK COUNTDOWN ALERT" — a farmer in Iowa gets this on their phone.

### Fix 13: Alert message template
**File:** `supabase/functions/hunt-convergence-alerts/index.ts`
**Lines ~255-261:**
```typescript
// CURRENT
const alertMessage = [
  `DUCK COUNTDOWN ALERT -- ${stateName}`,
  `Score: ${candidate.score}/100 (was ${candidate.previous_score}/100)`,
  candidate.reasoning,
  ``,
  `Data from duckcountdown.com`,
].join('\n');

// FIX
const alertMessage = [
  `ENVIRONMENTAL ALERT -- ${stateName}`,
  `Convergence Score: ${candidate.score}/100 (was ${candidate.previous_score}/100)`,
  candidate.reasoning,
  ``,
  `Data from duckcountdown.com`,
].join('\n');
```

---

## HIGH: Daily Brief / Scout Report

### Fix 14: Scout report branding and labels
**File:** `supabase/functions/hunt-scout-report/index.ts`
**Line ~58:**
```typescript
// CURRENT
let brief = `DUCK COUNTDOWN DAILY BRIEF -- ${today}\n\n`;

// FIX
let brief = `ENVIRONMENTAL INTELLIGENCE BRIEF -- ${today}\n\n`;
```

**Lines ~64:** The `[HOT]`, `[WARM]`, `[COLD]` labels are fine as signal strength indicators — they work in any domain. Keep them.

---

## HIGH: Help Modal Onboarding

### Fix 15: Signal domain descriptions
**File:** `src/components/HelpModal.tsx`
**Line ~25:**
```typescript
// CURRENT
"Use the signal domain selector in the header to filter by biological indicator type: All Signals, Waterfowl, Big Game, Upland, or specific species."

// FIX
"Use the signal domain selector to filter by biological indicator type: All Signals shows cross-domain convergence. Individual species domains weight the scoring toward that species' environmental sensitivities."
```

---

## HIGH: Auth Page Branding

### Fix 16: Login page subtitle
**File:** `src/pages/Auth.tsx`
**Lines ~30-35:**
```typescript
// CURRENT
"Hunting Intelligence Platform"

// FIX
"Environmental Intelligence Platform"
```

---

## MEDIUM: State Facts

The entire `stateFacts.ts` file (~160+ lines) is written from a hunting perspective. Every state fact references hunting destinations, harvest numbers, and game management areas.

### Fix 17: Rewrite state facts
**File:** `src/data/stateFacts.ts`

Don't rewrite all 50 at once. Reframe each fact from "great place to hunt X" to "ecologically significant for X because Y":

```typescript
// CURRENT (Arkansas example)
"Stuttgart, AR is known as the 'Duck Hunting Capital of the World.'"
"The flooded timber of Bayou Meto WMA offers legendary mallard hunting."

// FIX
"Stuttgart, AR sits at the heart of the Mississippi Flyway — one of the densest waterfowl staging areas in North America."
"The flooded timber of Bayou Meto WMA provides critical winter habitat for mallard populations migrating through the Central Mississippi Valley."
```

The facts should explain WHY the environment matters, not how to hunt there.

---

## MEDIUM: Data Source Catalog Descriptions

### Fix 18: Source descriptions
**File:** `src/data/dataSourceCatalog.ts`
**Line ~13:**
```typescript
// CURRENT
'50-state 16-day forecast + hunting event detection'

// FIX
'50-state 16-day forecast + environmental event detection'
```

**Line ~42:**
```typescript
// CURRENT
'152 behavioral entries across 39 waterfowl + game'

// FIX
'152 behavioral entries across 39 monitored species'
```

---

## MEDIUM: Type Definitions

### Fix 19: HuntingSeason interface
**File:** `src/data/types.ts`
**Lines ~21-36:**
```typescript
// CURRENT
interface HuntingSeason {
  bagLimit: string;
  seasonType: "regular" | "early-teal" | "youth" | "archery" | "rifle" | ...
}

// FIX — rename interface, rename field
interface RegulatedSeason {
  harvestLimit: string;  // or just 'limit'
  seasonType: string;    // keep the values, just widen the type
}
```
**Note:** This is a deeper refactor — `bagLimit` and `HuntingSeason` are referenced in multiple files. Search for all usages before renaming.

---

## MEDIUM: Season Card Display

### Fix 20: Bag limit label
**File:** `src/components/cards/SeasonCard.tsx`
**Line ~52:**
```typescript
// CURRENT
Bag limit: {bagLimit}

// FIX
Limit: {harvestLimit}
```

**File:** `src/components/StateProfile.tsx`
**Line ~556:**
```typescript
// CURRENT
Bag: {s.bagLimit}

// FIX
Limit: {s.harvestLimit}
```

---

## LOW (but important): exclude_du_report flag

### Fix 21: DU report exclusion
**File:** `supabase/functions/hunt-dispatcher/index.ts`

Multiple handlers set `exclude_du_report: true` which prevents Ducks Unlimited articles from appearing in non-duck queries. This is actually fine as-is — DU reports are species-specific content. But when species is `'duck'` or `'all'`, they should be included. Check that the logic is:
```typescript
exclude_du_report: species !== 'duck' && species !== 'all'
```

---

## LOW: Internal naming (hunt_ prefix)

The `hunt_` prefix on database tables (`hunt_knowledge`, `hunt_pattern_links`, etc.) and edge function names (`hunt-dispatcher`, `hunt-search`) is internal infrastructure. Users never see it. **Do NOT rename these** — it would break everything for zero user-facing benefit. Focus on what users see and what the AI says.

---

## WHAT NOT TO CHANGE

- **"DUCK COUNTDOWN" brand name** — this is the product name. It stays. The subtitle "ENVIRONMENTAL INTELLIGENCE" is already correct.
- **`hunt_` table prefixes** — internal only, not user-facing
- **`hunt-` edge function names** — internal only
- **Species selector values** (duck, goose, deer, turkey, dove) — these are valid signal domains. The issue isn't that they exist, it's that 'duck' is the default and the system assumes everyone wants duck data.
- **BRAIN_RULES** — already explicitly says "frame around environmental signals, not hunting." Leave it.
- **`[HOT]` / `[WARM]` / `[COLD]` labels** — these work for any domain as signal strength indicators.

---

## EXECUTION ORDER

Do these in order — each one unlocks more value:

1. **Fixes 1-4** (search query injection) — removes the hunting filter from brain queries. Immediate impact: the brain can finally talk about non-bird data.
2. **Fixes 5-6** (default species) — stops assuming every user cares about ducks.
3. **Fixes 7-10** (system prompts) — the AI stops framing everything as hunting intelligence.
4. **Fix 11** (convergence labels) — removes "Tough hunting" from the UI.
5. **Fixes 13-14** (alerts + daily brief) — notifications stop saying DUCK COUNTDOWN ALERT.
6. **Fixes 15-16** (help modal + auth page) — onboarding doesn't scare off non-hunters.
7. **Fixes 12, 17-20** (reasoning text, state facts, types) — deeper cleanup, do as time allows.

After all fixes: the brain has 2M entries of environmental data across storms, water, earthquakes, fire, weather, crops, bird migration, drought, climate indices. The system should let ALL of that data speak — birds are one signal, not the only signal.

---

## VERIFICATION

After applying fixes, test with these queries that should NOT return bird-heavy results:

1. "What environmental patterns are converging in Iowa right now?" → should show weather + water + crops + any bird data, not ONLY bird data
2. "What happened last time these conditions aligned in Oklahoma?" → should pull from storm events, drought, USGS water, not just migration data
3. "What's the brain detecting?" → should surface the most interesting signals across ALL content types
4. "Show me flood risk patterns in Louisiana" → should pull USGS water + NWS alerts + storm events, not DU migration reports
5. Select species "all" → convergence scoring and brain responses should be truly cross-domain
