import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { logCronRun } from '../_shared/cronLog.ts';

// ─── Jean Meeus Lunar Algorithms (pure math, zero API calls) ───

const SYNODIC = 29.53058868;
const REF_NEW_MOON = 2451550.1; // 2000 Jan 6.5 JD

function toJulianDay(year: number, month: number, day: number): number {
  if (month <= 2) { year--; month += 12; }
  const A = Math.floor(year / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + B - 1524.5;
}

function moonAge(jd: number): number {
  const diff = jd - REF_NEW_MOON;
  return ((diff % SYNODIC) + SYNODIC) % SYNODIC;
}

function illumination(moonAgeDays: number): number {
  return (1 - Math.cos(moonAgeDays / SYNODIC * 2 * Math.PI)) / 2 * 100;
}

function phaseName(moonAgeDays: number): string {
  const age = moonAgeDays;
  if (age < 1.85) return 'new';
  if (age < 7.38) return 'waxing_crescent';
  if (age < 9.23) return 'first_quarter';
  if (age < 14.77) return 'waxing_gibbous';
  if (age < 16.61) return 'full';
  if (age < 22.15) return 'waning_gibbous';
  if (age < 23.99) return 'last_quarter';
  if (age < 27.68) return 'waning_crescent';
  return 'new';
}

function minutesToTime(mins: number): string {
  const m = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const min = Math.floor(m % 60);
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;
}

function moonTransitTimes(jd: number): {
  major1Start: string; major1End: string;
  major2Start: string; major2End: string;
  minor1Start: string; minor1End: string;
  minor2Start: string; minor2End: string;
} {
  // Moon transits ~50.47 minutes later each day
  // Reference: on JD 2451545 (J2000.0), moon transit ~12:00 UTC
  const MOON_DELAY_PER_DAY = 50.47;
  const daysSinceJ2000 = jd - 2451545.0;

  // Moon transit time in minutes past midnight UTC
  const transitMinutes = ((12 * 60 + daysSinceJ2000 * MOON_DELAY_PER_DAY) % 1440 + 1440) % 1440;

  // Major 1: moon overhead (transit), 2hr window centered on transit
  const major1Start = (transitMinutes - 60 + 1440) % 1440;
  const major1End = (transitMinutes + 60) % 1440;

  // Major 2: moon underfoot (anti-transit), 12 hours offset
  const major2Start = (transitMinutes + 720 - 60) % 1440;
  const major2End = (transitMinutes + 720 + 60) % 1440;

  // Minor 1: moonrise, ~6 hours before transit
  const minor1Start = (transitMinutes - 360 - 30 + 1440) % 1440;
  const minor1End = (transitMinutes - 360 + 30 + 1440) % 1440;

  // Minor 2: moonset, ~6 hours after transit
  const minor2Start = (transitMinutes + 360 - 30) % 1440;
  const minor2End = (transitMinutes + 360 + 30) % 1440;

  return {
    major1Start: minutesToTime(major1Start),
    major1End: minutesToTime(major1End),
    major2Start: minutesToTime(major2Start),
    major2End: minutesToTime(major2End),
    minor1Start: minutesToTime(minor1Start),
    minor1End: minutesToTime(minor1End),
    minor2Start: minutesToTime(minor2Start),
    minor2End: minutesToTime(minor2End),
  };
}

// Prime day detection
function detectPrime(phase: string, illum: number, times: ReturnType<typeof moonTransitTimes>): { isPrime: boolean; reason: string | null } {
  // New moon
  if (illum < 5) {
    return { isPrime: true, reason: 'New moon — minimal light disruption' };
  }

  // Low illumination waning crescent
  if (illum < 15 && phase === 'waning_crescent') {
    return { isPrime: true, reason: 'Low illumination — dark sky feeding window' };
  }

  // Major feed window aligns with dawn (5-7 AM UTC ~= dawn for central US)
  // or dusk (17-19 / 5-7 PM UTC)
  const parseHour = (t: string) => parseInt(t.split(':')[0], 10);
  const major1H = parseHour(times.major1Start);
  const major2H = parseHour(times.major2Start);

  for (const [h, period] of [[major1H, 'major1'], [major2H, 'major2']] as const) {
    if (h >= 5 && h <= 7) {
      return { isPrime: true, reason: `Major feed window aligns with dawn (${period === 'major1' ? 'overhead' : 'underfoot'})` };
    }
    if (h >= 17 && h <= 19) {
      return { isPrime: true, reason: `Major feed window aligns with dusk (${period === 'major1' ? 'overhead' : 'underfoot'})` };
    }
  }

  return { isPrime: false, reason: null };
}

// ─── Date helpers ───

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function getISOWeekMonday(d: Date): string {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  return formatDate(date);
}

// ─── Main handler ───

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    console.log('[hunt-solunar-precompute] Starting 365-day precompute');
    const startTime = Date.now();

    const supabase = createSupabaseClient();
    const today = new Date();
    const rows: Record<string, unknown>[] = [];
    let primeDays = 0;

    // Weekly summary grouping
    const weeklyGroups: Map<string, {
      mondayDate: string;
      phases: string[];
      illums: number[];
      primeCount: number;
      transitions: string[];
    }> = new Map();

    let prevPhase = '';

    // Generate 365 days of solunar data
    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const dateStr = formatDate(d);

      const jd = toJulianDay(d.getFullYear(), d.getMonth() + 1, d.getDate());
      const age = moonAge(jd);
      const illum = illumination(age);
      const phase = phaseName(age);
      const times = moonTransitTimes(jd);
      const { isPrime, reason } = detectPrime(phase, illum, times);

      if (isPrime) primeDays++;

      rows.push({
        date: dateStr,
        moon_phase: phase,
        illumination_pct: Math.round(illum * 100) / 100,
        moon_age_days: Math.round(age * 100) / 100,
        major_start_1: times.major1Start,
        major_end_1: times.major1End,
        major_start_2: times.major2Start,
        major_end_2: times.major2End,
        minor_start_1: times.minor1Start,
        minor_end_1: times.minor1End,
        minor_start_2: times.minor2Start,
        minor_end_2: times.minor2End,
        is_prime: isPrime,
        prime_reason: reason,
        updated_at: new Date().toISOString(),
      });

      // Track weekly groups
      const monday = getISOWeekMonday(d);
      if (!weeklyGroups.has(monday)) {
        weeklyGroups.set(monday, {
          mondayDate: monday,
          phases: [],
          illums: [],
          primeCount: 0,
          transitions: [],
        });
      }
      const week = weeklyGroups.get(monday)!;
      week.phases.push(phase);
      week.illums.push(illum);
      if (isPrime) week.primeCount++;
      if (prevPhase && phase !== prevPhase) {
        week.transitions.push(`${prevPhase} -> ${phase}`);
      }
      prevPhase = phase;
    }

    console.log(`[hunt-solunar-precompute] Computed ${rows.length} days, ${primeDays} prime`);

    // Upsert calendar rows in batches of 50
    const BATCH_SIZE = 50;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from('hunt_solunar_calendar')
        .upsert(batch, { onConflict: 'date' });

      if (error) {
        console.error(`[hunt-solunar-precompute] Upsert batch ${i / BATCH_SIZE + 1} error:`, error);
        throw new Error(`DB upsert failed: ${error.message}`);
      }
    }

    console.log(`[hunt-solunar-precompute] Upserted ${rows.length} calendar rows`);

    // Build weekly summaries for embedding
    const weekEntries = Array.from(weeklyGroups.values());

    // Delete old solunar-weekly entries before inserting fresh ones
    const { error: deleteError } = await supabase
      .from('hunt_knowledge')
      .delete()
      .eq('content_type', 'solunar-weekly');

    if (deleteError) {
      console.error('[hunt-solunar-precompute] Delete old solunar-weekly error:', deleteError);
    }

    // Build embedding texts
    const embeddingTexts: string[] = [];
    const knowledgeRows: { title: string; content: string; content_type: string; tags: string[] }[] = [];

    for (const week of weekEntries) {
      // Dominant phase = most common phase in the week
      const phaseCounts: Record<string, number> = {};
      for (const p of week.phases) {
        phaseCounts[p] = (phaseCounts[p] || 0) + 1;
      }
      const dominantPhase = Object.entries(phaseCounts).sort((a, b) => b[1] - a[1])[0][0];

      const avgIllum = Math.round(week.illums.reduce((a, b) => a + b, 0) / week.illums.length);
      const transitionStr = week.transitions.length > 0 ? week.transitions.join(', ') : 'no transition';

      const title = `Solunar week of ${week.mondayDate}`;
      const content = `solunar | week of ${week.mondayDate} | phase:${dominantPhase} illum_avg:${avgIllum}% | prime_days:${week.primeCount} | ${transitionStr}`;

      embeddingTexts.push(`${title} | solunar-weekly | solunar,moon,feeding | ${content}`);
      knowledgeRows.push({
        title,
        content,
        content_type: 'solunar-weekly',
        tags: ['solunar', 'moon', 'feeding'],
        species: null,
        effective_date: week.mondayDate || null,
      });
    }

    console.log(`[hunt-solunar-precompute] Embedding ${embeddingTexts.length} weekly summaries`);

    // Batch embed (batchEmbed handles chunking at 20)
    const embeddings = await batchEmbed(embeddingTexts, 'document');

    // Insert knowledge rows with embeddings
    const knowledgeInserts = knowledgeRows.map((row, idx) => ({
      ...row,
      embedding: embeddings[idx],
    }));

    // Insert in batches of 20
    for (let i = 0; i < knowledgeInserts.length; i += 20) {
      const batch = knowledgeInserts.slice(i, i + 20);
      const { error: insertError } = await supabase
        .from('hunt_knowledge')
        .insert(batch);

      if (insertError) {
        console.error(`[hunt-solunar-precompute] Knowledge insert batch error:`, insertError);
        throw new Error(`Knowledge insert failed: ${insertError.message}`);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[hunt-solunar-precompute] Done in ${elapsed}s: ${rows.length} days, ${primeDays} prime, ${weekEntries.length} weeks embedded`);

    const summary = {
      days_computed: rows.length,
      prime_days: primeDays,
      weeks_embedded: weekEntries.length,
      elapsed_seconds: parseFloat(elapsed),
    };

    await logCronRun({
      functionName: 'hunt-solunar-precompute',
      status: 'success',
      summary,
      durationMs: Date.now() - startTime,
    });

    return successResponse(req, summary);
  } catch (error) {
    console.error('[hunt-solunar-precompute]', error);

    await logCronRun({
      functionName: 'hunt-solunar-precompute',
      status: 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
    });

    return errorResponse(req, 'Internal server error', 500);
  }
});
