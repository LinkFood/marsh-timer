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
const LOOKBACK_HOURS = 240; // Widened for initial test — pattern links stalled until brainScan threshold fix
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

const NARRATOR_SYSTEM = `You are the narrator for an autonomous environmental intelligence brain. The brain operates in 512-dimensional embedding space, discovering cross-domain patterns between weather, migration, soil, water, air quality, space weather, and 20+ other data streams.

Rules:
1. If the brain's own internal signals (arc status, convergence trends, grading history) indicate skepticism, YOU are skeptical. Say "the brain flagged this as unconfirmed" or "internal signals are mixed."
2. Never claim causation. The brain finds geometric proximity (correlation in embedding space). Say "these patterns are geometrically close" or "the brain sees a connection" — not "X caused Y."
3. Always state the confidence level you are given: CONFIRMED, UNCERTAIN, or SKEPTICAL.
4. Always name the seam — where and when does this touch observable reality?
5. Include what a human could verify. Give station names, readings, dates.
6. If the data seems anomalous (impossible pressure values, etc.), flag it. Honesty over headlines.
7. Keep it short. 2-3 sentences for the finding. A paragraph for explanation. Bullet list of data points.
8. DO NOT use markdown headers, emoji, or formatting. Plain text only. No ## headers, no bold **, no bullet points with -. Write like you're talking to someone. The rendering layer handles formatting.
9. Start with a one-sentence finding that describes what the brain detected. Then a paragraph explaining why it matters (or doesn't). Do NOT include the confidence level in your text — that's handled by metadata.`;

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

type Confidence = 'CONFIRMED' | 'UNCERTAIN' | 'SKEPTICAL';

interface BrainSignals {
  confidence: Confidence;
  arc_status: string | null;
  convergence_trend: string | null;
  convergence_score: number | null;
  grading_summary: string | null;
  raw: string;
}

async function checkBrainSignals(
  supabase: ReturnType<typeof createSupabaseClient>,
  stateAbbr: string | null,
  effectiveDate: string | null,
): Promise<BrainSignals> {
  const signals: string[] = [];
  let confidence: Confidence = 'UNCERTAIN';
  let arcStatus: string | null = null;
  let convergenceTrend: string | null = null;
  let convergenceScore: number | null = null;
  let gradingSummary: string | null = null;

  if (!stateAbbr) {
    return { confidence: 'UNCERTAIN', arc_status: null, convergence_trend: null, convergence_score: null, grading_summary: null, raw: 'No state context — cannot check brain signals.' };
  }

  // Check state arc
  const { data: arc } = await supabase
    .from('hunt_state_arcs')
    .select('current_act, grade, grade_reasoning, narrative')
    .eq('state_abbr', stateAbbr)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (arc) {
    arcStatus = arc.current_act;
    if (arc.grade) {
      signals.push(`Arc grade: ${arc.grade}`);
      if (arc.grade === 'confirmed') confidence = 'CONFIRMED';
      else if (arc.grade === 'false_alarm' || arc.grade === 'missed') confidence = 'SKEPTICAL';
    } else {
      signals.push(`Arc status: ${arc.current_act} (not yet graded)`);
    }
    if (arc.narrative && arc.narrative.includes('unconfirmed')) {
      signals.push('Arc narrative flags patterns as unconfirmed');
      confidence = 'SKEPTICAL';
    }
    if (arc.grade_reasoning) {
      signals.push(`Grade reasoning: ${arc.grade_reasoning.slice(0, 200)}`);
    }
  } else {
    signals.push('No active arc for this state');
  }

  // Check convergence trend (last 3 days)
  const { data: convScores } = await supabase
    .from('hunt_convergence_scores')
    .select('score, date')
    .eq('state_abbr', stateAbbr)
    .order('date', { ascending: false })
    .limit(3);

  if (convScores && convScores.length >= 2) {
    convergenceScore = convScores[0].score;
    const trend = convScores[0].score - convScores[convScores.length - 1].score;
    convergenceTrend = trend > 5 ? 'rising' : trend < -5 ? 'declining' : 'stable';
    signals.push(`Convergence: ${convScores[0].score}/100, trend ${convergenceTrend} (${convScores.map(s => s.score).join(' → ')})`);

    if (convergenceTrend === 'declining' && confidence !== 'SKEPTICAL') {
      signals.push('WARNING: Convergence declining while pattern link is strong — contradictory signals');
      if (confidence === 'CONFIRMED') confidence = 'UNCERTAIN';
    }
  }

  // Check recent grading for this state
  const { data: grades } = await supabase
    .from('hunt_alert_outcomes')
    .select('outcome_grade')
    .eq('state_abbr', stateAbbr)
    .eq('outcome_checked', true)
    .order('graded_at', { ascending: false })
    .limit(10);

  if (grades && grades.length > 0) {
    const counts: Record<string, number> = {};
    for (const g of grades) {
      counts[g.outcome_grade] = (counts[g.outcome_grade] || 0) + 1;
    }
    gradingSummary = Object.entries(counts).map(([g, c]) => `${g}: ${c}`).join(', ');
    signals.push(`Recent grading (last ${grades.length}): ${gradingSummary}`);

    const hitRate = ((counts['confirmed'] || 0) + (counts['partially_confirmed'] || 0)) / grades.length;
    if (hitRate < 0.4) {
      signals.push(`WARNING: Low historical accuracy (${(hitRate * 100).toFixed(0)}%) for ${stateAbbr}`);
      confidence = 'SKEPTICAL';
    }
  }

  return {
    confidence,
    arc_status: arcStatus,
    convergence_trend: convergenceTrend,
    convergence_score: convergenceScore,
    grading_summary: gradingSummary,
    raw: signals.join('\n'),
  };
}

