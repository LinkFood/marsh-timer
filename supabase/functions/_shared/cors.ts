const ALLOWED_ORIGINS = [
  'https://duckcountdown.com',
  'https://www.duckcountdown.com',
  'https://marsh-timer.vercel.app',
];

const isDevelopment = Deno.env.get('ENVIRONMENT') !== 'production';

export function getCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin') ?? '';
  const isAllowed =
    ALLOWED_ORIGINS.includes(origin) ||
    (isDevelopment && (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')));

  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}

export function handleCors(request: Request): Response | null {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: getCorsHeaders(request) });
  }
  return null;
}
