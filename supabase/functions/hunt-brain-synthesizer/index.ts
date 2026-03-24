import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { generateEmbedding } from '../_shared/embedding.ts';
import { callClaude, CLAUDE_MODELS, parseTextContent } from '../_shared/anthropic.ts';
import { logCronRun } from '../_shared/cronLog.ts';

const FUNCTION_NAME = 'hunt-brain-synthesizer';
const STATE_ABBRS = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  // Cache request data before any async work
  let body: Record<string, any> = {};
  try {
    body = await req.json().catch(() => ({}));
  } catch {
    return new Response(JSON.stringify({ error: 'Request closed' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const startTime = Date.now();
  const supabase = createSupabaseClient();

  try {
    const now = new Date();
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const today = now.toISOString().split('T')[0];
    let synthesized = 0;

    for (const state of STATE_ABBRS) {
      const { data: entries } = await supabase
        .from('hunt_knowledge')
        .select('id, title, content, content_type, metadata, effective_date')
        .eq('state_abbr', state)
        .gte('created_at', fortyEightHoursAgo.toISOString())
        .neq('content_type', 'ai-synthesis')
        .order('created_at', { ascending: false })
        .limit(50);

      if (!entries || entries.length < 10) continue;

      const typeGroups: Record<string, typeof entries> = {};
      for (const e of entries) {
        const t = e.content_type || 'unknown';
        if (!typeGroups[t]) typeGroups[t] = [];
        typeGroups[t].push(e);
      }

      const domainCount = Object.keys(typeGroups).length;
      if (domainCount < 3) continue;

      console.log(`[${FUNCTION_NAME}] ${state}: ${entries.length} entries across ${domainCount} domains — synthesizing`);

      const contextLines: string[] = [
        `State: ${state}`,
        `Time window: last 48 hours`,
        `Total entries: ${entries.length}`,
        `Domains: ${Object.keys(typeGroups).join(', ')}`,
        '',
      ];

      for (const [type, items] of Object.entries(typeGroups)) {
        contextLines.push(`--- ${type} (${items.length} entries) ---`);
        for (const item of items.slice(0, 5)) {
          contextLines.push(`  ${item.title}`);
          if (item.content) contextLines.push(`  ${item.content.slice(0, 200)}`);
        }
        contextLines.push('');
      }

      try {
        const synthesisResponse = await callClaude({
          model: CLAUDE_MODELS.sonnet,
          system: `You are an environmental intelligence synthesizer. You receive clustered data from multiple domains (weather, water, seismic, biological, atmospheric) for a specific state and time window. Write a concise synthesis (3-5 sentences) that:
1. Identifies the key pattern: what's converging?
2. References specific data points (dates, values, sources)
3. Notes historical precedent if the data includes it
4. States confidence based on signal diversity and count
Never predict. State what the data shows and what happened historically in similar conditions.
Format: Start with the state and the pattern, then the evidence, then the confidence.`,
          messages: [{ role: 'user', content: contextLines.join('\n') }],
          max_tokens: 500,
          temperature: 0.2,
        });

        const synthesisText = parseTextContent(synthesisResponse);
        if (!synthesisText || synthesisText.length < 50) continue;

        const embedding = await generateEmbedding(synthesisText, 'document');

        const sourceIds = entries.slice(0, 20).map(e => e.id);
        const { error: insertErr } = await supabase.from('hunt_knowledge').insert({
          title: `AI Synthesis: ${state} — ${today}`,
          content: synthesisText,
          content_type: 'ai-synthesis',
          state_abbr: state,
          species: null,
          effective_date: today,
          signal_weight: 1.5,
          tags: [state, 'ai-synthesis', ...Object.keys(typeGroups)],
          metadata: {
            source: 'brain-synthesizer',
            domains_fused: domainCount,
            source_count: entries.length,
            source_ids: sourceIds,
            domain_types: Object.keys(typeGroups),
            confidence: domainCount >= 5 ? 'high' : domainCount >= 3 ? 'medium' : 'low',
            synthesized_at: now.toISOString(),
            confirmations: 0,
            status: 'active',
          },
          embedding,
        });

        if (insertErr) {
          console.error(`[${FUNCTION_NAME}] Insert error for ${state}:`, insertErr.message);
        } else {
          synthesized++;
          console.log(`[${FUNCTION_NAME}] Synthesized ${state}: ${domainCount} domains, ${entries.length} entries`);
        }
      } catch (err) {
        console.error(`[${FUNCTION_NAME}] Synthesis error for ${state}:`, err);
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    const summary = { states_checked: STATE_ABBRS.length, synthesized };
    await logCronRun({ functionName: FUNCTION_NAME, status: 'success', summary, durationMs: Date.now() - startTime });
    return successResponse(req, summary);
  } catch (err: any) {
    await logCronRun({ functionName: FUNCTION_NAME, status: 'error', errorMessage: err.message, durationMs: Date.now() - startTime });
    return errorResponse(req, err.message, 500);
  }
});
