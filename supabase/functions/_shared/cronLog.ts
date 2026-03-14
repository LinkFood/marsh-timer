import { createSupabaseClient } from './supabase.ts';

export async function logCronRun(opts: {
  functionName: string;
  status: 'success' | 'error' | 'partial';
  summary?: Record<string, unknown>;
  errorMessage?: string;
  durationMs?: number;
}): Promise<void> {
  try {
    const supabase = createSupabaseClient();
    await supabase.from('hunt_cron_log').insert({
      function_name: opts.functionName,
      status: opts.status,
      summary: opts.summary || null,
      error_message: opts.errorMessage || null,
      duration_ms: opts.durationMs || null,
    });
  } catch (err) {
    // Never let logging break the cron
    console.warn('[cronLog] Failed to log:', err);
  }
}
