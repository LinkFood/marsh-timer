import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { generateEmbedding } from '../_shared/embedding.ts';

/**
 * Embeds a USER INTERACTION — a query signal or a feedback rating — into
 * hunt_knowledge.
 *
 * ── WHY THIS FILE IS PARANOID ────────────────────────────────────────────────
 * This endpoint runs verify_jwt = false with a SERVICE ROLE client, so it is
 * reachable unauthenticated by anyone on the internet. It used to accept
 * `content_type` verbatim from the request body and insert it, embedded.
 *
 * That is an injection vector into the archive, and a worse one than it looks.
 * A destructive hole is loud and restores from backup; this one FABRICATES. A
 * caller could post `content_type: 'ghcn-daily'` or `'weather-event'` with any
 * text, and it would land embedded, indistinguishable from a measurement —
 * where vector search serves it as an observation and, for weather-event,
 * hunt-atlas-spot renders it as a live chip on /atlas.
 *
 * The archive's whole claim is that every sentence traces to a row. An
 * endpoint that lets a stranger write the row voids that claim.
 *
 * So the gate is now narrow by construction: two content types, both of which
 * describe a person interacting with the site, neither of which any reader
 * treats as a measurement. Everything else is refused. Length caps exist so
 * the endpoint cannot be used to bulk-load the archive one POST at a time.
 *
 * All 57 rows that existed when this was hardened were 'query-signal'; the
 * three callers (AskPage, DatePage, BrainResponseCard) send only these two.
 */

/** The only content types a stranger may write. NEVER add a lane name here. */
const ALLOWED_CONTENT_TYPES = new Set(['query-signal', 'query-feedback']);
const MAX_CONTENT = 4000;
const MAX_TITLE = 200;
const MAX_METADATA_BYTES = 4000;

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    if (req.method !== 'POST') return errorResponse(req, 'Method not allowed', 405);

    const { content, content_type, title, state_abbr, metadata } = await req.json();
    if (!content || !content_type) {
      return errorResponse(req, 'content and content_type required');
    }
    if (typeof content_type !== 'string' || !ALLOWED_CONTENT_TYPES.has(content_type)) {
      // Refuse by name so a legitimate caller sees why; the set is not secret.
      return errorResponse(req, `content_type must be one of: ${[...ALLOWED_CONTENT_TYPES].join(', ')}`);
    }
    if (typeof content !== 'string' || content.length > MAX_CONTENT) {
      return errorResponse(req, `content must be a string under ${MAX_CONTENT} characters`);
    }
    if (title != null && (typeof title !== 'string' || title.length > MAX_TITLE)) {
      return errorResponse(req, `title must be a string under ${MAX_TITLE} characters`);
    }
    // A two-letter code or nothing. Anything else is a caller trying to be clever.
    if (state_abbr != null && !(typeof state_abbr === 'string' && /^[A-Z]{2}$/.test(state_abbr))) {
      return errorResponse(req, 'state_abbr must be a 2-letter uppercase code or omitted');
    }
    if (metadata != null && (typeof metadata !== 'object' || Array.isArray(metadata) ||
        JSON.stringify(metadata).length > MAX_METADATA_BYTES)) {
      return errorResponse(req, `metadata must be an object under ${MAX_METADATA_BYTES} bytes`);
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
