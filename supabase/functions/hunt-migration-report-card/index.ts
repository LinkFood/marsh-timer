import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { logCronRun } from '../_shared/cronLog.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

type Grade = 'confirmed' | 'missed' | 'surprise' | 'quiet';

function gradeState(convergenceScore: number, migrationCount: number): Grade {
  const highConvergence = convergenceScore > 60;
  const spikeOccurred = migrationCount > 0;

  if (highConvergence && spikeOccurred) return 'confirmed';
  if (highConvergence && !spikeOccurred) return 'missed';
  if (!highConvergence && spikeOccurred) return 'surprise';
  return 'quiet';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();
  try {
    const today = getToday();
    const sevenDaysAgo = daysAgo(7);
    const threeDaysAgo = daysAgo(3);

    console.log(`[hunt-migration-report-card] Grading predictions for ${sevenDaysAgo} against outcomes ${threeDaysAgo} to ${today}`);

    const supabase = createSupabaseClient();

    // -------------------------------------------------------------------
    // 1. Get convergence scores from 7 days ago (the "predictions")
    // -------------------------------------------------------------------
    const { data: convergenceRows, error: convErr } = await supabase
      .from('hunt_convergence_scores')
      .select('state_abbr, score')
      .eq('date', sevenDaysAgo);

    if (convErr) {
      console.error('[hunt-migration-report-card] Convergence query error:', convErr);
      return errorResponse(req, 'Convergence query failed', 500);
    }

    if (!convergenceRows || convergenceRows.length === 0) {
      console.log(`[hunt-migration-report-card] No convergence scores found for ${sevenDaysAgo}`);
      const summary = { message: `No convergence scores for ${sevenDaysAgo}`, graded: 0 };
      await logCronRun({ functionName: 'hunt-migration-report-card', status: 'success', summary, durationMs: Date.now() - startTime });
      return successResponse(req, summary);
    }

    console.log(`[hunt-migration-report-card] Found ${convergenceRows.length} convergence scores from ${sevenDaysAgo}`);

    // Build lookup: state_abbr -> convergence score
    const convergenceByState: Record<string, number> = {};
    for (const row of convergenceRows) {
      convergenceByState[row.state_abbr] = row.score;
    }

    const states = Object.keys(convergenceByState);

    // -------------------------------------------------------------------
    // 2. Get recent migration activity from hunt_knowledge
    // -------------------------------------------------------------------
    const { data: migrationRows, error: migErr } = await supabase
      .from('hunt_knowledge')
      .select('state_abbr')
      .like('content_type', 'migration-%')
      .in('state_abbr', states)
      .gte('effective_date', threeDaysAgo)
      .lte('effective_date', today);

    if (migErr) {
      console.error('[hunt-migration-report-card] Migration query error:', migErr);
      return errorResponse(req, 'Migration query failed', 500);
    }

    // Count migration entries per state
    const migrationCountByState: Record<string, number> = {};
    if (migrationRows) {
      for (const row of migrationRows) {
        if (row.state_abbr) {
          migrationCountByState[row.state_abbr] = (migrationCountByState[row.state_abbr] || 0) + 1;
        }
      }
    }

    // -------------------------------------------------------------------
    // 3. Get weather event entries in the same window
    // -------------------------------------------------------------------
    const { data: weatherRows, error: wxErr } = await supabase
      .from('hunt_knowledge')
      .select('state_abbr')
      .eq('content_type', 'weather-event')
      .in('state_abbr', states)
      .gte('effective_date', threeDaysAgo)
      .lte('effective_date', today);

    if (wxErr) {
      console.error('[hunt-migration-report-card] Weather event query error:', wxErr);
      // Non-fatal — continue without weather event counts
    }

    const weatherCountByState: Record<string, number> = {};
    if (weatherRows) {
      for (const row of weatherRows) {
        if (row.state_abbr) {
          weatherCountByState[row.state_abbr] = (weatherCountByState[row.state_abbr] || 0) + 1;
        }
      }
    }

    // -------------------------------------------------------------------
    // 4. Grade each state and build report cards
    // -------------------------------------------------------------------
    const embedTexts: string[] = [];
    const embedMeta: {
      title: string;
      content: string;
      content_type: string;
      tags: string[];
      state_abbr: string;
      effective_date: string;
      metadata: Record<string, unknown>;
    }[] = [];

    const gradeCounts: Record<Grade, number> = { confirmed: 0, missed: 0, surprise: 0, quiet: 0 };

    for (const stateAbbr of states) {
      const convergenceScore = convergenceByState[stateAbbr];
      const migrationCount = migrationCountByState[stateAbbr] || 0;
      const weatherEventCount = weatherCountByState[stateAbbr] || 0;
      const grade = gradeState(convergenceScore, migrationCount);
      const outcome = migrationCount > 0 ? 'spike' : 'quiet';

      gradeCounts[grade]++;

      const reportText = `migration-report-card | ${stateAbbr} | ${today} | predicted:${convergenceScore} | outcome:${outcome} | grade:${grade} | convergence_7d_ago:${convergenceScore} migration_activity:${migrationCount} weather_events:${weatherEventCount}`;

      embedTexts.push(reportText);
      embedMeta.push({
        title: `Migration report card ${stateAbbr} ${today}`,
        content: reportText,
        content_type: 'migration-report-card',
        tags: [stateAbbr, 'report-card', 'migration', 'self-score', grade],
        state_abbr: stateAbbr,
        effective_date: today,
        metadata: {
          source: 'self-score',
          date: today,
          convergence_score_7d: convergenceScore,
          migration_activity: migrationCount,
          weather_events: weatherEventCount,
          grade: grade,
          prediction_date: sevenDaysAgo,
        },
      });
    }

    if (embedTexts.length === 0) {
      console.log('[hunt-migration-report-card] No states to grade');
      const summary = { message: 'No states to grade', graded: 0 };
      await logCronRun({ functionName: 'hunt-migration-report-card', status: 'success', summary, durationMs: Date.now() - startTime });
      return successResponse(req, summary);
    }

    // -------------------------------------------------------------------
    // 5. Embed and insert into hunt_knowledge
    // -------------------------------------------------------------------
    console.log(`[hunt-migration-report-card] Embedding ${embedTexts.length} report cards`);
    let embeddingsCreated = 0;

    try {
      const embeddings = await batchEmbed(embedTexts, 'document');

      if (embeddings && embeddings.length === embedTexts.length) {
        const KNOWLEDGE_BATCH = 50;
        for (let i = 0; i < embeddings.length; i += KNOWLEDGE_BATCH) {
          const batchRows = [];
          for (let j = i; j < Math.min(i + KNOWLEDGE_BATCH, embeddings.length); j++) {
            const meta = embedMeta[j];
            batchRows.push({
              title: meta.title,
              content: meta.content,
              content_type: meta.content_type,
              tags: meta.tags,
              state_abbr: meta.state_abbr,
              species: 'duck',
              effective_date: meta.effective_date,
              metadata: meta.metadata,
              embedding: embeddings[j],
            });
          }
          const { error: knErr } = await supabase
            .from('hunt_knowledge')
            .insert(batchRows);
          if (knErr) {
            console.error(`[hunt-migration-report-card] Knowledge insert error (batch ${i / KNOWLEDGE_BATCH}):`, knErr);
          } else {
            embeddingsCreated += batchRows.length;
          }
        }
      } else {
        console.error(`[hunt-migration-report-card] Embedding count mismatch: expected ${embedTexts.length}, got ${embeddings?.length ?? 0}`);
      }
    } catch (embedErr) {
      console.error('[hunt-migration-report-card] Embedding error:', embedErr);
    }

    // -------------------------------------------------------------------
    // 6. Summary
    // -------------------------------------------------------------------
    const summary = {
      date: today,
      prediction_date: sevenDaysAgo,
      outcome_window: `${threeDaysAgo} to ${today}`,
      states_graded: embedTexts.length,
      grades: gradeCounts,
      embeddings_created: embeddingsCreated,
      run_at: new Date().toISOString(),
    };

    console.log(`[hunt-migration-report-card] Graded ${embedTexts.length} states. Confirmed:${gradeCounts.confirmed} Missed:${gradeCounts.missed} Surprise:${gradeCounts.surprise} Quiet:${gradeCounts.quiet}`);

    await logCronRun({
      functionName: 'hunt-migration-report-card',
      status: 'success',
      summary,
      durationMs: Date.now() - startTime,
    });

    return successResponse(req, summary);
  } catch (error) {
    console.error('[hunt-migration-report-card] Fatal error:', error);
    await logCronRun({
      functionName: 'hunt-migration-report-card',
      status: 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
    });
    return errorResponse(req, 'Internal server error', 500);
  }
});
