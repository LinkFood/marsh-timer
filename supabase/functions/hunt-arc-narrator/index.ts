import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse, cronResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { generateEmbedding } from '../_shared/embedding.ts';
import { callClaude, parseTextContent, CLAUDE_MODELS } from '../_shared/anthropic.ts';
import { logCronRun } from '../_shared/cronLog.ts';
import { getOpenArc } from '../_shared/arcReactor.ts';

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  let isSweep = true;
  try {
    const body = await req.json().catch(() => ({}));
    const state_abbr: string | undefined = body.state_abbr;
    isSweep = !state_abbr;
    const trigger: string | undefined = body.trigger;
    const arc_id: string | undefined = body.arc_id;
    const use_opus: boolean = body.use_opus === true;

    const startTime = Date.now();
    const supabase = createSupabaseClient();

    // Determine which arcs to process
    let arcsToProcess: any[] = [];
    if (state_abbr) {
      // Event-triggered: process specific state's open arc
      const arc = await getOpenArc(supabase, state_abbr);
      if (arc) arcsToProcess = [arc];
    } else {
      // Daily sweep: all active arcs
      const { data } = await supabase
        .from('hunt_state_arcs')
        .select('*')
        .neq('current_act', 'closed')
        .order('opened_at', { ascending: false });
      arcsToProcess = data || [];
    }

    let processed = 0;
    const HARD_TIMEOUT_MS = 120_000; // Stop at 120s to leave room for logging
    const MAX_PER_SWEEP = 10; // Process max 10 arcs per invocation

    for (const arc of arcsToProcess.slice(0, isSweep ? MAX_PER_SWEEP : arcsToProcess.length)) {
      if (Date.now() - startTime > HARD_TIMEOUT_MS) {
        console.log(`[hunt-arc-narrator] Hit ${HARD_TIMEOUT_MS}ms timeout after ${processed} arcs`);
        break;
      }
      try {
        // 1. Gather context
        const today = new Date().toISOString().slice(0, 10);

        // Convergence score + 3-day trend
        const { data: scores } = await supabase
          .from('hunt_convergence_scores')
          .select('*')
          .eq('state_abbr', arc.state_abbr)
          .order('date', { ascending: false })
          .limit(3);

        // Pattern links (72h)
        const cutoff72h = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
        const { data: links } = await supabase
          .from('hunt_pattern_links')
          .select('similarity, source_content_type, matched_content_type')
          .eq('state_abbr', arc.state_abbr)
          .gte('created_at', cutoff72h)
          .order('created_at', { ascending: false })
          .limit(10);

        // Calibration accuracy
        const { data: calibration } = await supabase
          .from('hunt_alert_calibration')
          .select('accuracy_rate, total_alerts')
          .eq('state_abbr', arc.state_abbr)
          .limit(5);

        // Fingerprint search (Act 2+)
        let similarArcs: string[] = [];
        if (['recognition', 'outcome', 'grade'].includes(arc.current_act)) {
          const arcDesc = `${arc.state_abbr} ${(arc.buildup_signals?.domains || []).join(' ')} convergence ${arc.buildup_signals?.trigger || ''}`;
          try {
            const embedding = await generateEmbedding(arcDesc, 'query');
            const { data: matches } = await supabase.rpc('search_hunt_knowledge_v3', {
              query_embedding: embedding,
              match_threshold: 0.6,
              match_count: 3,
              filter_content_types: ['arc-fingerprint'],
              filter_state_abbr: null,
              filter_species: null,
              filter_date_from: null,
              filter_date_to: null,
              recency_weight: 0.1,
              exclude_du_report: true,
            });
            similarArcs = (matches || []).map((m: any) => `${m.state_abbr} (${m.effective_date}): ${m.content?.slice(0, 150)}`);
          } catch { /* best-effort */ }
        }

        // 2. Build prompt
        const scoreInfo = scores?.[0]
          ? `Score: ${scores[0].score}/100 (weather:${scores[0].weather_component}, migration:${scores[0].migration_component}, birdcast:${scores[0].birdcast_component}, solunar:${scores[0].solunar_component}, pattern:${scores[0].pattern_component}, water:${scores[0].water_component}, photoperiod:${scores[0].photoperiod_component}, tide:${scores[0].tide_component})`
          : 'No score data';
        const trendInfo = scores && scores.length >= 2
          ? `Trend: ${scores.map((s: any) => s.score).reverse().join(' → ')}`
          : '';
        const linksInfo = links?.length
          ? `Pattern links: ${links.map((l: any) => `${l.source_content_type}→${l.matched_content_type} (${Math.round(l.similarity * 100)}%)`).join(', ')}`
          : 'No recent pattern links';
        const calInfo = calibration?.length
          ? `Historical accuracy: ${calibration.map((c: any) => `${c.accuracy_rate}% over ${c.total_alerts} alerts`).join(', ')}`
          : 'No calibration data yet';
        const fingerInfo = similarArcs.length
          ? `Similar historical arcs:\n${similarArcs.join('\n')}`
          : 'No similar historical arcs found';

        const systemPrompt = `You are the Duck Countdown Brain — an environmental pattern recognition engine. You are writing the live narrative for an active intelligence arc in ${arc.state_abbr}.

Write 3-5 sentences. Be specific — cite actual numbers, domains, signals. Never say "will happen" — say "the last N times this pattern appeared, X happened." Show your reasoning. If this is a buildup, say what you're watching for. If recognition, state the claim and the historical basis. If outcome, describe what signals have arrived vs what was expected. Be honest about uncertainty.`;

        const userPrompt = `Current arc state:
- Act: ${arc.current_act}
- Opened: ${arc.opened_at}
- Buildup signals: ${JSON.stringify(arc.buildup_signals)}
- Recognition claim: ${JSON.stringify(arc.recognition_claim)}
- Outcome deadline: ${arc.outcome_deadline || 'N/A'}
- Outcome signals received: ${JSON.stringify(arc.outcome_signals)}
- ${scoreInfo}
- ${trendInfo}
- ${linksInfo}
- ${calInfo}
- ${fingerInfo}
${arc.narrative ? `\nPrevious narrative (maintain continuity):\n${arc.narrative}` : ''}`;

        // 3. Call Sonnet for narrative
        const narrativeResponse = await callClaude({
          model: CLAUDE_MODELS.sonnet,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
          max_tokens: 500,
        });
        const narrative = parseTextContent(narrativeResponse);

        // 4. Call Opus for grade reasoning (Act 4 only)
        let gradeReasoning: string | null = null;
        if (use_opus || trigger === 'grade_assigned') {
          const opusSystem = `You are the Duck Countdown Brain performing a post-mortem on a completed intelligence arc. Analyze: 1) Which convergence component was the strongest signal? Which was noise? 2) If missed: what signal was misleading? What was missing? 3) If confirmed: what was the earliest reliable signal? Could recognition have happened sooner? 4) How should the brain adjust weighting for similar future patterns? Be specific. Reference actual data.`;
          const opusUser = `Arc: ${arc.state_abbr}\nBuildup: ${JSON.stringify(arc.buildup_signals)}\nClaim: ${JSON.stringify(arc.recognition_claim)}\nOutcome signals: ${JSON.stringify(arc.outcome_signals)}\nGrade: ${arc.grade}\n${scoreInfo}`;

          try {
            const opusResponse = await callClaude({
              model: CLAUDE_MODELS.opus,
              system: opusSystem,
              messages: [{ role: 'user', content: opusUser }],
              max_tokens: 800,
            });
            gradeReasoning = parseTextContent(opusResponse);
          } catch (err) {
            console.error(`[hunt-arc-narrator] Opus call failed for ${arc.state_abbr}:`, err);
          }
        }

        // 5. Update arc row
        const updateData: Record<string, unknown> = { narrative };
        if (gradeReasoning) updateData.grade_reasoning = gradeReasoning;
        await supabase.from('hunt_state_arcs').update(updateData).eq('id', arc.id);

        // 6. Write to hunt_state_briefs (so StateIntelView gets it)
        await supabase.from('hunt_state_briefs').upsert({
          state_abbr: arc.state_abbr,
          date: today,
          content: narrative,
          score: scores?.[0]?.score || null,
          component_breakdown: scores?.[0] ? {
            weather: scores[0].weather_component,
            migration: scores[0].migration_component,
            birdcast: scores[0].birdcast_component,
            solunar: scores[0].solunar_component,
            pattern: scores[0].pattern_component,
            water: scores[0].water_component,
            photoperiod: scores[0].photoperiod_component,
            tide: scores[0].tide_component,
          } : null,
          signals: arc.buildup_signals,
          pattern_links: links,
        }, { onConflict: 'state_abbr,date' });

        // 7. Arc closing + fingerprinting (if grade complete)
        if (arc.current_act === 'grade' && arc.grade && gradeReasoning) {
          const fingerprintText = `Arc: ${arc.state_abbr} | ${arc.buildup_signals?.trigger || ''} | Claim: ${JSON.stringify(arc.recognition_claim)} | Grade: ${arc.grade} | Reasoning: ${gradeReasoning}`;
          const fpEmbedding = await generateEmbedding(fingerprintText, 'document');

          // Close arc with fingerprint
          await supabase.from('hunt_state_arcs').update({
            current_act: 'closed',
            closed_at: new Date().toISOString(),
            fingerprint_embedding: JSON.stringify(fpEmbedding),
          }).eq('id', arc.id);

          // Embed fingerprint into hunt_knowledge (EMBEDDING LAW)
          await supabase.from('hunt_knowledge').insert({
            title: `Arc Fingerprint: ${arc.state_abbr} ${arc.grade} (${today})`,
            content: fingerprintText,
            content_type: 'arc-fingerprint',
            tags: [arc.state_abbr, arc.grade, 'arc-fingerprint'],
            state_abbr: arc.state_abbr,
            effective_date: today,
            embedding: fpEmbedding,
            signal_weight: arc.grade === 'confirmed' ? 1.5 : 0.8,
            metadata: {
              arc_id: arc.arc_id,
              pattern_type: arc.recognition_claim?.pattern_type,
              domains: arc.buildup_signals?.domains,
              grade: arc.grade,
            },
          });

          // Embed grade reasoning (EMBEDDING LAW)
          if (gradeReasoning) {
            const reasoningEmbedding = await generateEmbedding(gradeReasoning, 'document');
            await supabase.from('hunt_knowledge').insert({
              title: `Arc Grade Reasoning: ${arc.state_abbr} ${arc.grade} (${today})`,
              content: gradeReasoning,
              content_type: 'arc-grade-reasoning',
              tags: [arc.state_abbr, arc.grade, 'arc-reasoning'],
              state_abbr: arc.state_abbr,
              effective_date: today,
              embedding: reasoningEmbedding,
              signal_weight: 1.3,
              metadata: { arc_id: arc.arc_id, grade: arc.grade },
            });
          }
        }

        processed++;
      } catch (err) {
        console.error(`[hunt-arc-narrator] Error processing ${arc.state_abbr}:`, err);
      }
    }

    const summary = { processed, total: arcsToProcess.length, trigger: trigger || 'manual' };

    // Log cron run if daily sweep
    if (!state_abbr) {
      await logCronRun({
        functionName: 'hunt-arc-narrator',
        status: arcsToProcess.length === 0 ? 'success' : (processed > 0 ? 'success' : 'partial'),
        summary,
        durationMs: Date.now() - startTime,
      });
    }

    return state_abbr ? successResponse(req, summary) : cronResponse(summary);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[hunt-arc-narrator] Fatal:', msg);

    if (isSweep) {
      await logCronRun({
        functionName: 'hunt-arc-narrator',
        status: 'error',
        errorMessage: msg,
      });
      return cronResponse({ error: msg }, 500);
    }

    return errorResponse(req, msg, 500);
  }
});
