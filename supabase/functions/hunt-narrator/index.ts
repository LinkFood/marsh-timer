import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse, cronResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { generateEmbedding } from '../_shared/embedding.ts';
import { callClaude, parseTextContent, calculateCost, CLAUDE_MODELS } from '../_shared/anthropic.ts';
import { logCronRun } from '../_shared/cronLog.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PatternLink {
  id: string;
  source_id: string;
  matched_id: string;
  similarity: number;
  source_content_type: string;
  matched_content_type: string;
  state_abbr: string | null;
  created_at: string;
}

interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  content_type: string;
  state_abbr: string | null;
  effective_date: string | null;
  metadata: Record<string, unknown> | null;
}

interface GeometricEvent {
  type: 'pattern_link';
  link: PatternLink;
  source_entry: KnowledgeEntry | null;
  matched_entry: KnowledgeEntry | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PER_RUN = 5;
const LOOKBACK_HOURS = 48;
const MIN_SIMILARITY = 0.6;

// Cross-domain means source and matched content types are different
function isCrossDomain(sourceType: string, matchedType: string): boolean {
  // Strip suffixes to get the domain root (e.g., "weather-event" → "weather", "migration-spike-extreme" → "migration")
  const domainOf = (ct: string): string => ct.split('-')[0];
  return domainOf(sourceType) !== domainOf(matchedType);
}

// ---------------------------------------------------------------------------
// System prompt for narration
// ---------------------------------------------------------------------------

const NARRATOR_SYSTEM = `You are the voice of an environmental intelligence brain. Translate this geometric event into a plain-English discovery. Be specific — cite actual values, stations, dates. Explain WHY this matters — what's the cross-domain connection that nobody would have noticed? If the connection is trivial (weather caused weather), say so honestly. Only flag genuine cross-domain insights. Keep it to 2-3 paragraphs. Lead with the finding.`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchKnowledgeEntry(
  supabase: ReturnType<typeof createSupabaseClient>,
  id: string,
): Promise<KnowledgeEntry | null> {
  const { data, error } = await supabase
    .from('hunt_knowledge')
    .select('id, title, content, content_type, state_abbr, effective_date, metadata')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.warn(`[hunt-narrator] Failed to fetch knowledge ${id}:`, error.message);
    return null;
  }
  return data;
}

function buildSeam(
  source: KnowledgeEntry | null,
  matched: KnowledgeEntry | null,
): string {
  const parts: string[] = [];

  const date = source?.effective_date || matched?.effective_date || 'unknown date';
  const state = source?.state_abbr || matched?.state_abbr || 'unknown location';
  parts.push(`Date: ${date}`);
  parts.push(`Location: ${state}`);

  // Pull measurable conditions from content
  for (const entry of [source, matched]) {
    if (!entry) continue;
    // Grab first 300 chars of content as the observable condition summary
    if (entry.content) {
      parts.push(`[${entry.content_type}] ${entry.content.slice(0, 300)}`);
    }
  }

  return parts.join('\n');
}

