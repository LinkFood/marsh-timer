import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_MODEL = 'voyage-3-lite';

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  // Service role key validation
  const auth = req.headers.get('authorization')?.replace('Bearer ', '');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (auth !== serviceKey) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    if (req.method !== 'POST') return errorResponse(req, 'Method not allowed', 405);

    const { text, input_type } = await req.json();
    if (!text) return errorResponse(req, 'text required');

    const apiKey = Deno.env.get('VOYAGE_API_KEY');
    if (!apiKey) return errorResponse(req, 'VOYAGE_API_KEY not configured', 500);

    const response = await fetch(VOYAGE_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: VOYAGE_MODEL,
        input: [text],
        input_type: input_type || 'document',
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[hunt-generate-embedding] Voyage error:', response.status, errText);
      return errorResponse(req, 'Embedding generation failed', 502);
    }

    const data = await response.json();
    const embedding = data.data?.[0]?.embedding;

    if (!embedding) {
      return errorResponse(req, 'No embedding returned', 502);
    }

    return successResponse(req, { embedding });
  } catch (error) {
    console.error('[hunt-generate-embedding]', error);
    return errorResponse(req, 'Internal server error', 500);
  }
});
