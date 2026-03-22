# BUILD SPEC: Dispatcher Historical Search Fix + Thesis Test Gaps

**Date:** March 21, 2026
**Priority:** CRITICAL — this is the #1 user-facing bug
**Context:** Thesis test scored 9/12 HITs, 3 PARTIALs, 0 MISSes. The raw search API (hunt-search) works perfectly. But the AI chat (hunt-dispatcher) can't access historical data — it only shows last 48 hours. This means users chatting with the brain get "no data found" for historical queries even though the data is right there.

---

## FIX 1: Dispatcher Historical Search (CRITICAL)

**Problem:** When a user asks "What happened in Texas in February 2021?" the dispatcher responds "The brain has no stored entries covering February 2021 in Texas" — but hunt-search returns 20 perfect storm-event matches with 0.739 similarity.

**Root cause:** The dispatcher's search/general intent handlers query recent brain activity (last 48 hours) instead of calling hunt-search with date filters extracted from the user's query.

**File:** `supabase/functions/hunt-dispatcher/index.ts`

### What to do:

1. **Extract temporal references from user queries.** When Haiku classifies intent, also extract any date/time references from the message. Examples:
   - "February 2021" → `date_from: "2021-02-01", date_to: "2021-02-28"`
   - "last summer" → calculate relative dates
   - "August 2023" → `date_from: "2023-08-01", date_to: "2023-08-31"`
   - No time reference → don't set date filters (search full brain)

2. **Pass date filters to hunt-search.** The search handler in the dispatcher needs to call hunt-search (or directly call the search_hunt_knowledge_v3 RPC) with `date_from` and `date_to` when temporal references are present.

3. **For the `search` intent handler:** Currently it queries recent activity. It should instead:
   - Call hunt-generate-embedding with the user's query
   - Call search_hunt_knowledge_v3 RPC with the embedding + date filters
   - Pass results to Sonnet for response generation

4. **For the `general` intent handler:** Same fix — if the query mentions a specific time period, do a historical vector search, not a recent activity scan.

### Verification:
```
Query: "What happened in Texas in February 2021?"
Expected: Dispatcher returns storm-event data (Winter Storm, Ice Storm) for TX Feb 2021
Currently returns: "The brain has no stored entries covering February 2021"
```

```
Query: "What environmental conditions converged in Hawaii in August 2023?"
Expected: Fire-activity + drought-weekly + storm-event data for HI Aug 2023
Currently returns: Works via Tavily web search fallback, but should use brain data first
```

---

## FIX 2: Deduplicate Storm Events in Search Results

**Problem:** Some queries return duplicate entries (same title, same similarity score, same date). Example: Texas Freeze query returned "Extreme Cold/Wind Chill EL PASO TX 2011-02-01" twice at identical 0.774 similarity.

**File:** `supabase/functions/hunt-search/index.ts`

### What to do:
After getting vector results from search_hunt_knowledge_v3, deduplicate by `id` or by `title + effective_date` combo before returning to the client. Simple filter:

```typescript
const seen = new Set();
const deduped = vectorResults.filter(r => {
  const key = `${r.title}-${r.effective_date}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
```

---

## FIX 3: Recency Weight Tuning

**Problem:** Test 11 (drought-crop-bird chain for 2022) returned 2012 drought data instead of 2022 when no date filter was set. The vector embeddings for "drought crop failure Great Plains" are semantically similar across years, so the brain returns the oldest matching data.

**File:** `supabase/functions/hunt-search/index.ts`

### What to do:
When no date filters are provided, set a default `recency_weight` of 0.1 (currently defaults to 0.0). This gives a slight boost to more recent data without excluding historical records:

```typescript
recency_weight: recency_weight ?? 0.1,  // was 0.0
```

This way, when two entries have similar vector similarity, the more recent one ranks higher.

---

## FIX 4: IVFFlat Index Tuning

**Problem:** The search_hunt_knowledge_v3 RPC currently sets `SET LOCAL hnsw.ef_search = 80` — but the index is IVFFlat, not HNSW. This setting is ignored.

**File:** `supabase/migrations/` (or run directly in SQL Editor)

### What to do:
In the RPC function body, change:
```sql
-- WRONG (ignored for IVFFlat):
SET LOCAL hnsw.ef_search = 80;