function buildNarrationPrompt(event: GeometricEvent): string {
  const { link, source_entry, matched_entry } = event;

  const sections: string[] = [];

  sections.push(`## Geometric Event: Cross-Domain Pattern Link`);
  sections.push(`Similarity: ${(link.similarity * 100).toFixed(1)}%`);
  sections.push(`Source type: ${link.source_content_type}`);
  sections.push(`Matched type: ${link.matched_content_type}`);
  sections.push(`State: ${link.state_abbr || 'national'}`);
  sections.push(`Detected: ${link.created_at}`);

  if (source_entry) {
    sections.push(`\n## Source Entry`);
    sections.push(`Title: ${source_entry.title}`);
    sections.push(`Date: ${source_entry.effective_date || 'N/A'}`);
    sections.push(`Content:\n${source_entry.content?.slice(0, 800) || 'N/A'}`);
  }

  if (matched_entry) {
    sections.push(`\n## Matched Entry`);
    sections.push(`Title: ${matched_entry.title}`);
    sections.push(`Date: ${matched_entry.effective_date || 'N/A'}`);
    sections.push(`Content:\n${matched_entry.content?.slice(0, 800) || 'N/A'}`);
  }

  const seam = buildSeam(source_entry, matched_entry);
  sections.push(`\n## The Seam (where this touches observable reality)`);
  sections.push(seam);

  return sections.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();
  let isCron = true;

  try {
    const body = await req.json().catch(() => ({}));
    const filterState: string | undefined = body.state_abbr;
    const filterEventType: string | undefined = body.event_type;
    isCron = !filterState && !filterEventType;

    const supabase = createSupabaseClient();

    console.log('[hunt-narrator] Starting narration run', { filterState, filterEventType });

    // -----------------------------------------------------------------
    // 1. Find unnarrated geometric events (cross-domain pattern links)
    // -----------------------------------------------------------------
    const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 3600 * 1000).toISOString();

    // Get IDs of pattern links that already have narrations
    // We tag narrated links via metadata.source_ids in brain-narrative entries
    const { data: existingNarrations } = await supabase
      .from('hunt_knowledge')
      .select('metadata')
      .eq('content_type', 'brain-narrative')
      .gte('created_at', cutoff);

    const alreadyNarrated = new Set<string>();
    for (const n of existingNarrations || []) {
      const sourceIds = (n.metadata as Record<string, unknown>)?.source_ids;
      if (Array.isArray(sourceIds)) {
        for (const id of sourceIds) alreadyNarrated.add(String(id));
      }
    }

    let query = supabase
      .from('hunt_pattern_links')
      .select('id, source_id, matched_id, similarity, source_content_type, matched_content_type, state_abbr, created_at')
      .gte('created_at', cutoff)
      .gte('similarity', MIN_SIMILARITY)
      .order('similarity', { ascending: false })
      .limit(50); // Fetch more than MAX_PER_RUN to filter cross-domain

    if (filterState) {
      query = query.eq('state_abbr', filterState);
    }

    const { data: patternLinks, error: linkErr } = await query;

    if (linkErr) {
      console.error('[hunt-narrator] Pattern links query error:', linkErr);
      await logCronRun({
        functionName: 'hunt-narrator',
        status: 'error',
        errorMessage: linkErr.message,
        durationMs: Date.now() - startTime,
      });
      return isCron ? cronResponse({ error: linkErr.message }, 500) : errorResponse(req, linkErr.message, 500);
    }

    // Filter to cross-domain only and skip already-narrated
    const candidates = (patternLinks || []).filter((link: PatternLink) => {
      if (alreadyNarrated.has(link.id)) return false;
      if (!link.source_content_type || !link.matched_content_type) return false;
      return isCrossDomain(link.source_content_type, link.matched_content_type);
    });

    if (candidates.length === 0) {
      console.log('[hunt-narrator] No unnarrated cross-domain events found');
      const summary = { narrated: 0, message: 'No unnarrated cross-domain events' };
      await logCronRun({
        functionName: 'hunt-narrator',
        status: 'success',
        summary,
        durationMs: Date.now() - startTime,
      });
      return isCron ? cronResponse(summary) : successResponse(req, summary);
    }

    console.log(`[hunt-narrator] Found ${candidates.length} candidates, processing up to ${MAX_PER_RUN}`);

    // -----------------------------------------------------------------
    // 2. Process each event
    // -----------------------------------------------------------------
    let narrated = 0;
    let errors = 0;
    let totalCost = 0;

    for (const link of candidates.slice(0, MAX_PER_RUN) as PatternLink[]) {
      try {
        console.log(`[hunt-narrator] Processing link ${link.id}: ${link.source_content_type} <-> ${link.matched_content_type} (${(link.similarity * 100).toFixed(1)}%) in ${link.state_abbr || 'national'}`);

        // 2a. Fetch context entries
        const [sourceEntry, matchedEntry] = await Promise.all([
          fetchKnowledgeEntry(supabase, link.source_id),
          fetchKnowledgeEntry(supabase, link.matched_id),
        ]);

        if (!sourceEntry && !matchedEntry) {
          console.warn(`[hunt-narrator] Both entries missing for link ${link.id}, skipping`);
          continue;
        }

        const event: GeometricEvent = {
          type: 'pattern_link',
          link,
          source_entry: sourceEntry,
          matched_entry: matchedEntry,
        };

        // 2b. Build prompt and call Claude
        const userPrompt = buildNarrationPrompt(event);

        const response = await callClaude({
          model: CLAUDE_MODELS.sonnet,
          system: NARRATOR_SYSTEM,
          messages: [{ role: 'user', content: userPrompt }],
          max_tokens: 1024,
          temperature: 0.4,
        });

        const narration = parseTextContent(response);
        if (!narration) {
          console.warn(`[hunt-narrator] Empty narration for link ${link.id}`);
          errors++;
          continue;
        }

        totalCost += calculateCost(CLAUDE_MODELS.sonnet, response.usage);

        // 2c. Build the seam metadata
        const seam = {
          date: sourceEntry?.effective_date || matchedEntry?.effective_date || null,
          location: link.state_abbr || null,
          source_type: link.source_content_type,
          matched_type: link.matched_content_type,
        };

        // 2d. Build headline from first sentence of narration
        const firstSentence = narration.split(/[.!]\s/)[0];
        const headline = firstSentence.length > 120
          ? firstSentence.slice(0, 117) + '...'
          : firstSentence + '.';

        // 2e. Determine state and date
        const primaryState = link.state_abbr || sourceEntry?.state_abbr || matchedEntry?.state_abbr || null;
        const effectiveDate = sourceEntry?.effective_date || matchedEntry?.effective_date || new Date().toISOString().slice(0, 10);

        // 2f. Embed the narration (THE EMBEDDING LAW)
        const embeddingText = `${headline}\n${narration}`;
        const embedding = await generateEmbedding(embeddingText, 'document');

        // 2g. Write to hunt_knowledge
        const { error: insertErr } = await supabase
          .from('hunt_knowledge')
          .insert({
            title: headline,
            content: narration,
            content_type: 'brain-narrative',
            tags: [
              'brain-narrative',
              link.source_content_type,
              link.matched_content_type,
              primaryState,
            ].filter(Boolean),
            state_abbr: primaryState,
            effective_date: effectiveDate,
            embedding,
            metadata: {
              event_type: 'pattern_link',
              source_ids: [link.source_id],
              matched_ids: [link.matched_id],
              pattern_link_id: link.id,
              similarity_scores: [link.similarity],
              seam,
              llm_model: CLAUDE_MODELS.sonnet,
              llm_cost: calculateCost(CLAUDE_MODELS.sonnet, response.usage),
            },
          });

        if (insertErr) {
          console.error(`[hunt-narrator] Insert error for link ${link.id}:`, insertErr);
          errors++;
          continue;
        }

        narrated++;
        console.log(`[hunt-narrator] Narrated link ${link.id}: "${headline}"`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[hunt-narrator] Error processing link ${link.id}:`, msg);
        errors++;
      }
    }

    // -----------------------------------------------------------------
    // 3. Log summary
    // -----------------------------------------------------------------
    const summary = {
      narrated,
      candidates: candidates.length,
      errors,
      total_cost: Math.round(totalCost * 10000) / 10000,
      run_at: new Date().toISOString(),
    };

    console.log(`[hunt-narrator] Done. Narrated: ${narrated}, Errors: ${errors}, Cost: $${summary.total_cost}`);

    await logCronRun({
      functionName: 'hunt-narrator',
      status: errors > 0 && narrated === 0 ? 'error' : errors > 0 ? 'partial' : 'success',
      summary,
      durationMs: Date.now() - startTime,
    });

    return isCron ? cronResponse(summary) : successResponse(req, summary);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[hunt-narrator] Fatal:', msg);

    await logCronRun({
      functionName: 'hunt-narrator',
      status: 'error',
      errorMessage: msg,
      durationMs: Date.now() - startTime,
    });

    return isCron ? cronResponse({ error: msg }, 500) : errorResponse(req, msg, 500);
  }
});
