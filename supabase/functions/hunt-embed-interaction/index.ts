import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { generateEmbedding } from '../_shared/embedding.ts';

/**
 * Embeds any interaction (query, synthesis, discovery) into hunt_knowledge.
 * The gate only opens inward — everything that passes through gets embedded.
 */
serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    if (req.method !== 'POST') return errorResponse(req, 'Method not allowed', 405);

    const { content, content_type, title, state_abbr, metadata } = await req.json();
    if (!content || !content_type) {
      return errorResponse(req, 'content and content_type required');
    }

    const embedding = await generateEmbedding(content, 'document');

    const supabase = createSupabaseClient();
    const { error } = await supabase.from('hunt_knowledge').insert({
      title: title || `Interaction: ${content_type}`,
      content,
      content_type,
      state_abbr: state_abbr || null,
      effective_date: new Date().toISOString().split('T')[0],
      tags: ['interaction', content_type],
      embedding: JSON.stringify(embedding),
      signal_weight: 0.5,
      metadata: metadata || {},
    });

    if (error) {
      console.error('[embed-interaction] Insert failed:', error);
      return errorResponse(req, 'Insert failed', 500);
    }

    return successResponse(req, { embedded: true });
  } catch (err) {
    console.error('[embed-interaction]', err);
    return errorResponse(req, 'Internal error', 500);
  }
});