-- CORRECT:
SET LOCAL ivfflat.probes = 10;
```

The `probes` value controls how many index partitions are searched. Rule of thumb: `probes = sqrt(lists)`. For ~2M rows with default lists, probes of 10-20 is a good starting point. Higher = more accurate but slower.

Also verify the IVFFlat index has enough lists. For 2M rows:
```sql
-- Check current index:
SELECT indexdef FROM pg_indexes WHERE indexname LIKE '%hunt_knowledge%embedding%';

-- If lists < 1000, recreate:
-- DROP INDEX idx_hunt_knowledge_embedding;
-- CREATE INDEX idx_hunt_knowledge_embedding ON hunt_knowledge
--   USING ivfflat (embedding vector_cosine_ops) WITH (lists = 1414);
-- (sqrt(2000000) ≈ 1414)
```

**WARNING:** Recreating the index on 2M rows will take several minutes. Do this during low-traffic time.

---

## FIX 5: USGS Water Data Gap

**Problem:** Test 7 (Mississippi River Drought 2022) returned drought storm-events but no USGS water level data. The brain should have water gauge readings that show the Mississippi at record lows.

### What to do:
Check if hunt_knowledge has usgs-water entries for the Mississippi River basin in fall 2022:
```sql
SELECT COUNT(*), MIN(effective_date), MAX(effective_date)
FROM hunt_knowledge
WHERE content_type = 'usgs-water'
AND state_abbr IN ('MS', 'MO', 'TN', 'AR', 'LA', 'IL')
AND effective_date BETWEEN '2022-06-01' AND '2022-12-31';
```

If count is 0 or very low, the USGS water ingestion (hunt-weather-watchdog or a dedicated USGS function) may not have been running during that period, or historical USGS data hasn't been backfilled. Consider a targeted backfill of USGS daily streamflow data for major Mississippi River gauges (Memphis, St. Louis, Vicksburg, Baton Rouge) for 2022.

---

## FIX 6: Earthquake-Event Data Check

**Problem:** Test 12 (earthquake + biology) returned birdcast data for Kansas but no earthquake-event records. The brain should have 70K+ earthquake entries per CLAUDE.md.

### What to do:
Verify earthquake data exists:
```sql
SELECT COUNT(*), MIN(effective_date), MAX(effective_date)
FROM hunt_knowledge
WHERE content_type = 'earthquake-event';
```

If the data exists but didn't surface in the query, the embeddings for earthquake events may not be semantically close to "bird behavior anomaly." This is expected — the AI synthesis layer is what connects these. Low priority until synthesis is running.

---

## Execution Order

1. **FIX 1** — Dispatcher historical search (CRITICAL, do first)
2. **FIX 2** — Dedup search results (quick win)
3. **FIX 3** — Recency weight default (one-line change)
4. **FIX 4** — IVFFlat probes setting (SQL change)
5. **FIX 5** — USGS water data gap check (diagnostic, then backfill if needed)
6. **FIX 6** — Earthquake data check (diagnostic only)

## Verification After Fixes

Run these queries through the CHAT (not raw search) and confirm they return brain data:

| Query | Expected Result |
|-------|-----------------|
| "What happened in Texas in February 2021?" | Storm-event data: Winter Storm, Ice Storm, TX, Feb 2021 |
| "What environmental conditions converged in Hawaii August 2023?" | Fire-activity + drought + storm-event for HI |
| "What was happening with the Mississippi River in fall 2022?" | Drought data + ideally USGS water levels |
| "Are there patterns in spring bird migration timing?" | bio-environmental-correlation entries (0.86 sim) |
| "What extreme temperatures hit Oregon in June 2021?" | Excessive Heat storm-events for OR |
