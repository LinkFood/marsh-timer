import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.84.0';

const FREE_DAILY_LIMIT = 3;
const SIGNED_IN_DAILY_LIMIT = 50;

export async function checkRateLimit(userId: string | null): Promise<{ allowed: boolean; remaining: number; error?: string }> {
  if (!userId) {
    // Anonymous — use a generous limit, actual gating is session-based in frontend
    return { allowed: true, remaining: FREE_DAILY_LIMIT };
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Get or create settings
  const { data: settings } = await supabase
    .from('hunt_user_settings')
    .select('daily_query_count, daily_query_reset, tier')
    .eq('user_id', userId)
    .maybeSingle();

  if (!settings) {
    // Auto-create
    await supabase.from('hunt_user_settings').insert({ user_id: userId });
    return { allowed: true, remaining: SIGNED_IN_DAILY_LIMIT - 1 };
  }

  const today = new Date().toISOString().split('T')[0];
  const limit = settings.tier === 'pro' ? 999 : SIGNED_IN_DAILY_LIMIT;

  // Reset if new day
  if (settings.daily_query_reset !== today) {
    await supabase.from('hunt_user_settings')
      .update({ daily_query_count: 1, daily_query_reset: today })
      .eq('user_id', userId);
    return { allowed: true, remaining: limit - 1 };
  }

  if (settings.daily_query_count >= limit) {
    return { allowed: false, remaining: 0, error: `Daily limit of ${limit} queries reached. Resets at midnight.` };
  }

  // Increment
  await supabase.from('hunt_user_settings')
    .update({ daily_query_count: settings.daily_query_count + 1 })
    .eq('user_id', userId);

  return { allowed: true, remaining: limit - settings.daily_query_count - 1 };
}
