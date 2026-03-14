import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { generateEmbedding } from '../_shared/embedding.ts';

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createSupabaseClient();
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0];

    // -----------------------------------------------------------------------
    // 1. Fetch today's convergence scores for all states
    // -----------------------------------------------------------------------
    const { data: convergenceRows, error: convErr } = await supabase
      .from('hunt_convergence_scores')
      .select('state_abbr, score')
      .eq('date', today)
      .order('score', { ascending: false });

    if (convErr) {
      console.error('[hunt-murmuration-index] Convergence fetch error:', convErr);
    }

    const scores = convergenceRows || [];
    const convergenceSum = scores.reduce((sum: number, r: { score: number }) => sum + r.score, 0);
    const activeStates = scores.filter((r: { score: number }) => r.score > 0).length;
    const topStates = scores.slice(0, 3).map((r: { state_abbr: string }) => r.state_abbr);

    // -----------------------------------------------------------------------
    // 2. Fetch today's BirdCast data from hunt_knowledge
    // -----------------------------------------------------------------------
    const { data: birdcastRows, error: bcErr } = await supabase
      .from('hunt_knowledge')
      .select('id')
      .eq('content_type', 'birdcast-daily')
      .eq('effective_date', today);

    if (bcErr) {
      console.error('[hunt-murmuration-index] BirdCast fetch error:', bcErr);
    }

    const birdcastActivity = birdcastRows?.length || 0;

    // -----------------------------------------------------------------------
    // 3. Fetch recent migration spikes from hunt_knowledge (last 3 days)
    // -----------------------------------------------------------------------
    const { data: spikeRows, error: spErr } = await supabase
      .from('hunt_knowledge')
      .select('id')
      .like('content_type', 'migration-spike%')
      .gte('effective_date', threeDaysAgo);

    if (spErr) {
      console.error('[hunt-murmuration-index] Spike fetch error:', spErr);
    }

    const spikeCount = spikeRows?.length || 0;

    // -----------------------------------------------------------------------
    // 4. Compute index
    // -----------------------------------------------------------------------
    const stateCount = scores.length || 1; // avoid divide-by-zero
    const rawIndex = Math.round(
      (convergenceSum / stateCount) * 10 + birdcastActivity * 5 + spikeCount * 10
    );
    const index = Math.min(1000, Math.max(0, rawIndex));

    // -----------------------------------------------------------------------
    // 5. Compare to yesterday's index for change_pct
    // -----------------------------------------------------------------------
    const { data: yesterdayRows } = await supabase
      .from('hunt_knowledge')
      .select('metadata')
      .eq('content_type', 'murmuration-index')
      .eq('effective_date', yesterday)
      .order('created_at', { ascending: false })
      .limit(1);

    let changePct = 0;
    let direction: 'up' | 'down' | 'flat' = 'flat';

    if (yesterdayRows && yesterdayRows.length > 0) {
      const prevIndex = yesterdayRows[0].metadata?.index;
      if (typeof prevIndex === 'number' && prevIndex > 0) {
        changePct = Math.round(((index - prevIndex) / prevIndex) * 1000) / 10;
        direction = changePct > 0 ? 'up' : changePct < 0 ? 'down' : 'flat';
      }
    }

    // -----------------------------------------------------------------------
    // 6. Store today's index in hunt_knowledge
    // -----------------------------------------------------------------------
    const indexContent = `murmuration-index | ${today} | index:${index}/1000 | change:${changePct}% ${direction} | top:${topStates.join(',')} | active:${activeStates} states | spikes:${spikeCount}`;

    try {
      const embedding = await generateEmbedding(indexContent, 'document');

      const { error: insertErr } = await supabase
        .from('hunt_knowledge')
        .upsert({
          title: `Murmuration Index ${today}`,
          content: indexContent,
          content_type: 'murmuration-index',
          tags: ['murmuration-index', today],
          effective_date: today,
          metadata: {
            index,
            change_pct: changePct,
            direction,
            top_states: topStates,
            spike_count: spikeCount,
            active_states: activeStates,
            convergence_sum: convergenceSum,
            birdcast_activity: birdcastActivity,
          },
          embedding,
        }, { onConflict: 'content_type,effective_date' });

      if (insertErr) {
        // If upsert on that constraint fails, just insert (constraint may not exist)
        console.error('[hunt-murmuration-index] Upsert error, trying insert:', insertErr);
        await supabase
          .from('hunt_knowledge')
          .insert({
            title: `Murmuration Index ${today}`,
            content: indexContent,
            content_type: 'murmuration-index',
            tags: ['murmuration-index', today],
            effective_date: today,
            metadata: {
              index,
              change_pct: changePct,
              direction,
              top_states: topStates,
              spike_count: spikeCount,
              active_states: activeStates,
              convergence_sum: convergenceSum,
              birdcast_activity: birdcastActivity,
            },
            embedding,
          });
      }
    } catch (embedErr) {
      console.error('[hunt-murmuration-index] Embedding/store error:', embedErr);
    }

    // -----------------------------------------------------------------------
    // 7. Return response
    // -----------------------------------------------------------------------
    const result = {
      index,
      change_pct: changePct,
      direction,
      top_states: topStates,
      spike_count: spikeCount,
      active_states: activeStates,
      computed_at: new Date().toISOString(),
    };

    console.log('[hunt-murmuration-index] Complete:', JSON.stringify(result));
    return successResponse(req, result);
  } catch (error) {
    console.error('[hunt-murmuration-index] Fatal error:', error);
    return errorResponse(req, 'Internal server error', 500);
  }
});