function buildNarrationPrompt(event: GeometricEvent, brainSignals: BrainSignals): string {
  const { link, source_entry, matched_entry } = event;

  const sections: string[] = [];

  sections.push(`## Geometric Event: Cross-Domain Pattern Link`);
  // Raw cosine similarity (before signal_weight multiplication) — cap at 1.0 for display
  const displaySimilarity = Math.min(link.similarity, 1.0);
  sections.push(`Similarity: ${(displaySimilarity * 100).toFixed(1)}% (raw cosine, capped at 100%)`);
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

  sections.push(`\n## Brain's Internal Signals`);
  sections.push(`Confidence: ${brainSignals.confidence}`);
  sections.push(brainSignals.raw);

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

    // Filter to cross-domain only, skip already-narrated, dedup by state+domain pair
    const seenStatedomains = new Set<string>();
    const candidates = (patternLinks || []).filter((link: PatternLink) => {
      if (alreadyNarrated.has(link.id)) return false;
      if (!link.source_content_type || !link.matched_content_type) return false;
      if (!isCrossDomain(link.source_content_type, link.matched_content_type)) return false;
      // Dedup: only one narrative per state + domain pair combo
      const key = `${link.state_abbr || 'national'}:${[link.source_content_type, link.matched_content_type].sort().join('+')}`;
      if (seenStatedomains.has(key)) return false;
      seenStatedomains.add(key);
      return true;
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

        // 2b. Check brain's own signals (arcs, convergence, grades)
        const primaryState = link.state_abbr || sourceEntry?.state_abbr || matchedEntry?.state_abbr || null;
        const effectiveDate = sourceEntry?.effective_date || matchedEntry?.effective_date || null;
        const brainSignals = await checkBrainSignals(supabase, primaryState, effectiveDate);

        console.log(`[hunt-narrator] Brain signals for ${primaryState}: ${brainSignals.confidence} — ${brainSignals.raw.slice(0, 200)}`);

        // 2c. Build prompt and call Claude
        const userPrompt = buildNarrationPrompt(event, brainSignals);

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
        // Strip any leading confidence labels (UNCERTAIN/SKEPTICAL/CONFIRMED —)
        const cleaned = narration.replace(/^(UNCERTAIN|SKEPTICAL|CONFIRMED)\s*[—–-]\s*/i, '');
        const firstSentence = cleaned.split(/[.!]\s/)[0];
        const headline = firstSentence.length > 120
          ? firstSentence.slice(0, 117) + '...'
          : firstSentence + '.';

        // 2e. Determine date (state already resolved above)
        const narrativeDate = sourceEntry?.effective_date || matchedEntry?.effective_date || new Date().toISOString().slice(0, 10);

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
            effective_date: narrativeDate,
            embedding,
            metadata: {
              event_type: 'pattern_link',
              confidence_level: brainSignals.confidence,
              source_ids: [link.source_id],
              matched_ids: [link.matched_id],
              pattern_link_id: link.id,
              similarity_scores: [link.similarity],
              domains_involved: [link.source_content_type, link.matched_content_type],
              seam,
              brain_signals: {
                arc_status: brainSignals.arc_status,
                convergence_trend: brainSignals.convergence_trend,
                convergence_score: brainSignals.convergence_score,
                grading_summary: brainSignals.grading_summary,
              },
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
