import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getWeekRange(): { weekStart: string; weekEnd: string } {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1); // yesterday
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6); // 7 days back from yesterday
  return {
    weekStart: start.toISOString().slice(0, 10),
    weekEnd: end.toISOString().slice(0, 10),
  };
}

type ActivityLevel = 'high' | 'moderate' | 'low';
type Grade = 'tracking well' | 'over-predicted' | 'under-predicted';

function computeActivityLevel(spikeCount: number, avgScore: number): ActivityLevel {
  if (spikeCount >= 2 || avgScore >= 70) return 'high';
  if (spikeCount >= 1 || avgScore >= 40) return 'moderate';
  return 'low';
}

function computeGrade(avgScore: number, activityLevel: ActivityLevel): Grade {
  const highScore = avgScore >= 60;
  const highActivity = activityLevel === 'high';

  if (highScore && highActivity) return 'tracking well';
  if (highScore && !highActivity) return 'over-predicted';
  if (!highScore && highActivity) return 'under-predicted';
  return 'tracking well'; // low score + low activity
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { weekStart, weekEnd } = getWeekRange();
    console.log(`[hunt-convergence-report-card] Grading week ${weekStart} to ${weekEnd}`);

    const supabase = createSupabaseClient();

    // -------------------------------------------------------------------
    // 1. Get all convergence scores from the past 7 days
    // -------------------------------------------------------------------
    const { data: scoreRows, error: scoreErr } = await supabase
      .from('hunt_convergence_scores')
      .select('state_abbr, date, score')
      .gte('date', weekStart)
      .lte('date', weekEnd);

    if (scoreErr) {
      console.error('[hunt-convergence-report-card] Score query error:', scoreErr);
      return errorResponse(req, 'Score query failed', 500);
    }

    if (!scoreRows || scoreRows.length === 0) {
      console.log('[hunt-convergence-report-card] No convergence scores found for the week');
      return successResponse(req, { message: 'No convergence scores found', graded: 0 });
    }

    // Group scores by state
    const scoresByState: Record<string, { date: string; score: number }[]> = {};
    for (const row of scoreRows) {
      if (!scoresByState[row.state_abbr]) scoresByState[row.state_abbr] = [];
      scoresByState[row.state_abbr].push({ date: row.date, score: row.score });
    }

    const states = Object.keys(scoresByState);
    console.log(`[hunt-convergence-report-card] Found scores for ${states.length} states`);

    // -------------------------------------------------------------------
    // 2. Get migration-related entries from hunt_knowledge
    //    content_type in: migration-daily, migration-spike-*, birdcast-daily
    // -------------------------------------------------------------------
    const { data: migrationRows, error: migErr } = await supabase
      .from('hunt_knowledge')
      .select('state_abbr, content_type')
      .in('state_abbr', states)
      .gte('effective_date', weekStart)
      .lte('effective_date', weekEnd)
      .or('content_type.eq.migration-daily,content_type.like.migration-spike%,content_type.eq.birdcast-daily');

    if (migErr) {
      console.error('[hunt-convergence-report-card] Migration query error:', migErr);
    }

    // Count spikes per state
    const spikesByState: Record<string, number> = {};
    if (migrationRows) {
      for (const row of migrationRows) {
        if (row.content_type?.startsWith('migration-spike')) {
          spikesByState[row.state_abbr] = (spikesByState[row.state_abbr] ?? 0) + 1;
        }
      }
    }

    // -------------------------------------------------------------------
    // 3. Get weather events from hunt_knowledge
    // -------------------------------------------------------------------
    const { data: weatherRows, error: wxErr } = await supabase
      .from('hunt_knowledge')
      .select('state_abbr')
      .in('state_abbr', states)
      .eq('content_type', 'weather-event')
      .gte('effective_date', weekStart)
      .lte('effective_date', weekEnd);

    if (wxErr) {
      console.error('[hunt-convergence-report-card] Weather query error:', wxErr);
    }

    const weatherByState: Record<string, number> = {};
    if (weatherRows) {
      for (const row of weatherRows) {
        weatherByState[row.state_abbr] = (weatherByState[row.state_abbr] ?? 0) + 1;
      }
    }

    // -------------------------------------------------------------------
    // 4. Get pattern links created this week
    // -------------------------------------------------------------------
    const { data: linkRows, error: linkErr } = await supabase
      .from('hunt_pattern_links')
      .select('state_abbr')
      .in('state_abbr', states)
      .gte('created_at', `${weekStart}T00:00:00Z`)
      .lte('created_at', `${weekEnd}T23:59:59Z`);

    if (linkErr) {
      console.error('[hunt-convergence-report-card] Pattern links query error:', linkErr);
    }

    const linksByState: Record<string, number> = {};
    if (linkRows) {
      for (const row of linkRows) {
        linksByState[row.state_abbr] = (linksByState[row.state_abbr] ?? 0) + 1;
      }
    }

    // -------------------------------------------------------------------
    // 5. Compute weekly summary per state
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

    for (const stateAbbr of states) {
      const scores = scoresByState[stateAbbr];
      const avgScore = Math.round(scores.reduce((s, r) => s + r.score, 0) / scores.length);
      const peak = scores.reduce((p, r) => r.score > p.score ? r : p, scores[0]);
      const peakScore = peak.score;
      const peakDay = peak.date;
      const spikeCount = spikesByState[stateAbbr] ?? 0;
      const eventCount = weatherByState[stateAbbr] ?? 0;
      const linkCount = linksByState[stateAbbr] ?? 0;
      const activityLevel = computeActivityLevel(spikeCount, avgScore);
      const grade = computeGrade(avgScore, activityLevel);

      const gradeShort = grade === 'tracking well' ? 'tracking' : grade === 'over-predicted' ? 'over' : 'under';

      const reportText = `convergence-report-card | ${stateAbbr} | week of ${weekStart} | avg_score:${avgScore} peak:${peakScore} on ${peakDay} | spikes:${spikeCount} events:${eventCount} links:${linkCount} | grade:${gradeShort} | activity:${activityLevel === 'moderate' ? 'mod' : activityLevel}`;

      embedTexts.push(reportText);
      embedMeta.push({
        title: `Convergence report card ${stateAbbr} week ${weekStart}`,
        content: reportText,
        content_type: 'convergence-report-card',
        tags: [stateAbbr, 'report-card', 'convergence', 'self-score', 'weekly'],
        state_abbr: stateAbbr,
        effective_date: weekStart,
        metadata: {
          source: 'self-score',
          week_start: weekStart,
          avg_convergence: avgScore,
          peak_convergence: peakScore,
          peak_day: peakDay,
          migration_spikes: spikeCount,
          weather_events: eventCount,
          pattern_links: linkCount,
          activity_level: activityLevel,
          grade: grade,
        },
      });
    }

    // -------------------------------------------------------------------
    // 6. Embed and insert into hunt_knowledge
    // -------------------------------------------------------------------
    console.log(`[hunt-convergence-report-card] Embedding ${embedTexts.length} report cards`);
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
              species: null,
              effective_date: meta.effective_date,
              metadata: meta.metadata,
              embedding: embeddings[j],
            });
          }
          const { error: knErr } = await supabase
            .from('hunt_knowledge')
            .insert(batchRows);
          if (knErr) {
            console.error(`[hunt-convergence-report-card] Knowledge insert error (batch ${i / KNOWLEDGE_BATCH}):`, knErr);
          } else {
            embeddingsCreated += batchRows.length;
          }
        }
      } else {
        console.error(`[hunt-convergence-report-card] Embedding count mismatch: expected ${embedTexts.length}, got ${embeddings?.length ?? 0}`);
      }
    } catch (embedErr) {
      console.error('[hunt-convergence-report-card] Embedding error:', embedErr);
    }

    // -------------------------------------------------------------------
    // 7. Log summary
    // -------------------------------------------------------------------
    const allGrades = embedMeta.map(m => m.metadata.grade as string);
    const tracking = allGrades.filter(g => g === 'tracking well').length;
    const over = allGrades.filter(g => g === 'over-predicted').length;
    const under = allGrades.filter(g => g === 'under-predicted').length;

    const summary = {
      week_start: weekStart,
      week_end: weekEnd,
      states_graded: states.length,
      tracking_well: tracking,
      over_predicted: over,
      under_predicted: under,
      embeddings_created: embeddingsCreated,
      run_at: new Date().toISOString(),
    };

    console.log(`[hunt-convergence-report-card] Graded ${states.length} states. Tracking: ${tracking}, Over: ${over}, Under: ${under}. Embedded: ${embeddingsCreated}.`);

    return successResponse(req, summary);
  } catch (error) {
    console.error('[hunt-convergence-report-card] Fatal error:', error);
    return errorResponse(req, 'Internal server error', 500);
  }
});
