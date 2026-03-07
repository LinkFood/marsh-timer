import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.84.0';

export interface AuthResult {
  userId: string | null;
  error: string | null;
  supabase: SupabaseClient | null;
}

export async function extractUserId(request: Request): Promise<AuthResult> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { userId: null, error: 'Missing authorization', supabase: null };
  }

  const token = authHeader.replace('Bearer ', '');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnonKey) {
    return { userId: null, error: 'Server config error', supabase: null };
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return { userId: null, error: 'Invalid token', supabase: null };
  }

  return { userId: data.user.id, error: null, supabase };
}

export function createServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export function isServiceRoleRequest(request: Request): boolean {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return false;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceRoleKey) return false;
  const expected = `Bearer ${serviceRoleKey}`;
  if (authHeader.length !== expected.length) return false;
  const encoder = new TextEncoder();
  const a = encoder.encode(authHeader);
  const b = encoder.encode(expected);
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a[i] ^ b[i];
  return result === 0;
}

export async function extractUserIdWithServiceRole(
  request: Request,
  body?: Record<string, unknown>
): Promise<AuthResult> {
  if (isServiceRoleRequest(request)) {
    const userId = body?.userId as string | undefined;
    if (userId) {
      return { userId, error: null, supabase: createServiceClient() };
    }
    return { userId: null, error: 'Service role missing userId', supabase: null };
  }
  return extractUserId(request);
}
