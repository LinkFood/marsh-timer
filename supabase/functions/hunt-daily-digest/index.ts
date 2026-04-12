import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { cronResponse, cronErrorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { generateEmbedding } from '../_shared/embedding.ts';
import { logCronRun } from '../_shared/cronLog.ts';
import { classifyContentType } from '../_shared/contentTypes.ts';

// ---------------------------------------------------------------------------
// The Daily Digest — the filament test.
//
// Every morning, compiles what the brain found, how it graded itself,
// what's moving across states, and whether any of it matters.
// One human reads this. If the filament glows, we'll know.
// ---------------------------------------------------------------------------

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();
  const fnName = 'hunt-daily-digest';

  try {
    const supabase = createSupabaseClient();
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const yesterday = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();

    console.log(`[${fnName}] Building daily digest for ${today}`);

    // -----------------------------------------------------------------
    // 1. Narrator outputs from last 24h (external-signal-only narratives)
    // -----------------------------------------------------------------
    const { data: narratives } = await supabase
      .from('hunt_knowledge')
      .select('title, content, state_abbr, metadata, created_at')
      .eq('content_type', 'brain-narrative')
      .gte('created_at', yesterday)
      .order('created_at', { ascending: false })
      .limit(20);

    const narrativeSection: string[] = [];
    if (narratives && narratives.length > 0) {
      for (const n of narratives) {
        const meta = n.metadata as Record<string, unknown> | null;
        const confidence = meta?.confidence_level || 'UNKNOWN';
        const eventType = meta?.event_type || 'unknown';
        const domains = (meta?.domains_involved as string[]) || [];
        narrativeSection.push(
          `[${confidence}] ${n.title}\n` +
          `  Type: ${eventType} | Domains: ${domains.join(', ') || 'n/a'}\n` +
          `  ${(n.content || '').slice(0, 300)}`
        );
      }
    }

    // -----------------------------------------------------------------
    // 2. Top pattern links that the narrator DIDN'T narrate
    //    (below threshold but still interesting — external types only)
    // -----------------------------------------------------------------
    const { data: recentLinks } = await supabase
      .from('hunt_pattern_links')
      .select('source_content_type, matched_content_type, similarity, state_abbr, created_at')
      .gte('created_at', yesterday)
      .gte('similarity', 0.5)
      .order('similarity', { ascending: false })
      .limit(50);

    const interestingLinks: string[] = [];
    if (recentLinks) {
      for (const link of recentLinks) {
        const srcCat = classifyContentType(link.source_content_type);
        const matchCat = classifyContentType(link.matched_content_type);
        // Only show links where at least one side is EXTERNAL
        if (srcCat === 'INTERNAL' && matchCat === 'INTERNAL') continue;
        if (link.source_content_type === link.matched_content_type) continue;
        interestingLinks.push(
          `${link.state_abbr || 'national'}: ${link.source_content_type} <-> ${link.matched_content_type} ` +
          `(similarity: ${(link.similarity * 100).toFixed(1)}%) [${srcCat}+${matchCat}]`
        );
        if (interestingLinks.length >= 5) break;
      }
    }

    // Recent bridge entries (bio-environmental-correlation) — the narrative
    // density layer that enables cross-domain pattern formation
    const { data: bridgeEntries } = await supabase
      .from('hunt_knowledge')
      .select('title, state_abbr, metadata, created_at')
      .eq('content_type', 'bio-environmental-correlation')
      .gte('created_at', yesterday)
      .order('created_at', { ascending: false })
      .limit(50);

    const bridgeSection: string[] = [];
    if (bridgeEntries) {
      // Sort by env_matches count — most interesting first
      const sorted = bridgeEntries
        .map((b: any) => ({ ...b, matches: (b.metadata as any)?.env_matches || 0 }))
        .sort((a: any, b: any) => b.matches - a.matches);
      for (const b of sorted.slice(0, 8)) {
        const meta = b.metadata as any;
        const types = (meta?.env_types || []).slice(0, 5).join(', ');
        bridgeSection.push(`${b.state_abbr}: ${b.matches} env signals — ${types}`);
      }
    }

    // -----------------------------------------------------------------
    // 3. Arcs graded in the last 24h
    // -----------------------------------------------------------------
    const { data: gradedArcs } = await supabase
      .from('hunt_state_arcs')
      .select('state_abbr, grade, grade_reasoning, recognition_claim, outcome_signals')
      .not('grade', 'is', null)
      .gte('updated_at', yesterday)
      .order('updated_at', { ascending: false })
      .limit(10);

    const gradeSection: string[] = [];
    if (gradedArcs && gradedArcs.length > 0) {
      for (const arc of gradedArcs) {
        const claim = (arc.recognition_claim as Record<string, unknown>)?.claim || 'unknown claim';
        const signals = arc.outcome_signals as unknown[];
        const signalCount = Array.isArray(signals) ? signals.length : 0;
        gradeSection.push(
          `${arc.state_abbr}: ${arc.grade?.toUpperCase()}\n` +
          `  Claimed: ${String(claim).slice(0, 120)}\n` +
          `  Outcome signals: ${signalCount}\n` +
          `  ${(arc.grade_reasoning || '').slice(0, 200)}`
        );
      }
    }

    // -----------------------------------------------------------------
    // 4. Top 3 convergence movers (biggest score changes day-over-day)
    // -----------------------------------------------------------------
    const twoDaysAgo = new Date(now.getTime() - 48 * 3600 * 1000).toISOString().slice(0, 10);

    const { data: recentScores } = await supabase
      .from('hunt_convergence_scores')
      .select('state_abbr, score, date')
      .gte('date', twoDaysAgo)
      .order('date', { ascending: false })
      .limit(200);

    const moversSection: string[] = [];
    if (recentScores && recentScores.length > 0) {
      const byState: Record<string, { today: number | null; yesterday: number | null }> = {};
      for (const row of recentScores) {
        if (!byState[row.state_abbr]) byState[row.state_abbr] = { today: null, yesterday: null };
        if (row.date === today) {
          byState[row.state_abbr].today = row.score;
        } else {
          byState[row.state_abbr].yesterday = row.score;
        }
      }
      const movers = Object.entries(byState)
        .filter(([_, v]) => v.today !== null && v.yesterday !== null)
        .map(([st, v]) => ({ state: st, today: v.today!, yesterday: v.yesterday!, delta: v.today! - v.yesterday! }))
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 5);

      for (const m of movers) {
        const arrow = m.delta > 0 ? '+' : '';
        moversSection.push(`${m.state}: ${m.yesterday} -> ${m.today} (${arrow}${m.delta})`);
      }
    }

    // -----------------------------------------------------------------
    // 5. Brain stats
    // -----------------------------------------------------------------
    const { count: todayCount } = await supabase
      .from('hunt_knowledge')
      .select('id', { count: 'estimated', head: true })
      .gte('created_at', today);

    const { data: cronHealth } = await supabase
      .from('hunt_cron_log')
      .select('function_name, status')
      .gte('created_at', yesterday)
      .order('created_at', { ascending: false })
      .limit(200);

    let cronsOk = 0;
    let cronsErr = 0;
    const seenFns = new Set<string>();
    if (cronHealth) {
      for (const c of cronHealth) {
        if (seenFns.has(c.function_name)) continue;
        seenFns.add(c.function_name);
        if (c.status === 'success') cronsOk++;
        else cronsErr++;
      }
    }

    // Current accuracy from calibration
    const { data: calibration } = await supabase
      .from('hunt_alert_calibration')
      .select('alert_source, total_alerts, confirmed, partially_confirmed, missed, false_alarm, accuracy_rate')
      .is('state_abbr', null)
      .eq('window_days', 30);

    const accuracyLines: string[] = [];
    if (calibration) {
      for (const c of calibration) {
        accuracyLines.push(
          `${c.alert_source}: ${c.accuracy_rate}% accuracy (${c.total_alerts} graded: ` +
          `${c.confirmed} confirmed, ${c.partially_confirmed} partial, ${c.missed} missed, ${c.false_alarm} false alarm)`
        );
      }
    }

    // Per-domain performance — what is the brain actually good at?
    // Parse outcome_reasoning from compound-risk grades to count per-domain hit rates
    const { data: gradedOutcomes } = await supabase
      .from('hunt_alert_outcomes')
      .select('outcome_reasoning')
      .eq('alert_source', 'compound-risk')
      .eq('outcome_checked', true)
      .not('outcome_reasoning', 'is', null)
      .limit(600);

    const domainStats: Record<string, { confirmed: number; missed: number }> = {};
    if (gradedOutcomes) {
      for (const o of gradedOutcomes) {
        const reasoning = o.outcome_reasoning || '';
        // Parse: "drought: 5 signals (CONFIRMED); birds: 5 signals (CONFIRMED); water: 0 signals (MISSED)"
        const parts = reasoning.split(';');
        for (const part of parts) {
          const trimmed = part.trim();
          const m = trimmed.match(/^(\w+):\s*\d+\s*signals?\s*\((CONFIRMED|MISSED)\)/i);
          if (m) {
            const domain = m[1].toLowerCase();
            const status = m[2].toUpperCase();
            if (!domainStats[domain]) domainStats[domain] = { confirmed: 0, missed: 0 };
            if (status === 'CONFIRMED') domainStats[domain].confirmed++;
            else domainStats[domain].missed++;
          }
        }
      }
    }
    const domainLines: string[] = [];
    const sortedDomains = Object.entries(domainStats)
      .map(([d, s]) => ({ domain: d, ...s, total: s.confirmed + s.missed, rate: s.confirmed / (s.confirmed + s.missed) }))
      .sort((a, b) => b.total - a.total);
    for (const d of sortedDomains) {
      domainLines.push(`${d.domain}: ${(d.rate * 100).toFixed(1)}% (${d.confirmed}/${d.total} claims)`);
    }

    // -----------------------------------------------------------------
    // 6. Compile the digest
    // -----------------------------------------------------------------
    const sections: string[] = [];

    sections.push(`DDC DAILY DIGEST — ${today}`);
    sections.push('='.repeat(40));

    sections.push('\nNARRATOR OUTPUTS (last 24h):');
    if (narrativeSection.length > 0) {
      sections.push(narrativeSection.join('\n\n'));
    } else {
      sections.push('Nothing. The narrator had no external cross-domain pattern links to narrate.');
      sections.push('This means the embedding space is not yet surfacing connections between');
      sections.push('different external data types (weather <-> migration, soil <-> water, etc.).');
      sections.push('The narrative bridge layer may need more density.');
    }

    sections.push('\nWHAT THE BRAIN IS GOOD AT (per-domain hit rates):');
    if (domainLines.length > 0) {
      sections.push(domainLines.join('\n'));
    } else {
      sections.push('No graded compound-risk outcomes to analyze.');
    }

    sections.push('\nBRIDGE LAYER (last 24h cross-domain correlations):');
    if (bridgeSection.length > 0) {
      sections.push(bridgeSection.join('\n'));
      sections.push(`Total bridge entries created in 24h: ${bridgeEntries?.length ?? 0}`);
    } else {
      sections.push('No bridge entries created. hunt-bio-correlator may be paused.');
    }

    sections.push('\nINTERESTING BUT UNCONFIRMED (pattern links):');
    if (interestingLinks.length > 0) {
      sections.push(interestingLinks.join('\n'));
    } else {
      sections.push('No notable cross-domain pattern links formed in the last 24h.');
      sections.push('(Pattern-link-worker is paused pending IVFFlat index rebuild.)');
    }

    sections.push('\nHOW THE BRAIN GRADED ITSELF:');
    if (gradeSection.length > 0) {
      sections.push(gradeSection.join('\n\n'));
    } else {
      sections.push('No arcs graded in the last 24h.');
    }

    sections.push('\nBIGGEST MOVERS:');
    if (moversSection.length > 0) {
      sections.push(moversSection.join('\n'));
    } else {
      sections.push('No convergence score changes available.');
    }

    sections.push('\nBRAIN STATS:');
    sections.push(`Entries added today: ~${todayCount || 0}`);
    sections.push(`Crons healthy: ${cronsOk}/${cronsOk + cronsErr}`);
    if (accuracyLines.length > 0) {
      sections.push('Accuracy by source (30-day rolling):');
      sections.push(accuracyLines.join('\n'));
    }

    const digestText = sections.join('\n');

    console.log(`[${fnName}] Digest compiled (${digestText.length} chars)`);

    // -----------------------------------------------------------------
    // 7. Embed and store in hunt_knowledge
    // -----------------------------------------------------------------
    const embedding = await generateEmbedding(digestText.slice(0, 2000), 'document');

    const { error: insertErr } = await supabase
      .from('hunt_knowledge')
      .insert({
        title: `Daily Digest — ${today}`,
        content: digestText,
        content_type: 'daily-digest',
        tags: ['daily-digest', today],
        state_abbr: null,
        effective_date: today,
        embedding,
        metadata: {
          narratives_count: narrativeSection.length,
          interesting_links_count: interestingLinks.length,
          grades_count: gradeSection.length,
          movers_count: moversSection.length,
          entries_today: todayCount || 0,
          crons_ok: cronsOk,
          crons_err: cronsErr,
        },
      });

    if (insertErr) {
      console.error(`[${fnName}] Insert error:`, insertErr);
    }

    const summary = {
      digest_date: today,
      narratives: narrativeSection.length,
      interesting_links: interestingLinks.length,
      grades: gradeSection.length,
      movers: moversSection.length,
      digest_length: digestText.length,
    };

    console.log(`[${fnName}] Done.`, summary);

    await logCronRun({
      functionName: fnName,
      status: 'success',
      summary,
      durationMs: Date.now() - startTime,
    });

    return cronResponse({ ...summary, digest: digestText });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[${fnName}] Fatal:`, msg);
    await logCronRun({
      functionName: fnName,
      status: 'error',
      errorMessage: msg,
      durationMs: Date.now() - startTime,
    });
    return cronErrorResponse(msg);
  }
});
