import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { scanBrainOnWrite } from '../_shared/brainScan.ts';
import { logCronRun } from '../_shared/cronLog.ts';

// Absence Detector: weekly cron that compares recent bird activity against
// baselines to detect unusual silence. Silence is a signal — animals leave
// before conditions deteriorate.

const FUNCTION_NAME = 'hunt-absence-detector';
const BIRD_TYPES = ['birdweather-daily', 'birdcast-daily', 'migration-spike-significant', 'migration-spike-extreme'];

const STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
];

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
    const today = now.toISOString().split('T')[0];

    let absencesDetected = 0;
    let statesChecked = 0;
    const absenceEntries: Array<{ text: string; meta: Record<string, any> }> = [];

    for (const state of STATES) {
      statesChecked++;

      // Recent activity (last 7 days)
      const { count: recentCount } = await supabase
        .from('hunt_knowledge')
        .select('*', { count: 'estimated', head: true })
        .in('content_type', BIRD_TYPES)
        .eq('state_abbr', state)
        .gte('created_at', oneWeekAgo.toISOString());

      // Baseline activity (8-28 days ago)
      const { count: baselineCount } = await supabase
        .from('hunt_knowledge')
        .select('*', { count: 'estimated', head: true })
        .in('content_type', BIRD_TYPES)
        .eq('state_abbr', state)
        .gte('created_at', fourWeeksAgo.toISOString())
        .lt('created_at', oneWeekAgo.toISOString());

      // Need baseline data to compare
      if (!baselineCount || baselineCount < 3) continue;

      // Normalize to weekly rate
      const baselineWeekly = baselineCount / 3; // 3 weeks of baseline
      const recentWeekly = recentCount || 0;

      // Check for significant drop (>50% below baseline)
      if (baselineWeekly > 0 && recentWeekly < baselineWeekly * 0.5) {
        const dropPct = Math.round(((baselineWeekly - recentWeekly) / baselineWeekly) * 100);

        const text = [
          `bio-absence-signal | ${state} | ${today}`,
          `Bird activity ${dropPct}% below baseline.`,
          `Recent: ${recentWeekly.toFixed(0)} entries/week.`,
          `Baseline: ${baselineWeekly.toFixed(0)} entries/week.`,
          `Types checked: ${BIRD_TYPES.join(', ')}`,
        ].join(' | ');

        absenceEntries.push({
          text,
          meta: {
            title: `Bird Absence: ${state} — ${dropPct}% below baseline (${today})`,
            content: text,
            content_type: 'bio-absence-signal',
            state_abbr: state,
            species: null,
            effective_date: today,
            tags: [state, 'absence', 'bio-signal', 'anomaly'],
            metadata: {
              source: 'absence-detector',
              drop_pct: dropPct,
              recent_count: recentWeekly,
              baseline_count: baselineWeekly,
              bird_types: BIRD_TYPES,
              detection_date: today,
            },
          },
        });

        absencesDetected++;
        console.log(`[${FUNCTION_NAME}] Absence: ${state} — ${dropPct}% below baseline (recent: ${recentWeekly.toFixed(0)}, baseline: ${baselineWeekly.toFixed(0)})`);
      }
    }

    // Embed and upsert absences
    let totalEmbedded = 0;
    for (let i = 0; i < absenceEntries.length; i += 20) {
      const chunk = absenceEntries.slice(i, i + 20);
      const texts = chunk.map(e => e.text);
      const embeddings = await batchEmbed(texts);
      const rows = chunk.map((e, j) => ({
        ...e.meta,
        embedding: JSON.stringify(embeddings[j]),
      }));

      const { error: upsertError } = await supabase
        .from('hunt_knowledge')
        .insert(rows);

      if (upsertError) {
        console.error(`[${FUNCTION_NAME}] Upsert error: ${upsertError.message}`);
      } else {
        totalEmbedded += rows.length;

        // Brain scan each absence for environmental context
        for (let j = 0; j < embeddings.length; j++) {
          try {
            const scan = await scanBrainOnWrite(embeddings[j], {
              state_abbr: chunk[j].meta.state_abbr,
              exclude_content_type: 'bio-absence-signal',
            });
            if (scan.matches.length > 0) {
              console.log(`[${FUNCTION_NAME}] ${chunk[j].meta.state_abbr} absence — ${scan.matches.length} environmental matches found`);
            }
          } catch { /* best-effort */ }
        }

        // Track outcomes for grading
        for (const entry of chunk) {
          const outcomeDeadline = new Date();
          outcomeDeadline.setUTCHours(outcomeDeadline.getUTCHours() + 72);

          await supabase.from('hunt_alert_outcomes').insert({
            alert_source: 'bio-absence-signal',
            state_abbr: entry.meta.state_abbr,
            alert_date: today,
            predicted_outcome: {
              claim: entry.meta.title,
              expected_signals: ['weather-event', 'nws-alert', 'fire-activity', 'usgs-water'],
              severity: entry.meta.metadata.drop_pct > 75 ? 'high' : 'medium',
              drop_pct: entry.meta.metadata.drop_pct,
            },
            outcome_window_hours: 72,
            outcome_deadline: outcomeDeadline.toISOString(),
          }).catch(err => console.error(`[${FUNCTION_NAME}] Outcome insert failed:`, err));
        }
      }
    }

    const durationMs = Date.now() - startTime;
    console.log(`[${FUNCTION_NAME}] Done: ${absencesDetected} absences detected, ${totalEmbedded} embedded`);

    await logCronRun({
      functionName: FUNCTION_NAME,
      status: 'success',
      summary: { states_checked: statesChecked, absences_detected: absencesDetected, embedded: totalEmbedded },
      durationMs,
    });

    return successResponse(req, { states_checked: statesChecked, absences_detected: absencesDetected, embedded: totalEmbedded, durationMs });

  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error(`[${FUNCTION_NAME}] Fatal:`, err);
    await logCronRun({
      functionName: FUNCTION_NAME,
      status: 'error',
      errorMessage: String(err),
      durationMs,
    });
    return errorResponse(req, String(err), 500);
  }
});
