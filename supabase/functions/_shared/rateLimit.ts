import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.84.0';

const SIGNED_IN_DAILY_LIMIT = 50;

// --- Anonymous abuse ceiling -------------------------------------------------
// This path spends ANTHROPIC_API_KEY, so it cannot be left open. It used to
// return { allowed: true } for every anonymous caller on the theory that the
// frontend gated by session — it does not (nothing in src/ reads `remaining`
// or `rateLimited`), and the dispatcher URL is curl-reachable regardless of
// which page calls it. The cap below is the server-side backstop.
//
// This is an ABUSE ceiling, not a per-user UX quota: it sits well above normal
// human use so that offices, households, and carrier NAT (many people behind
// one address) are not locked out, while an unattended loop is bounded instead
// of infinite. Tune ANON_DAILY_IP_LIMIT if real traffic argues otherwise.
const ANON_DAILY_IP_LIMIT = 30;
const ANON_WINDOW_MS = 24 * 60 * 60 * 1000;
// Bounds isolate memory. Eviction prefers buckets closest to expiring anyway.
const ANON_MAX_TRACKED_IPS = 5000;

type AnonBucket = { count: number; resetAt: number };

// Per-isolate. Supabase may run several isolates and recycles them on cold
// start, so the true ceiling is (limit x live isolates) rather than a hard
// global 30/day. That is a large reduction from "unlimited" and needs no
// schema change; a durable bucket table would make it exact.
const anonBuckets = new Map<string, AnonBucket>();

function anonBucketKey(req?: Request | null): string {
  if (!req) return 'unknown';
  const candidates = [
    req.headers.get('x-forwarded-for')?.split(',')[0],
    req.headers.get('x-real-ip'),
    req.headers.get('cf-connecting-ip'),
  ];
  for (const candidate of candidates) {
    const ip = candidate?.trim();
    if (ip) return ip;
  }
  // No usable client address. Fail CLOSED into one shared bucket — the
  // alternative hands an unmetered lane to anyone who strips the headers.
  return 'unknown';
}

function pruneAnonBuckets(now: number): void {
  for (const [key, bucket] of anonBuckets) {
    if (bucket.resetAt <= now) anonBuckets.delete(key);
  }
  if (anonBuckets.size <= ANON_MAX_TRACKED_IPS) return;

  const bySoonestReset = [...anonBuckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
  for (const [key] of bySoonestReset) {
    if (anonBuckets.size <= ANON_MAX_TRACKED_IPS) break;
    anonBuckets.delete(key);
  }
}

function checkAnonRateLimit(req?: Request | null): { allowed: boolean; remaining: number; error?: string } {
  const now = Date.now();
  pruneAnonBuckets(now);

  const key = anonBucketKey(req);
  const bucket = anonBuckets.get(key);

  // First request in this window (or the window already rolled over).
  if (!bucket || bucket.resetAt <= now) {
    anonBuckets.set(key, { count: 1, resetAt: now + ANON_WINDOW_MS });
    return { allowed: true, remaining: ANON_DAILY_IP_LIMIT - 1 };
  }

  if (bucket.count >= ANON_DAILY_IP_LIMIT) {
    const hoursLeft = Math.max(1, Math.ceil((bucket.resetAt - now) / (60 * 60 * 1000)));
    return {
      allowed: false,
      remaining: 0,
      error: `Anonymous request limit reached. Sign in for more, or try again in ${hoursLeft}h.`,
    };
  }

  bucket.count += 1;
  return { allowed: true, remaining: ANON_DAILY_IP_LIMIT - bucket.count };
}

/**
 * @param req The originating request, used to derive the anonymous IP bucket.
 *            Omitting it collapses every anonymous caller into one shared
 *            bucket, which throttles rather than opens.
 */
export async function checkRateLimit(
  userId: string | null,
  req?: Request | null,
): Promise<{ allowed: boolean; remaining: number; error?: string }> {
  if (!userId) {
    return checkAnonRateLimit(req);
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

  // A missing count is not a zero — treat an unreadable counter as spent
  // rather than assuming the user has their full allowance left.
  const used = Number(settings.daily_query_count);
  if (!Number.isFinite(used)) {
    await supabase.from('hunt_user_settings')
      .update({ daily_query_count: 1, daily_query_reset: today })
      .eq('user_id', userId);
    return { allowed: true, remaining: limit - 1 };
  }

  if (used >= limit) {
    return { allowed: false, remaining: 0, error: `Daily limit of ${limit} queries reached. Resets at midnight.` };
  }

  // Increment
  await supabase.from('hunt_user_settings')
    .update({ daily_query_count: used + 1 })
    .eq('user_id', userId);

  return { allowed: true, remaining: limit - used - 1 };
}
